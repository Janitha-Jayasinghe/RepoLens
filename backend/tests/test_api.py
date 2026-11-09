"""Deterministic API tests: fixtures are synthetic and never used by the application."""
import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from backend.main import app, github_client


def repository(**overrides):
    return dict(id=1, name='repo', full_name='canonical/repo', html_url='https://github.com/canonical/repo', owner={'login': 'canonical'}, description=None, stargazers_count=0, forks_count=0, open_issues_count=0, default_branch='main', language=None, archived=False, private=False, created_at='2020-01-01T00:00:00Z', pushed_at=None, **overrides)


@pytest.fixture(autouse=True)
def clear_dependencies():
    yield
    app.dependency_overrides.clear()
    from backend.work_items import WORK_CACHE
    WORK_CACHE.clear()
    from backend.health_api import HEALTH_CACHE
    HEALTH_CACHE.clear()
    from backend.snapshot_api import SNAPSHOT_STORE, SNAPSHOT_LOOKUP
    SNAPSHOT_STORE.clear()
    SNAPSHOT_LOOKUP.clear()


def request(repo=None, handler=None, method='GET', headers=None, endpoint='/api/analyze', query=None):
    async def run():
        if handler:
            async def override():
                async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url='https://api.github.com', follow_redirects=True) as client:
                    yield client
            app.dependency_overrides[github_client] = override
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            return await client.request(method, '/' if repo is None else endpoint, params={} if repo is None else {'repo': repo, **(query or {})}, headers=headers)
    return asyncio.run(run())


def test_root_preserved():
    assert request().json() == {'message': 'RepoLens API is running!', 'status': 'success'}


def test_schema_and_canonical_redirect():
    def handler(req):
        if req.url.path == '/repos/old/repo':
            return httpx.Response(301, headers={'Location': 'https://api.github.com/repos/canonical/repo'})
        assert req.url.path == '/repos/canonical/repo'
        return httpx.Response(200, json=repository())
    response = request('old/repo', handler)
    assert response.status_code == 200
    result = response.json()
    assert result['requested_repo'] == 'old/repo'
    assert result['repository']['full_name'] == 'canonical/repo'
    assert result['source_url'] == 'https://github.com/canonical/repo'
    assert datetime.fromisoformat(result['analyzed_at'].replace('Z', '+00:00')).tzinfo is not None


@pytest.mark.parametrize('value', ['owner', 'owner/repo/extra', 'https://example.com/a/b', 'https://github.com.evil.test/a/b', 'https://user@github.com/a/b', 'https://github.com/a/b?token=x', 'a/..', 'a/b%2fc', 'a b/repo', 'https://github.com:443/a/b'])
def test_invalid_inputs_do_not_reach_github(value):
    def unexpected(req):
        pytest.fail('Invalid input must not make an upstream request')
    assert request(value, unexpected).status_code == 422


@pytest.mark.parametrize('value', ['owner/repo', ' https://github.com/owner/repo/ ', 'https://www.github.com/owner/repo.git'])
def test_valid_inputs(value):
    def handler(req):
        assert req.url.path == '/repos/owner/repo'
        return httpx.Response(200, json=repository())
    assert request(value, handler).status_code == 200


