import asyncio
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated
from urllib.parse import quote, urlencode, urlsplit

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError

if __package__:
    from .commit_history import CommitHistoryResponse, aggregate_commit_activity, normalize_commit
else:
    from commit_history import CommitHistoryResponse, aggregate_commit_activity, normalize_commit

load_dotenv(Path(__file__).with_name('.env'))
app = FastAPI(title='RepoLens API', version='1.0.0', description='Public GitHub repository analytics. Counts, bounded coverage, and maintenance heuristics retain their source metadata.')


@app.middleware('http')
async def response_security(request, call_next):
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['X-Frame-Options'] = 'DENY'
    # Analytics must not be stored in intermediary caches; application TTL caches remain explicit.
    response.headers['Cache-Control'] = 'no-store'
    return response

origins = os.getenv('CORS_ORIGINS', 'http://127.0.0.1:5173,http://localhost:5173')
app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in origins.split(',') if x.strip()], allow_methods=['GET'], allow_headers=['Accept'], expose_headers=['Retry-After', 'Content-Disposition', 'X-RepoLens-Snapshot'])


@app.get('/')
def home():
    return {'message': 'RepoLens API is running!', 'status': 'success'}


class RepositoryOwner(BaseModel):
    login: str
    avatar_url: str | None = None
    html_url: str | None = None


class RepositoryLicense(BaseModel):
    key: str
    name: str
    spdx_id: str | None = None


class Repository(BaseModel):
    id: int
    name: str
    full_name: str
    html_url: str
    owner: RepositoryOwner
    description: str | None
    stargazers_count: int
    forks_count: int
    open_issues_count: int  # GitHub includes open pull requests in this value.
    subscribers_count: int | None = Field(default=None, ge=0)
    size: int | None = Field(default=None, ge=0)  # GitHub reports repository size in KB.
    license: RepositoryLicense | None = None
    topics: list[str] | None = None
    default_branch: str
    language: str | None
    archived: bool
    private: bool
    created_at: datetime
    pushed_at: datetime | None


class AnalysisResponse(BaseModel):
    requested_repo: str
    repository: Repository
    analyzed_at: datetime
    source_url: str


def fail(status: int, code: str, message: str, **extra):
    headers = {'Retry-After': str(extra['retry_after'])} if extra.get('retry_after') is not None else None
    raise HTTPException(status_code=status, detail={'code': code, 'message': message, **extra}, headers=headers)


def parse_repository(value: str) -> str:
    value = value.strip()
    if '://' in value:
        try:
            url = urlsplit(value)
            if url.scheme not in ('http', 'https') or url.netloc.lower() not in ('github.com', 'www.github.com') or url.query or url.fragment:
                raise ValueError()
            value = url.path.removeprefix('/')
        except ValueError:
            fail(422, 'invalid_repository', 'Use owner/repository or a full github.com repository URL.')
    value = value.removesuffix('/').removesuffix('.git')
    parts = value.split('/')
    if len(parts) != 2:
        fail(422, 'invalid_repository', 'Use owner/repository or a full github.com repository URL.')
    owner, name = parts
    if not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?', owner) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', name) or name in ('.', '..'):
        fail(422, 'invalid_repository', 'The repository owner or name is invalid.')
    return f'{owner}/{name}'


async def github_client():
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'RepoLens'}
    token = os.getenv('GITHUB_TOKEN', '').strip()
    if token:
        headers['Authorization'] = f'Bearer {token}'
    async with httpx.AsyncClient(base_url='https://api.github.com', headers=headers, timeout=httpx.Timeout(20, connect=5), follow_redirects=True, max_redirects=5) as client:
        yield client


async def github_get(client: httpx.AsyncClient, path: str, params: dict | None = None, allow_empty_repo: bool = False):
    try:
        response = await client.get(path, params=params)
    except httpx.TimeoutException:
        fail(504, 'github_timeout', 'GitHub took too long to respond. Please try again.')
    except httpx.HTTPError:
        fail(502, 'github_unavailable', 'Unable to reach GitHub. Please try again later.')
    if response.status_code == 204:
        return response, None
    if response.status_code == 202:
        fail(503, 'github_processing', 'GitHub is preparing this data. Please retry in a few seconds.', retry_after=5)
    try:
        payload = response.json()
    except ValueError:
        fail(502, 'invalid_github_response', 'GitHub returned an unexpected response. Please try again later.')
    message = str(payload.get('message', '')) if isinstance(payload, dict) else ''
    if allow_empty_repo and response.status_code == 409 and 'empty' in message.lower():
        return response, None
    limited = response.status_code == 429 or (response.status_code == 403 and (response.headers.get('x-ratelimit-remaining') == '0' or 'rate limit' in message.lower() or 'retry-after' in response.headers))
    if limited:
        now = datetime.now(timezone.utc).timestamp()
        retry_after = 60
        reset_at = None
        try:
            if response.headers.get('x-ratelimit-remaining') == '0':
                reset = int(response.headers['x-ratelimit-reset'])
                reset_at = datetime.fromtimestamp(reset, timezone.utc).isoformat()
                retry_after = max(1, int(reset - now) + 1)
        except (KeyError, ValueError, OverflowError, OSError):
            pass
        try:
            retry_after = max(retry_after if reset_at else 1, int(response.headers['retry-after']))
        except (KeyError, ValueError):
            pass
        fail(429, 'github_rate_limited', 'GitHub API rate limit reached. Wait before trying again. A server-side GITHUB_TOKEN can increase the primary limit.', retry_after=retry_after, reset_at=reset_at)
    if response.status_code == 404:
        fail(404, 'repository_not_found', 'Repository not found or not public. Check the owner and repository name.')
    if response.status_code == 401:
        fail(502, 'github_authentication', 'GitHub rejected the server credentials. Ask the server administrator to check GITHUB_TOKEN.')
    if response.status_code == 403:
        fail(403, 'github_forbidden', 'GitHub denied access to this repository.')
    if response.status_code != 200:
        fail(502, 'github_error', 'GitHub could not complete this request. Please try again later.')
    return response, payload


