"""Bounded GitHub observations for the versioned maintenance scoring engine."""
import asyncio
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

if __package__:
    from .health_scoring import Observation, score_observations, HealthResponse, METHOD_VERSION
    from .work_items import SnapshotCache, cache_scope
else:
    from health_scoring import Observation, score_observations, HealthResponse, METHOD_VERSION
    from work_items import SnapshotCache, cache_scope

HEALTH_CACHE = SnapshotCache(capacity=64)
ASSOCIATED = {'OWNER', 'MEMBER', 'COLLABORATOR'}


def parse_date(value):
    if not isinstance(value, str):
        raise ValueError('Missing activity timestamp')
    date = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if date.tzinfo is None:
        raise ValueError('Timestamp timezone is unavailable')
    return date.astimezone(timezone.utc)


def acknowledgement_in_first_page(issue, comments, has_more):
    created = parse_date(issue.get('created_at'))
    deadline = created + timedelta(days=7)
    user = issue.get('user') or {}
    author = user.get('login') if isinstance(user, dict) else None
    if not isinstance(author, str) or not isinstance(comments, list) or len(comments) > 100:
        raise ValueError('Issue author or comment identity is unavailable')
    previous = None
    uncertain = False
    for comment in comments:
        if not isinstance(comment, dict):
            raise ValueError('Invalid comment payload')
        date = parse_date(comment.get('created_at'))
        if date < created or (previous is not None and date < previous):
            raise ValueError('Comment creation order is inconsistent')
        previous = date
        if date > deadline:
            continue
        user = comment.get('user') or {}
        if not isinstance(user, dict) or not isinstance(user.get('login'), str) or not isinstance(comment.get('author_association'), str):
            uncertain = True
            continue
        if user['login'].casefold() != author.casefold() and comment['author_association'] in ASSOCIATED:
            return True
    if uncertain or has_more:
        raise ValueError('The bounded comment page cannot establish acknowledgement within 7 days')
    return False


def latest_provable_merge(payload, has_more):
    if not isinstance(payload, list):
        raise ValueError('Closed pull-request history is unavailable')
    updated = []
    merges = []
    for item in payload:
        if not isinstance(item, dict) or item.get('state') != 'closed':
            raise ValueError('Invalid closed pull-request payload')
        changed = parse_date(item.get('updated_at'))
        updated.append(changed)
        if item.get('merged_at') is not None:
            merged = parse_date(item['merged_at'])
            if merged > changed:
                raise ValueError('Merge timestamp is later than the last update')
            merges.append(merged)
    if updated != sorted(updated, reverse=True):
        raise ValueError('Closed pull requests were not ordered by most recent update')
    latest = max(merges) if merges else None
    if has_more and (latest is None or not updated or latest < min(updated)):
        raise ValueError('Additional PR pages may contain a newer merge; recency cannot be established safely')
    return latest