@pytest.mark.parametrize('status,headers', [(429, {'Retry-After': '5'}), (403, {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': str(int(datetime.now(timezone.utc).timestamp()) + 120)}), (403, {'Retry-After': '10'})])
def test_rate_limits(status, headers):
    response = request('owner/repo', lambda req: httpx.Response(status, headers=headers, json={'message': 'API rate limit exceeded'}))
    assert response.status_code == 429
    assert response.json()['detail']['code'] == 'github_rate_limited'
    assert int(response.headers['Retry-After']) > 0


@pytest.mark.parametrize('upstream,expected,code', [(404, 404, 'repository_not_found'), (401, 502, 'github_authentication'), (403, 403, 'github_forbidden'), (500, 502, 'github_error')])
def test_upstream_errors(upstream, expected, code):
    response = request('owner/repo', lambda req: httpx.Response(upstream, json={'message': 'Unavailable'}))
    assert response.status_code == expected
    assert response.json()['detail']['code'] == code


@pytest.mark.parametrize('error,expected', [(httpx.ConnectError('unreachable'), 502), (httpx.ReadTimeout('timeout'), 504)])
def test_network_and_timeout(error, expected):
    def handler(req):
        raise error
    assert request('owner/repo', handler).status_code == expected


def test_private_repository_is_not_returned():
    data = repository(); data['private'] = True
    assert request('owner/repo', lambda req: httpx.Response(200, json=data)).status_code == 404


@pytest.mark.parametrize('data', [None, {}, {'full_name': 'missing/fields'}])
def test_invalid_upstream_schema(data):
    assert request('owner/repo', lambda req: httpx.Response(200, json=data)).status_code == 502


def test_non_json_upstream():
    assert request('owner/repo', lambda req: httpx.Response(502, text='Bad gateway')).status_code == 502


def test_local_cors_and_unknown_origin():
    for origin, allowed in [('http://127.0.0.1:5173', True), ('https://untrusted.test', False)]:
        response = request(method='OPTIONS', headers={'Origin': origin, 'Access-Control-Request-Method': 'GET'})
        assert (response.headers.get('access-control-allow-origin') == origin) is allowed


def test_overview_fields_are_forwarded_without_substituting_watchers():
    data = repository()
    data.update(owner={'login': 'canonical', 'avatar_url': 'https://avatars.githubusercontent.com/u/1', 'html_url': 'https://github.com/canonical'}, subscribers_count=7, watchers_count=999, size=2048, topics=['testing', 'api'], license={'key': 'mit', 'name': 'MIT License', 'spdx_id': 'MIT'})
    response = request('owner/repo', lambda req: httpx.Response(200, json=data))
    assert response.status_code == 200
    result = response.json()['repository']
    assert result['subscribers_count'] == 7
    assert result['size'] == 2048
    assert result['owner']['avatar_url'] == data['owner']['avatar_url']
    assert result['owner']['html_url'] == data['owner']['html_url']
    assert result['topics'] == ['testing', 'api']
    assert result['license']['spdx_id'] == 'MIT'


def test_missing_overview_metadata_stays_unknown():
    result = request('owner/repo', lambda req: httpx.Response(200, json=repository())).json()['repository']
    for field in ['subscribers_count', 'size', 'topics', 'license']:
        assert result[field] is None
    assert result['owner']['avatar_url'] is None


def test_reported_zero_and_empty_topics_are_preserved():
    data = repository(); data.update(subscribers_count=0, size=0, topics=[], license=None)
    result = request('owner/repo', lambda req: httpx.Response(200, json=data)).json()['repository']
    assert result['subscribers_count'] == 0
    assert result['size'] == 0
    assert result['topics'] == []
    assert result['license'] is None


@pytest.mark.parametrize('field', ['subscribers_count', 'size'])
def test_invalid_overview_counts_are_not_rendered(field):
    data = repository(); data[field] = -1
    assert request('owner/repo', lambda req: httpx.Response(200, json=data)).status_code == 502


@pytest.mark.parametrize('values', [{'Python': 300, 'HTML': 100}, {}, {'Python': 0}])
def test_language_bytes_are_returned_exactly(values):
    def handler(req):
        return httpx.Response(200, json=values if req.url.path.endswith('/languages') else repository())
    response = request('old/repo', handler, endpoint='/api/languages')
    assert response.status_code == 200
    data = response.json()
    assert data['repository'] == 'canonical/repo'
    assert data['languages'] == values
    assert data['total_bytes'] == sum(values.values())


@pytest.mark.parametrize('values', [[], {'Python': -1}, {'Python': '200'}, {'Python': True}, {'Python': 1.5}])
def test_invalid_language_counts_are_not_fabricated(values):
    def handler(req):
        return httpx.Response(200, json=values if req.url.path.endswith('/languages') else repository())
    assert request('owner/repo', handler, endpoint='/api/languages').status_code == 502


def contributor(login='example', contributions=5):
    return {'id': 1, 'login': login, 'html_url': 'https://github.com/' + login, 'avatar_url': None, 'contributions': contributions, 'type': 'User'}


def test_contributors_are_an_explicit_first_page_sample():
    def handler(req):
        if not req.url.path.endswith('/contributors'):
            return httpx.Response(200, json=repository())
        assert req.url.params['per_page'] == '10'
        assert req.url.params['page'] == '1'
        assert req.url.params['anon'] == 'false'
        return httpx.Response(200, json=[contributor('second', 2), contributor('first', 5)], headers={'Link': '<https://api.github.com/repos/canonical/repo/contributors?page=2>; rel="next"'})
    data = request('owner/repo', handler, endpoint='/api/contributors').json()
    assert data['returned_count'] == 2
    assert data['has_more'] is True
    assert data['per_page'] == 10
    assert data['page'] == 1
    assert data['contributors'][0]['login'] == 'first'
    assert 'not the total' in data['coverage_note']


@pytest.mark.parametrize('status,values', [(200, []), (204, None)])
def test_empty_contributor_replies(status, values):
    def handler(req):
        return httpx.Response(status, json=values) if req.url.path.endswith('/contributors') else httpx.Response(200, json=repository())
    data = request('owner/repo', handler, endpoint='/api/contributors').json()
    assert data['contributors'] == []
    assert data['returned_count'] == 0
    assert data['has_more'] is False
    assert 'not the total' in data['coverage_note']


@pytest.mark.parametrize('payload', [[contributor()] * 11, {'invalid': True}, [{}], [contributor(contributions=-1)]])
def test_bad_contributor_payloads_are_rejected(payload):
    def handler(req):
        return httpx.Response(200, json=payload if req.url.path.endswith('/contributors') else repository())
    assert request('owner/repo', handler, endpoint='/api/contributors').status_code == 502


@pytest.mark.parametrize('endpoint', ['/api/languages', '/api/contributors'])
def test_analytics_cannot_expose_private_repositories(endpoint):
    def handler(req):
        assert req.url.path == '/repos/owner/repo'
        payload = repository(); payload['private'] = True
        return httpx.Response(200, json=payload)
    assert request('owner/repo', handler, endpoint=endpoint).status_code == 404


@pytest.mark.parametrize('endpoint', ['/api/languages', '/api/contributors'])
def test_analytics_upstream_rate_limit_is_structured(endpoint):
    def handler(req):
        if req.url.path == '/repos/owner/repo':
            return httpx.Response(200, json=repository())
        return httpx.Response(429, json={'message': 'Rate limit exceeded'}, headers={'Retry-After': '20'})
    response = request('owner/repo', handler, endpoint=endpoint)
    assert response.status_code == 429
    assert response.json()['detail']['retry_after'] == 20


def test_github_processing_is_distinct_from_empty_data():
    def handler(req):
        return httpx.Response(202) if req.url.path.endswith('/contributors') else httpx.Response(200, json=repository())
    response = request('owner/repo', handler, endpoint='/api/contributors')
    assert response.status_code == 503
    assert response.json()['detail']['code'] == 'github_processing'


# Synthetic GitHub commit payloads are used only by tests.
def commit_payload(number=1, date=None):
    at = date or (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    sha = f'{number:040x}'
    return {'sha': sha, 'html_url': f'https://github.com/canonical/repo/commit/{sha}', 'commit': {'message': 'Fix the parser\n\nFull details', 'author': {'name': 'Example author', 'date': at}, 'committer': {'name': 'Maintainer', 'date': at}}, 'author': None}


def history_handler(pages, more_until=1, inspect=None):
    def handler(req):
        if req.url.path == '/repos/owner/repo':
            return httpx.Response(200, json=repository())
        if req.url.path == '/repos/canonical/repo/commits/main':
            return httpx.Response(200, json={'sha': 'f' * 40})
        assert req.url.path == '/repos/canonical/repo/commits'
        assert req.url.params['sha'] == 'f' * 40
        assert req.url.params['per_page'] == '100'
        if inspect:
            inspect(req)
        page = int(req.url.params['page'])
        headers = {'Link': '<https://api.github.com/repos/canonical/repo/commits?page=2>; rel="next"'} if page < more_until else {}
        return httpx.Response(200, json=pages.get(page, []), headers=headers)
    return handler


def test_commit_pages_are_pinned_deduplicated_and_aggregated():
    response = request('owner/repo', history_handler({1: [commit_payload(1), commit_payload(2)], 2: [commit_payload(2), commit_payload(3)]}, more_until=2), endpoint='/api/commits', query={'days': 7})
    assert response.status_code == 200
    data = response.json()
    assert data['fetched_count'] == 3
    assert data['pages_fetched'] == 2
    assert data['complete'] is True
    assert data['has_more'] is False
    assert len(data['activity']) == 7
    assert sum(day['count'] for day in data['activity']) == 3
    assert data['commits'][0]['author_name'] == 'Example author'
    assert data['commits'][0]['author_login'] is None


def test_partial_commit_history_never_produces_a_chart():
    pages = {page: [commit_payload(page * 100 + index) for index in range(100)] for page in range(1, 6)}
    data = request('owner/repo', history_handler(pages, more_until=6), endpoint='/api/commits').json()
    assert data['fetched_count'] == 500
    assert data['complete'] is False
    assert data['has_more'] is True
    assert data['pages_fetched'] == 5
    assert data['activity'] is None
    assert 'withheld' in data['coverage_note']


def test_empty_selected_range_has_verified_zero_days():
    data = request('owner/repo', history_handler({1: []}), endpoint='/api/commits', query={'days': 90}).json()
    assert data['fetched_count'] == 0
    assert data['complete'] is True
    assert len(data['activity']) == 90
    assert sum(day['count'] for day in data['activity']) == 0


def test_empty_git_repository_has_no_invented_commits():
    def handler(req):
        if req.url.path.endswith('/commits/main'):
            return httpx.Response(409, json={'message': 'Git Repository is empty.'})
        assert req.url.path == '/repos/owner/repo'
        return httpx.Response(200, json=repository())
    data = request('owner/repo', handler, endpoint='/api/commits', query={'days': 7}).json()
    assert data['head_sha'] is None
    assert data['commits'] == []
    assert data['pages_fetched'] == 0
    assert data['complete'] is True
    assert sum(day['count'] for day in data['activity']) == 0


def test_commit_author_and_time_filters_are_sent_upstream():
    def inspect(req):
        assert req.url.params['author'] == 'example'
        start = datetime.fromisoformat(req.url.params['since'])
        end = datetime.fromisoformat(req.url.params['until'])
        assert (end.date() - start.date()).days == 6
    response = request('owner/repo', history_handler({1: [commit_payload()]}, inspect=inspect), endpoint='/api/commits', query={'days': 7, 'author': 'example'})
    assert response.status_code == 200
    assert response.json()['author_filter'] == 'example'


@pytest.mark.parametrize('query', [{'days': 8}, {'days': 365}, {'author': 'https://github.com/example'}, {'author': 'a b'}])
def test_invalid_commit_filters_do_not_fetch_history(query):
    def unexpected(req):
        pytest.fail('Invalid filters must not fetch GitHub')
    assert request('owner/repo', unexpected, endpoint='/api/commits', query=query).status_code == 422


def test_commit_history_does_not_expose_private_repository():
    def handler(req):
        assert req.url.path == '/repos/owner/repo'
        data = repository(); data['private'] = True
        return httpx.Response(200, json=data)
    assert request('owner/repo', handler, endpoint='/api/commits').status_code == 404


def test_commit_missing_committer_date_is_not_guessed():
    payload = commit_payload(); payload['commit']['committer']['date'] = None
    assert request('owner/repo', history_handler({1: [payload]}), endpoint='/api/commits').status_code == 502


def test_error_on_later_commit_page_does_not_return_a_false_chart():
    original = history_handler({1: [commit_payload()]}, more_until=2)
    def handler(req):
        if req.url.params.get('page') == '2':
            return httpx.Response(429, headers={'Retry-After': '20'}, json={'message': 'rate limit exceeded'})
        return original(req)
    response = request('owner/repo', handler, endpoint='/api/commits')
    assert response.status_code == 429
    assert 'activity' not in response.json()


# Synthetic work-item fixtures never provide application data.
def work_payload(number=1, state='open', pull=False, merged=False):
    at = '2020-01-01T12:00:00Z'
    return {'number': number, 'title': f'Work item {number}', 'html_url': f'https://github.com/canonical/repo/{"pull" if pull else "issues"}/{number}', 'state': state, 'user': {'login': 'example', 'html_url': 'https://github.com/example'}, 'comments': 0, 'created_at': at, 'updated_at': at, 'closed_at': at if state == 'closed' else None, 'merged_at': at if merged else None}


def work_handler(issue_items=None, pull_items=None, incomplete=False, counts=None):
    def handler(req):
        if req.url.path == '/repos/owner/repo':
            return httpx.Response(200, json=repository())
        if req.url.path == '/search/issues':
            assert req.url.params['per_page'] == '1'
            assert req.url.params['q'].startswith('repo:canonical/repo ')
            query = req.url.params['q'].removeprefix('repo:canonical/repo ')
            values = counts or {'is:issue is:open': 11, 'is:issue is:closed': 22, 'is:pr is:open': 33, 'is:pr is:merged': 44}
            return httpx.Response(200, json={'total_count': values[query], 'incomplete_results': incomplete})
        if req.url.path.endswith('/issues'):
            return httpx.Response(200, json=issue_items if issue_items is not None else [work_payload()], headers={'Link': '<https://api.github.com/repositories/1/issues?page=2>; rel="next"'})
        assert req.url.path.endswith('/pulls')
        return httpx.Response(200, json=pull_items if pull_items is not None else [work_payload(pull=True)])
    return handler


def test_work_summary_uses_separate_search_qualifiers_not_combined_repo_count():
    response = request('owner/repo', work_handler(), endpoint='/api/work-items/summary')
    assert response.status_code == 200
    data = response.json()
    assert data['open_issues']['value'] == 11
    assert data['closed_issues']['value'] == 22
    assert data['open_pull_requests']['value'] == 33
    assert data['merged_pull_requests']['value'] == 44
    assert data['cached'] is False


def test_incomplete_search_never_provides_an_exact_count():
    data = request('owner/repo', work_handler(incomplete=True), endpoint='/api/work-items/summary').json()
    for name in ['open_issues', 'closed_issues', 'open_pull_requests', 'merged_pull_requests']:
        assert data[name]['value'] is None
        assert data[name]['complete'] is False


def test_reported_zero_search_counts_are_preserved():
    counts = {'is:issue is:open': 0, 'is:issue is:closed': 0, 'is:pr is:open': 0, 'is:pr is:merged': 0}
    data = request('owner/repo', work_handler(counts=counts), endpoint='/api/work-items/summary').json()
    assert data['open_issues']['value'] == 0
    assert data['open_issues']['complete'] is True


def test_issue_pages_exclude_pull_requests_without_faking_page_totals():
    pr = work_payload(2, pull=True); pr['pull_request'] = {'url': 'https://api.github.com/repos/canonical/repo/pulls/2'}
    data = request('owner/repo', work_handler(issue_items=[work_payload(1), pr]), endpoint='/api/issues').json()
    assert data['scanned_count'] == 2
    assert data['returned_count'] == 1
    assert data['items'][0]['number'] == 1
    assert data['has_next'] is True
    assert 'total_count' not in data


def test_filtered_empty_issue_page_keeps_next_page_available():
    pr = work_payload(2, pull=True); pr['pull_request'] = {}
    data = request('owner/repo', work_handler(issue_items=[pr]), endpoint='/api/issues').json()
    assert data['items'] == []
    assert data['has_next'] is True


def test_issue_api_page_and_state_are_forwarded():
    original = work_handler()
    def handler(req):
        if req.url.path.endswith('/issues'):
            assert req.url.params['page'] == '2'
            assert req.url.params['per_page'] == '20'
            assert req.url.params['state'] == 'closed'
            return httpx.Response(200, json=[work_payload(state='closed')])
        return original(req)
    data = request('owner/repo', handler, endpoint='/api/issues', query={'page': 2, 'state': 'closed'}).json()
    assert data['has_previous'] is True
    assert data['items'][0]['state'] == 'closed'


@pytest.mark.parametrize('state,expected', [('all', ['open', 'closed', 'merged']), ('open', ['open']), ('closed', ['closed']), ('merged', ['merged'])])
def test_pull_request_state_filters_distinguish_closed_and_merged(state, expected):
    original = work_handler(pull_items=[work_payload(1, pull=True), work_payload(2, 'closed', pull=True), work_payload(3, 'closed', pull=True, merged=True)])
    def handler(req):
        if req.url.path.endswith('/pulls'):
            assert req.url.params['state'] == ('closed' if state == 'merged' else state)
        return original(req)
    data = request('owner/repo', handler, endpoint='/api/pull-requests', query={'state': state}).json()
    assert [item['state'] for item in data['items']] == expected


@pytest.mark.parametrize('endpoint,query', [('/api/issues', {'state': 'merged'}), ('/api/issues', {'page': 1001}), ('/api/pull-requests', {'state': 'invalid'}), ('/api/pull-requests', {'per_page': 101})])
def test_invalid_work_item_filters_are_rejected(endpoint, query):
    def unexpected(req):
        pytest.fail('Invalid filters must not query GitHub')
    assert request('owner/repo', unexpected, endpoint=endpoint, query=query).status_code == 422


@pytest.mark.parametrize('endpoint', ['/api/issues', '/api/pull-requests', '/api/work-items/summary'])
def test_work_item_snapshots_cache_and_refresh_bypass(endpoint):
    original = work_handler(); upstream = []
    def handler(req):
        upstream.append(req.url.path)
        return original(req)
    first = request('owner/repo', handler, endpoint=endpoint).json()
    baseline = len(upstream)
    second = request('owner/repo', handler, endpoint=endpoint).json()
    assert second['cached'] is True
    assert second['analyzed_at'] == first['analyzed_at']
    assert len(upstream) == baseline + 1  # Public visibility is always rechecked.
    third = request('owner/repo', handler, endpoint=endpoint, query={'refresh': 'true'}).json()
    assert third['cached'] is False
    assert len(upstream) > baseline + 2


def test_cached_public_data_is_not_served_after_repository_becomes_private():
    original = work_handler(); private = False
    def handler(req):
        if private and req.url.path == '/repos/owner/repo':
            value = repository(); value['private'] = True
            return httpx.Response(200, json=value)
        return original(req)
    assert request('owner/repo', handler, endpoint='/api/issues').status_code == 200
    private = True
    assert request('owner/repo', handler, endpoint='/api/issues').status_code == 404


def test_cache_is_scoped_to_server_credentials(monkeypatch):
    original = work_handler(); issue_calls = []
    def handler(req):
        if req.url.path.endswith('/issues'):
            issue_calls.append(req.url.path)
        return original(req)
    request('owner/repo', handler, endpoint='/api/issues')
    monkeypatch.setenv('GITHUB_TOKEN', 'test-only-scope-value')
    response = request('owner/repo', handler, endpoint='/api/issues')
    assert response.json()['cached'] is False
    assert len(issue_calls) == 2
    assert 'test-only-scope-value' not in response.text


def test_summary_rate_limit_stops_further_searches_and_is_not_cached():
    searches = []
    def handler(req):
        if req.url.path == '/repos/owner/repo':
            return httpx.Response(200, json=repository())
        searches.append(req.url.path)
        return httpx.Response(429, headers={'Retry-After': '30'}, json={'message': 'API rate limit exceeded'})
    response = request('owner/repo', handler, endpoint='/api/work-items/summary')
    assert response.status_code == 429
    assert response.json()['detail']['retry_after'] == 30
    assert len(searches) == 1
    from backend.work_items import WORK_CACHE
    assert not WORK_CACHE.entries


@pytest.mark.parametrize('payload', [{'total_count': 3}, {'total_count': -1, 'incomplete_results': False}, {'total_count': True, 'incomplete_results': False}])
def test_malformed_search_counts_are_not_used(payload):
    def handler(req):
        return httpx.Response(200, json=repository() if req.url.path == '/repos/owner/repo' else payload)
    assert request('owner/repo', handler, endpoint='/api/work-items/summary').status_code == 502


def test_malformed_work_page_is_not_cached():
    def handler(req):
        return httpx.Response(200, json=repository() if req.url.path == '/repos/owner/repo' else [{}])
    assert request('owner/repo', handler, endpoint='/api/issues').status_code == 502
    from backend.work_items import WORK_CACHE
    assert not WORK_CACHE.entries


# Synthetic complete maintenance evidence; never used by the application.
def health_handler(overrides=None, record_calls=None):
    overrides = overrides or {}
    now = datetime.now(timezone.utc)
    ago = lambda days: (now - timedelta(days=days)).isoformat()
    def handler(req):
        path = req.url.path
        if record_calls is not None:
            record_calls.append(path)
        if path in overrides:
            response = overrides[path]
            return response(req) if callable(response) else response
        if path in ('/repos/owner/repo', '/repos/canonical/repo'):
            data = repository(); data['license'] = {'key': 'mit', 'name': 'MIT License', 'spdx_id': 'MIT'}
            return httpx.Response(200, json=data)
        if path.endswith('/commits/main'):
            return httpx.Response(200, json={'sha': 'a' * 40, 'commit': {'committer': {'date': ago(1)}}})
        if path.endswith('/readme'):
            return httpx.Response(200, json={'type': 'file', 'size': 100})
        if path.endswith('/releases/latest'):
            return httpx.Response(200, json={'published_at': ago(1), 'tag_name': 'v1.0.0', 'draft': False, 'prerelease': False})
        if path == '/repos/canonical/repo/issues':
            assert req.url.params['sort'] == 'created'
            return httpx.Response(200, json=[{'number': i, 'created_at': ago(10 + i), 'comments': 1, 'user': {'login': 'reporter'}} for i in range(1, 4)])
        if path.endswith('/comments'):
            number = int(path.split('/')[-2])
            return httpx.Response(200, json=[{'created_at': ago(9 + number), 'user': {'login': 'maintainer'}, 'author_association': 'MEMBER'}])
        if path.endswith('/pulls'):
            return httpx.Response(200, json=[{'state': 'closed', 'updated_at': ago(0.5), 'merged_at': ago(1)}])
        pytest.fail('Unexpected health probe: ' + path)
    return handler


def test_health_complete_response_sums_real_factor_points():
    response = request('owner/repo', health_handler(), endpoint='/api/health')
    assert response.status_code == 200
    data = response.json()
    assert data['score'] == 100
    assert data['status'] == 'complete'
    assert data['available_weight'] == 100
    assert sum(factor['score'] for factor in data['factors']) == 100
    assert len(data['factors']) == 6
    assert all(factor['rule'] and factor['explanation'] and factor['source_urls'] for factor in data['factors'])


def test_health_permission_failure_is_unknown_not_zero():
    data = request('owner/repo', health_handler({'/repos/canonical/repo/readme': httpx.Response(403, json={'message': 'Forbidden'})}), endpoint='/api/health').json()
    factor = next(item for item in data['factors'] if item['id'] == 'readme')
    assert factor['score'] is None
    assert data['score'] is None
    assert data['status'] == 'incomplete'
    assert data['available_weight'] == 85
    assert data['lower_bound'] == 85
    assert data['upper_bound'] == 100
    assert data['cache_expires_at'] is None


def test_confirmed_absence_is_distinct_from_unavailable_health_data():
    overrides = {'/repos/canonical/repo/readme': httpx.Response(404, json={'message': 'Not Found'}), '/repos/canonical/repo/releases/latest': httpx.Response(404, json={'message': 'Not Found'})}
    data = request('owner/repo', health_handler(overrides), endpoint='/api/health').json()
    factors = {item['id']: item for item in data['factors']}
    assert factors['readme']['score'] == 0
    assert factors['releases']['score'] == 0
    assert data['score'] == 70
    assert data['status'] == 'complete'
    assert len(data['maintenance_suggestions']) == 2


def test_health_rate_limit_preserves_known_signals_and_stops_requests():
    calls = []
    overrides = {'/repos/canonical/repo/readme': httpx.Response(429, headers={'Retry-After': '20'}, json={'message': 'API rate limit exceeded'})}
    data = request('owner/repo', health_handler(overrides, calls), endpoint='/api/health').json()
    assert data['status'] == 'incomplete'
    assert data['score'] is None
    assert data['observed_points'] == 35
    assert data['rate_limited'] is True
    assert data['retry_after'] == 20
    assert not any(path.endswith('/releases/latest') or path.endswith('/issues') or path.endswith('/pulls') for path in calls)
    from backend.health_api import HEALTH_CACHE
    assert not HEALTH_CACHE.entries


def test_health_complete_cache_rechecks_public_visibility_and_can_be_refreshed():
    calls = []; handler = health_handler(record_calls=calls)
    first = request('owner/repo', handler, endpoint='/api/health').json()
    before = len(calls)
    second = request('owner/repo', handler, endpoint='/api/health').json()
    assert second['cached'] is True
    assert first['analyzed_at'] == second['analyzed_at']
    assert len(calls) == before + 1
    assert request('owner/repo', handler, endpoint='/api/health', query={'refresh': 'true'}).json()['cached'] is False
    assert len(calls) > before + 2


def test_health_cache_cannot_expose_a_now_private_repository():
    handler = health_handler(); private = False
    def dynamic(req):
        if private and req.url.path == '/repos/owner/repo':
            data = repository(); data['private'] = True
            return httpx.Response(200, json=data)
        return handler(req)
    assert request('owner/repo', dynamic, endpoint='/api/health').status_code == 200
    private = True
    assert request('owner/repo', dynamic, endpoint='/api/health').status_code == 404


def test_missing_license_field_is_unscored_not_a_claim_of_no_license():
    data = request('owner/repo', health_handler({'/repos/owner/repo': httpx.Response(200, json=repository())}), endpoint='/api/health').json()
    assert next(factor for factor in data['factors'] if factor['id'] == 'license')['score'] is None
    assert data['score'] is None


def test_too_few_mature_issues_makes_the_assessment_incomplete():
    data = request('owner/repo', health_handler({'/repos/canonical/repo/issues': httpx.Response(200, json=[])}), endpoint='/api/health').json()
    issue = next(factor for factor in data['factors'] if factor['id'] == 'issues')
    assert issue['score'] is None
    assert 'at least 3' in issue['explanation']
    assert data['score'] is None


def test_partial_pr_history_does_not_invent_latest_merge_recency():
    payload = [{'state': 'closed', 'updated_at': datetime.now(timezone.utc).isoformat(), 'merged_at': None}]
    response = httpx.Response(200, json=payload, headers={'Link': '<https://api.github.com/repos/canonical/repo/pulls?page=2>; rel="next"'})
    data = request('owner/repo', health_handler({'/repos/canonical/repo/pulls': response}), endpoint='/api/health').json()
    assert next(factor for factor in data['factors'] if factor['id'] == 'pulls')['score'] is None
    assert data['score'] is None



def test_health_deadline_preserves_completed_factors_and_explains_missing_ones():
    def expired(req):
        raise TimeoutError('Simulated collection deadline')
    data = request('owner/repo', health_handler({'/repos/canonical/repo/releases/latest': expired}), endpoint='/api/health').json()
    assert data['score'] is None
    assert data['available_weight'] == 50
    assert data['observed_points'] == 50
    assert all('deadline' in factor['explanation'] for factor in data['factors'] if factor['score'] is None)
    assert not data['rate_limited']



def test_health_looks_beyond_fresh_issue_page_without_unbounded_pagination():
    original = health_handler(); issue_pages = []
    now = datetime.now(timezone.utc)
    def handler(req):
        if req.url.path == '/repos/canonical/repo/issues':
            page = int(req.url.params['page']); issue_pages.append(page)
            if page == 1:
                return httpx.Response(200, json=[{'number': 999, 'created_at': now.isoformat(), 'comments': 0, 'user': {'login': 'reporter'}}], headers={'Link': '<https://api.github.com/repos/canonical/repo/issues?page=2>; rel="next"'})
            return original(req)
        return original(req)
    data = request('owner/repo', handler, endpoint='/api/health').json()
    assert issue_pages == [1, 2]
    assert next(factor for factor in data['factors'] if factor['id'] == 'issues')['score'] == 20


def test_health_issue_sampling_stops_after_three_pages():
    original = health_handler(); issue_pages = []
    now = datetime.now(timezone.utc)
    def handler(req):
        if req.url.path == '/repos/canonical/repo/issues':
            page = int(req.url.params['page']); issue_pages.append(page)
            return httpx.Response(200, json=[{'number': page, 'created_at': now.isoformat(), 'comments': 0, 'user': {'login': 'reporter'}}], headers={'Link': '<https://api.github.com/repos/canonical/repo/issues?page=9>; rel="next"'})
        return original(req)
    data = request('owner/repo', handler, endpoint='/api/health').json()
    assert issue_pages == [1, 2, 3]
    assert next(factor for factor in data['factors'] if factor['id'] == 'issues')['score'] is None
    assert data['score'] is None



def snapshot_handler(overrides=None, record_calls=None):
    base = health_handler(record_calls=record_calls)
    overrides = overrides or {}
    def handler(req):
        if req.url.path in overrides:
            item = overrides[req.url.path]
            return item(req) if callable(item) else item
        if req.url.path.endswith('/languages'):
            return httpx.Response(200, json={'TypeScript': 300, 'CSS': 100})
        if req.url.path.endswith('/contributors'):
            return httpx.Response(200, json=[contributor('example', 5)])
        if req.url.path == '/repos/canonical/repo/commits':
            return httpx.Response(200, json=[commit_payload()])
        return base(req)
    return handler


def test_snapshot_collects_real_services_with_coverage_and_shared_metadata():
    response = request('owner/repo', snapshot_handler(), endpoint='/api/snapshot', query={'days': 7})
    assert response.status_code == 200
    data = response.json()
    assert data['overview']['repository']['full_name'] == 'canonical/repo'
    assert data['collection_complete'] is True
    assert data['languages']['data']['total_bytes'] == 400
    assert data['contributors']['data']['returned_count'] == 1
    assert data['commits']['data']['days'] == 7
    assert data['health']['data']['score'] == 100


def test_snapshot_partial_section_never_fabricates_data():
    handler = snapshot_handler({'/repos/canonical/repo/languages': httpx.Response(403, json={'message': 'Forbidden'})})
    data = request('owner/repo', handler, endpoint='/api/snapshot').json()
    assert data['languages']['status'] == 'unavailable'
    assert data['languages']['data'] is None
    assert data['contributors']['status'] == 'available'
    assert data['collection_complete'] is False


def test_snapshot_rate_limit_stops_optional_analytics():
    calls = []
    handler = snapshot_handler({'/repos/canonical/repo/languages': httpx.Response(429, headers={'Retry-After': '10'}, json={'message': 'API rate limit exceeded'})}, calls)
    data = request('owner/repo', handler, endpoint='/api/snapshot').json()
    assert data['rate_limited'] is True
    assert data['retry_after'] == 10
    assert all(data[name]['data'] is None for name in ['languages', 'contributors', 'commits', 'health'])
    assert not any(path.endswith('/contributors') or path.endswith('/readme') for path in calls)


def test_snapshot_cache_and_explicit_refresh():
    first = request('owner/repo', snapshot_handler(), endpoint='/api/snapshot').json()
    second = request('owner/repo', snapshot_handler(), endpoint='/api/snapshot').json()
    assert second['id'] == first['id']
    assert second['cached'] is True
    third = request('owner/repo', snapshot_handler(), endpoint='/api/snapshot', query={'refresh': 'true'}).json()
    assert third['id'] != first['id']
    assert third['cached'] is False


def test_pdf_download_uses_exact_snapshot_and_has_a_valid_document():
    from pypdf import PdfReader
    from io import BytesIO
    handler = snapshot_handler()
    data = request('owner/repo', handler, endpoint='/api/snapshot').json()
    response = request('owner/repo', handler, endpoint=f'/api/reports/{data["id"]}.pdf')
    assert response.status_code == 200
    assert response.headers['content-type'] == 'application/pdf'
    assert response.headers['content-disposition'].startswith('attachment;')
    assert response.headers['x-repolens-snapshot'] == data['id']
    assert response.content.startswith(b'%PDF-')
    reader = PdfReader(BytesIO(response.content), strict=True)
    text = '\n'.join(page.extract_text() for page in reader.pages)
    assert 'canonical/repo' in text
    assert '400' in text
    assert 'Contributor sample' in text
    assert 'Commit activity' in text
    assert '100/100' in text
    assert data['id'] in text
    assert len(reader.pages) >= 5


def test_unknown_or_expired_report_snapshot_is_not_refetched_or_fabricated():
    from uuid import uuid4
    def unexpected(req):
        pytest.fail('An unknown snapshot must not start collection')
    assert request('owner/repo', unexpected, endpoint=f'/api/reports/{uuid4()}.pdf').status_code == 410


def test_pdf_cannot_serve_snapshot_after_repository_becomes_private():
    handler = snapshot_handler()
    data = request('owner/repo', handler, endpoint='/api/snapshot').json()
    private_data = repository(); private_data['private'] = True
    assert request('owner/repo', lambda req: httpx.Response(200, json=private_data), endpoint=f'/api/reports/{data["id"]}.pdf').status_code == 404


def test_snapshot_cache_is_scoped_to_server_credentials(monkeypatch):
    data = request('owner/repo', snapshot_handler(), endpoint='/api/snapshot').json()
    monkeypatch.setenv('GITHUB_TOKEN', 'test-only-new-report-scope')
    assert request('owner/repo', snapshot_handler(), endpoint=f'/api/reports/{data["id"]}.pdf').status_code == 410


def test_snapshot_rejects_unsupported_time_ranges_before_upstream_calls():
    def unexpected(req):
        pytest.fail('Invalid time ranges must not fetch GitHub')
    assert request('owner/repo', unexpected, endpoint='/api/snapshot', query={'days': 365}).status_code == 422