@app.get('/api/analyze', response_model=AnalysisResponse)
async def analyze(repo: Annotated[str, Query(min_length=1, max_length=512)], client: Annotated[httpx.AsyncClient, Depends(github_client)]):
    requested = parse_repository(repo)
    _, payload = await github_get(client, f'/repos/{requested}')
    try:
        repository = Repository.model_validate(payload)
    except ValidationError:
        fail(502, 'invalid_github_response', 'GitHub returned incomplete repository details. Please try again later.')
    if repository.private:
        fail(404, 'repository_not_found', 'Only public repositories are supported.')
    # Canonical identity and source come from GitHub, including renamed repositories.
    return AnalysisResponse(requested_repo=requested, repository=repository, analyzed_at=datetime.now(timezone.utc), source_url=repository.html_url)


class LanguagesResponse(BaseModel):
    repository: str
    languages: dict[str, int]
    total_bytes: int
    analyzed_at: datetime
    source_url: str


class Contributor(BaseModel):
    id: int
    login: str
    html_url: str
    avatar_url: str | None = None
    contributions: int = Field(ge=0, strict=True)
    type: str = 'User'


class ContributorsResponse(BaseModel):
    repository: str
    contributors: list[Contributor]
    returned_count: int
    page: int
    per_page: int
    has_more: bool
    coverage_note: str
    analyzed_at: datetime
    source_url: str


@app.get('/api/languages', response_model=LanguagesResponse)
async def languages(repo: Annotated[str, Query(min_length=1, max_length=512)], client: Annotated[httpx.AsyncClient, Depends(github_client)]):
    # Verify public visibility even when these endpoints are called directly with a privileged server token.
    return await languages_for_repository(await analyze(repo, client), client)


async def languages_for_repository(analysis, client):
    canonical = analysis.repository.full_name
    _, payload = await github_get(client, f'/repos/{canonical}/languages')
    if not isinstance(payload, dict) or any(not isinstance(key, str) or not key or type(value) is not int or value < 0 for key, value in payload.items()):
        fail(502, 'invalid_github_response', 'GitHub returned invalid language byte counts.')
    return LanguagesResponse(repository=canonical, languages=payload, total_bytes=sum(payload.values()), analyzed_at=datetime.now(timezone.utc), source_url=f'https://api.github.com/repos/{canonical}/languages')


@app.get('/api/contributors', response_model=ContributorsResponse)
async def contributors(repo: Annotated[str, Query(min_length=1, max_length=512)], client: Annotated[httpx.AsyncClient, Depends(github_client)]):
    return await contributors_for_repository(await analyze(repo, client), client)


async def contributors_for_repository(analysis, client):
    canonical = analysis.repository.full_name
    response, payload = await github_get(client, f'/repos/{canonical}/contributors', params={'per_page': 10, 'page': 1, 'anon': 'false'})
    if response.status_code == 204:
        payload = []
    if not isinstance(payload, list) or len(payload) > 10:
        fail(502, 'invalid_github_response', 'GitHub returned an invalid contributor list.')
    try:
        entries = [Contributor.model_validate(item) for item in payload]
    except ValidationError:
        fail(502, 'invalid_github_response', 'GitHub returned incomplete contributor details.')
    entries.sort(key=lambda entry: entry.contributions, reverse=True)
    return ContributorsResponse(repository=canonical, contributors=entries, returned_count=len(entries), page=1, per_page=10, has_more='next' in response.links, coverage_note='First page only: up to 10 GitHub-ranked contributors. This is not the total contributor population. Anonymous contributors are excluded; GitHub may cache these counts.', analyzed_at=datetime.now(timezone.utc), source_url=f'https://api.github.com/repos/{canonical}/contributors?per_page=10&page=1&anon=false')