def create_health_router(analyze, github_get, github_client, fail):
    router = APIRouter()

    @router.get('/api/health', response_model=HealthResponse)
    async def repository_health(repo: Annotated[str, Query(min_length=1, max_length=512)], client: Annotated[httpx.AsyncClient, Depends(github_client)], refresh: bool = False):
        started = time.monotonic()
        try:
            async with asyncio.timeout(24):
                analysis = await analyze(repo, client)
        except TimeoutError:
            fail(504, 'github_timeout', 'GitHub repository verification took too long. Please retry later.')
        repository = analysis.repository
        canonical = repository.full_name
        key = (cache_scope(), canonical, METHOD_VERSION)
        cached = None if refresh else HEALTH_CACHE.get(key)
        if cached is not None:
            return HealthResponse.model_validate({**cached, 'cached': True})
        now = datetime.now(timezone.utc)
        observations = {}
        rate = None
        if 'license' not in repository.model_fields_set:
            observations['license'] = Observation(False, explanation='GitHub did not provide license detection metadata.', source_urls=[f'https://api.github.com/repos/{canonical}'])
        else:
            license = repository.license
            category = 'none' if license is None else 'recognized' if license.spdx_id and license.spdx_id != 'NOASSERTION' else 'custom'
            observations['license'] = Observation(True, category, explanation='GitHub reports no detected license.' if license is None else f'GitHub detected {license.name} (SPDX: {license.spdx_id or "unrecognized"}).', source_urls=[f'https://api.github.com/repos/{canonical}'])

        async def collect(key, sources, callback, absence=None):
            nonlocal rate
            if rate is not None:
                observations[key] = Observation(False, explanation='Collection stopped after a GitHub rate limit. Retry when the cooldown ends.', source_urls=sources)
                return
            try:
                observation = await callback()
                observations[key] = observation
            except HTTPException as error:
                detail = error.detail if isinstance(error.detail, dict) else {}
                if error.status_code == 404 and absence is not None:
                    observations[key] = Observation(True, absence[0], explanation=absence[1], source_urls=sources)
                else:
                    observations[key] = Observation(False, explanation=detail.get('message', 'GitHub did not provide this signal.'), source_urls=sources)
                    if error.status_code == 429:
                        rate = max(1, detail.get('retry_after', 60))
            except (ValueError, TypeError, KeyError) as error:
                observations[key] = Observation(False, explanation=str(error), source_urls=sources)

        commit_source = f'https://api.github.com/repos/{canonical}/commits/{quote(repository.default_branch, safe="")}'
        async def commit_signal():
            response, payload = await github_get(client, f'/repos/{canonical}/commits/{quote(repository.default_branch, safe="")}', allow_empty_repo=True)
            if response.status_code in (204, 409):
                return Observation(True, None, explanation='GitHub confirms an empty repository with no default-branch commit.', source_urls=[commit_source])
            if not isinstance(payload, dict) or not isinstance(payload.get('commit'), dict) or not isinstance(payload['commit'].get('committer'), dict):
                raise ValueError('Default-branch commit timestamp is unavailable')
            return Observation(True, parse_date(payload['commit']['committer'].get('date')), evidence=[f'Default branch: {repository.default_branch}', f'Commit SHA: {payload.get("sha", "not reported")}'], source_urls=[commit_source])

        readme_source = f'https://api.github.com/repos/{canonical}/readme'
        async def readme_signal():
            _, payload = await github_get(client, f'/repos/{canonical}/readme')
            if not isinstance(payload, dict) or payload.get('type') != 'file' or type(payload.get('size')) is not int or payload['size'] < 0:
                raise ValueError('README file size could not be verified')
            return Observation(True, payload['size'], source_urls=[readme_source])

        release_source = f'https://api.github.com/repos/{canonical}/releases/latest'
        async def release_signal():
            _, payload = await github_get(client, f'/repos/{canonical}/releases/latest')
            if not isinstance(payload, dict) or payload.get('draft') is not False or payload.get('prerelease') is not False:
                raise ValueError('A published stable GitHub release could not be verified')
            return Observation(True, parse_date(payload.get('published_at')), evidence=[f'Stable release tag: {payload.get("tag_name", "not reported")}'], source_urls=[release_source])

        issue_source = f'https://api.github.com/repos/{canonical}/issues?state=all&sort=created&direction=desc&per_page=100'
        async def issue_signal():
            mature = []
            seen_numbers = set()
            scanned = 0
            pages = 0
            sources = []
            for page in range(1, 4):
                response, payload = await github_get(client, f'/repos/{canonical}/issues', params={'state': 'all', 'sort': 'created', 'direction': 'desc', 'per_page': 100, 'page': page})
                sources.append(issue_source + f'&page={page}')
                pages += 1
                if not isinstance(payload, list) or len(payload) > 100:
                    raise ValueError('Issue sampling data is unavailable')
                scanned += len(payload)
                for item in payload:
                    if not isinstance(item, dict):
                        raise ValueError('Invalid issue sampling record')
                    if 'pull_request' in item:
                        continue
                    created = parse_date(item.get('created_at'))
                    if created <= now - timedelta(days=7):
                        if type(item.get('number')) is not int or item['number'] <= 0:
                            raise ValueError('Issue identity is unavailable')
                        if item['number'] not in seen_numbers:
                            seen_numbers.add(item['number'])
                            mature.append((created, item))
                if len(mature) >= 5 or 'next' not in response.links:
                    break
            selected = [item for _, item in sorted(mature, key=lambda pair: pair[0], reverse=True)[:5]]
            if len(selected) < 3:
                raise ValueError(f'Only {len(selected)} mature issues found in {scanned} raw items across {pages} bounded pages; at least 3 are required. No responsiveness score is assigned.')
            acknowledged = 0
            evidence = [f'Sampled {len(selected)} mature issues from {scanned} raw issue/PR items across {pages} pages.', 'This is a sample; not all issues or maintainer replies are measured.']
            for item in selected:
                number = item['number']
                source = f'https://api.github.com/repos/{canonical}/issues/{number}/comments?per_page=100'
                sources.append(source)
                if type(item.get('comments')) is int and item['comments'] == 0:
                    answer = False
                else:
                    result, comments = await github_get(client, f'/repos/{canonical}/issues/{number}/comments', params={'per_page': 100})
                    answer = acknowledgement_in_first_page(item, comments, 'next' in result.links)
                acknowledged += int(answer)
                evidence.append(f'Issue #{number}: {"qualifying acknowledgement within 7 days" if answer else "no qualifying acknowledgement within 7 days"}.')
            return Observation(True, {'sample_size': len(selected), 'acknowledged': acknowledged}, evidence=evidence, source_urls=sources)

        pull_source = f'https://api.github.com/repos/{canonical}/pulls?state=closed&sort=updated&direction=desc&per_page=100'
        async def pull_signal():
            response, payload = await github_get(client, f'/repos/{canonical}/pulls', params={'state': 'closed', 'sort': 'updated', 'direction': 'desc', 'per_page': 100})
            if not isinstance(payload, list) or len(payload) > 100:
                raise ValueError('Closed-PR sample is unavailable')
            latest = latest_provable_merge(payload, 'next' in response.links)
            return Observation(True, latest, explanation='Closed-PR list exhausted; no merged PRs were reported.' if latest is None else 'Merge recency established from a bounded, update-ordered closed-PR sample.', evidence=[f'Scanned {len(payload)} closed PRs.', f'Additional pages reported: {"yes" if "next" in response.links else "no"}.'], source_urls=[pull_source])

        try:
            async with asyncio.timeout(max(0.001, 24 - (time.monotonic() - started))):
                await collect('commits', [commit_source], commit_signal)
                await collect('readme', [readme_source], readme_signal, (0, 'GitHub confirms no repository README was found.'))
                await collect('releases', [release_source], release_signal, (None, 'GitHub reports no latest stable release. Other release channels are not assessed.'))
                await collect('issues', [issue_source], issue_signal)
                await collect('pulls', [pull_source], pull_signal)
        except TimeoutError:
            # Preserve completed factors but never invent values for uncollected signals.
            for name, source in [('commits', commit_source), ('readme', readme_source), ('releases', release_source), ('issues', issue_source), ('pulls', pull_source)]:
                observations.setdefault(name, Observation(False, explanation='The collection deadline expired before this signal could be assessed. Retry later.', source_urls=[source]))
        result = score_observations(canonical, observations, datetime.now(timezone.utc))
        if rate is not None:
            result.rate_limited = True
            result.retry_after = rate
        if result.status == 'complete':
            result.cache_expires_at = result.analyzed_at + timedelta(seconds=120)
            HEALTH_CACHE.put(key, result.model_dump(), 120)
        return result

    return router