@app.get('/api/commits', response_model=CommitHistoryResponse)
async def commits(
    repo: Annotated[str, Query(min_length=1, max_length=512)],
    client: Annotated[httpx.AsyncClient, Depends(github_client)],
    days: Annotated[int, Query(ge=7, le=90)] = 30,
    author: Annotated[str | None, Query(max_length=100)] = None,
):
    if days not in (7, 30, 90):
        fail(422, 'invalid_time_range', 'Choose a supported range of 7, 30, or 90 days.')
    author = author.strip() if author else None
    if author and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_\[\]-]{0,99}', author):
        fail(422, 'invalid_author', 'Use a GitHub author login, without spaces or URL characters.')
    try:
        async with asyncio.timeout(25):
            return await fetch_commit_history(repo, client, days, author or None)
    except TimeoutError:
        fail(504, 'github_timeout', 'Retrieving commit history took too long. Try a shorter time range.')


async def fetch_commit_history(repo: str, client: httpx.AsyncClient, days: int, author: str | None, analysis=None):
    analysis = analysis or await analyze(repo, client)
    canonical = analysis.repository.full_name
    branch = analysis.repository.default_branch
    end = datetime.now(timezone.utc)
    start = (end - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    # Pin the branch tip so pagination cannot drift when new commits arrive.
    head_response, head = await github_get(client, f'/repos/{canonical}/commits/{quote(branch, safe="")}', allow_empty_repo=True)
    head_sha = None
    if head_response.status_code not in (204, 409):
        if not isinstance(head, dict) or not isinstance(head.get('sha'), str) or not re.fullmatch(r'(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})', head['sha']):
            fail(502, 'invalid_github_response', 'GitHub returned an invalid branch head.')
        head_sha = head['sha']
    max_pages, per_page = 5, 100
    entries = {}
    pages_fetched = 0
    has_more = False
    params = {'sha': head_sha or branch, 'since': start.isoformat(), 'until': end.isoformat(), 'per_page': per_page}
    if author:
        params['author'] = author
    if head_sha:
        for page in range(1, max_pages + 1):
            response, payload = await github_get(client, f'/repos/{canonical}/commits', params={**params, 'page': page}, allow_empty_repo=True)
            pages_fetched += 1
            if response.status_code in (204, 409):
                # A previously pinned nonempty branch unexpectedly disappearing is not a proven empty range.
                fail(502, 'github_history_unavailable', 'GitHub could not return the pinned commit history. Please retry.')
            if not isinstance(payload, list) or len(payload) > per_page:
                fail(502, 'invalid_github_response', 'GitHub returned an invalid commit history page.')
            try:
                for item in payload:
                    entry = normalize_commit(item)
                    if entry.html_url != f'https://github.com/{canonical}/commit/{entry.sha}':
                        raise ValueError('Invalid commit link')
                    if start <= entry.committed_at <= end:
                        entries[entry.sha] = entry
            except ValueError:
                fail(502, 'invalid_github_response', 'GitHub returned incomplete commit history. The chart cannot be calculated safely.')
            has_more = 'next' in response.links
            if not has_more:
                break
    ordered = sorted(entries.values(), key=lambda item: item.committed_at, reverse=True)
    complete = not has_more
    activity = aggregate_commit_activity(ordered, start, end) if complete else None
    coverage = (f'All {len(ordered)} commits returned for the selected UTC window on the pinned default branch.' if complete else f'Partial history: fetched {len(ordered)} unique commits across {pages_fetched} pages; additional pages exist. The activity chart is withheld because this time range is incomplete.')
    if author:
        coverage += f' Filtered by GitHub author login: {author}.'
    coverage += ' Activity uses committer timestamps and includes merge commits. Today is a partial day.'
    return CommitHistoryResponse(repository=canonical, default_branch=branch, head_sha=head_sha, commits=ordered, fetched_count=len(ordered), days=days, author_filter=author, range_start=start, range_end=end, complete=complete, has_more=has_more, pages_fetched=pages_fetched, max_pages=max_pages, per_page=per_page, activity=activity, coverage_note=coverage, analyzed_at=datetime.now(timezone.utc), source_url=f'https://api.github.com/repos/{canonical}/commits?{urlencode(params)}')


# Register the dedicated work-item APIs with the existing GitHub/public-repository dependencies.
if __package__:
    from .work_items import create_work_router
else:
    from work_items import create_work_router
app.include_router(create_work_router(analyze, github_get, github_client, fail))


if __package__:
    from .health_api import create_health_router
else:
    from health_api import create_health_router
health_router = create_health_router(analyze, github_get, github_client, fail)
app.include_router(health_router)
# Reuse the same assessment callable for exports; no internal HTTP round trip or duplicate scoring.
health_assessment = next(route.endpoint for route in health_router.routes if route.path == '/api/health')


if __package__:
    from .snapshot_api import create_snapshot_router
else:
    from snapshot_api import create_snapshot_router
app.include_router(create_snapshot_router(analyze, languages_for_repository, contributors_for_repository, fetch_commit_history, health_assessment, github_client, fail))
