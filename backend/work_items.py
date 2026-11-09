"""Issue/PR analytics with independent search counts and bounded page caches."""
import asyncio
import hashlib
import os
import time
from collections import OrderedDict
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Query
from pydantic import AwareDatetime, BaseModel, Field, ValidationError


class SnapshotCache:
    def __init__(self, capacity=128, clock=None):
        self.capacity = capacity
        self.clock = clock or time.monotonic
        self.entries = OrderedDict()

    def get(self, key):
        entry = self.entries.get(key)
        if not entry:
            return None
        expires, value = entry
        if self.clock() >= expires:
            del self.entries[key]
            return None
        self.entries.move_to_end(key)
        return deepcopy(value)

    def put(self, key, value, ttl):
        self.entries[key] = (self.clock() + ttl, deepcopy(value))
        self.entries.move_to_end(key)
        while len(self.entries) > self.capacity:
            self.entries.popitem(last=False)

    def clear(self):
        self.entries.clear()


WORK_CACHE = SnapshotCache()


def cache_scope():
    # Never put the actual server token in a key or response.
    return hashlib.sha256(os.getenv('GITHUB_TOKEN', '').encode()).hexdigest()


class WorkCount(BaseModel):
    value: int | None = Field(ge=0)
    complete: bool
    source_url: str
    note: str


class WorkSummaryResponse(BaseModel):
    repository: str
    open_issues: WorkCount
    closed_issues: WorkCount
    open_pull_requests: WorkCount
    merged_pull_requests: WorkCount
    analyzed_at: AwareDatetime
    cached: bool
    cache_expires_at: AwareDatetime
    coverage_note: str


class WorkItem(BaseModel):
    number: int = Field(gt=0, strict=True)
    title: str
    html_url: str
    state: Literal['open', 'closed', 'merged']
    author_login: str | None
    author_url: str | None
    comments: int | None = Field(default=None, ge=0, strict=True)
    created_at: AwareDatetime
    updated_at: AwareDatetime
    closed_at: AwareDatetime | None
    merged_at: AwareDatetime | None


class WorkPageResponse(BaseModel):
    repository: str
    kind: Literal['issues', 'pulls']
    state_filter: str
    items: list[WorkItem]
    page: int
    per_page: int
    scanned_count: int
    returned_count: int
    has_next: bool
    has_previous: bool
    analyzed_at: AwareDatetime
    cached: bool
    cache_expires_at: AwareDatetime
    coverage_note: str
    source_url: str


def normalize_work_item(payload, kind, canonical):
    if not isinstance(payload, dict):
        raise ValueError('Invalid work item')
    if kind == 'issues' and 'pull_request' in payload:
        return None
    user = payload.get('user') or {}
    if not isinstance(user, dict):
        raise ValueError('Invalid author')
    state = payload.get('state')
    merged_at = payload.get('merged_at') if kind == 'pulls' else None
    if state not in ('open', 'closed') or (merged_at is not None and state != 'closed'):
        raise ValueError('Invalid issue/PR state')
    state = 'merged' if merged_at is not None else state
    try:
        item = WorkItem(number=payload.get('number'), title=payload.get('title'), html_url=payload.get('html_url'), state=state, author_login=user.get('login'), author_url=user.get('html_url'), comments=payload.get('comments'), created_at=payload.get('created_at'), updated_at=payload.get('updated_at'), closed_at=payload.get('closed_at'), merged_at=merged_at)
    except ValidationError as error:
        raise ValueError('Incomplete work item') from error
    path = 'issues' if kind == 'issues' else 'pull'
    if item.html_url != f'https://github.com/{canonical}/{path}/{item.number}':
        raise ValueError('Unexpected issue/PR link')
    return item


def normalize_work_page(payload, kind, canonical, state):
    if not isinstance(payload, list):
        raise ValueError('Expected a page of work items')
    items = []
    seen = set()
    for raw in payload:
        item = normalize_work_item(raw, kind, canonical)
        if item is None or (state != 'all' and item.state != state) or item.number in seen:
            continue
        seen.add(item.number)
        items.append(item)
    return sorted(items, key=lambda item: item.updated_at, reverse=True)


def create_work_router(analyze, github_get, github_client, fail):
    router = APIRouter()

    async def summary_data(repo, client, refresh):
        analysis = await analyze(repo, client)
        canonical = analysis.repository.full_name
        key = (cache_scope(), canonical, 'summary')
        cached = None if refresh else WORK_CACHE.get(key)
        if cached is not None:
            return WorkSummaryResponse.model_validate({**cached, 'cached': True})
        queries = {'open_issues': 'is:issue is:open', 'closed_issues': 'is:issue is:closed', 'open_pull_requests': 'is:pr is:open', 'merged_pull_requests': 'is:pr is:merged'}
        counts = {}
        for name, qualifiers in queries.items():
            params = {'q': f'repo:{canonical} {qualifiers}', 'per_page': 1, 'page': 1}
            _, payload = await github_get(client, '/search/issues', params=params)
            if not isinstance(payload, dict) or type(payload.get('total_count')) is not int or payload['total_count'] < 0 or type(payload.get('incomplete_results')) is not bool:
                fail(502, 'invalid_github_response', 'GitHub returned an invalid issue/PR search count.')
            complete = not payload['incomplete_results']
            counts[name] = WorkCount(value=payload['total_count'] if complete else None, complete=complete, source_url='https://api.github.com/search/issues?' + urlencode(params), note='GitHub search-reported count; indexing may lag.' if complete else 'GitHub marked this search incomplete. No exact count is shown.')
        now = datetime.now(timezone.utc)
        result = WorkSummaryResponse(repository=canonical, **counts, analyzed_at=now, cached=False, cache_expires_at=now + timedelta(seconds=120), coverage_note='GitHub search snapshots, independent of the table pages. Counts may lag repository changes due to search indexing. Issues exclude pull requests. Merged pull requests are a subset of closed pull requests.')
        WORK_CACHE.put(key, result.model_dump(), 120)
        return result

    async def page_data(repo, client, kind, state, page, per_page, refresh):
        allowed = ('all', 'open', 'closed') if kind == 'issues' else ('all', 'open', 'closed', 'merged')
        if state not in allowed:
            fail(422, 'invalid_state', 'Choose a valid issue or pull-request state.')
        analysis = await analyze(repo, client)
        canonical = analysis.repository.full_name
        key = (cache_scope(), canonical, kind, state, page, per_page)
        cached = None if refresh else WORK_CACHE.get(key)
        if cached is not None:
            return WorkPageResponse.model_validate({**cached, 'cached': True})
        upstream_state = 'closed' if state == 'merged' else state
        params = {'state': upstream_state, 'sort': 'updated', 'direction': 'desc', 'page': page, 'per_page': per_page}
        response, payload = await github_get(client, f'/repos/{canonical}/{kind}', params=params)
        if response.status_code == 204:
            payload = []
        if not isinstance(payload, list) or len(payload) > per_page:
            fail(502, 'invalid_github_response', 'GitHub returned an invalid issue/PR page.')
        try:
            items = normalize_work_page(payload, kind, canonical, state)
        except ValueError:
            fail(502, 'invalid_github_response', 'GitHub returned incomplete issue/PR details.')
        now = datetime.now(timezone.utc)
        note = ('Pull requests are removed from GitHub issue pages.' if kind == 'issues' else 'Merged is detected from merged_at. The Closed filter excludes merged pull requests.')
        note += ' Pagination follows raw GitHub pages; filtering can leave a short or empty page. Returned rows are not repository-wide totals. Concurrent repository updates may change pagination.'
        result = WorkPageResponse(repository=canonical, kind=kind, state_filter=state, items=items, page=page, per_page=per_page, scanned_count=len(payload), returned_count=len(items), has_next='next' in response.links, has_previous=page > 1, analyzed_at=now, cached=False, cache_expires_at=now + timedelta(seconds=60), coverage_note=note, source_url=f'https://api.github.com/repos/{canonical}/{kind}?' + urlencode(params))
        WORK_CACHE.put(key, result.model_dump(), 60)
        return result

    @router.get('/api/work-items/summary', response_model=WorkSummaryResponse)
    async def work_summary(repo: Annotated[str, Query(min_length=1, max_length=512)], client: Annotated[httpx.AsyncClient, Depends(github_client)], refresh: bool = False):
        try:
            async with asyncio.timeout(25):
                return await summary_data(repo, client, refresh)
        except TimeoutError:
            fail(504, 'github_timeout', 'Issue and pull-request summary took too long. Please retry later.')

    @router.get('/api/issues', response_model=WorkPageResponse)
    async def issues_page(repo: Annotated[str, Query(min_length=1, max_length=512)], client: Annotated[httpx.AsyncClient, Depends(github_client)], state: str = 'all', page: Annotated[int, Query(ge=1, le=1000)] = 1, per_page: Annotated[int, Query(ge=1, le=100)] = 20, refresh: bool = False):
        return await page_data(repo, client, 'issues', state, page, per_page, refresh)

    @router.get('/api/pull-requests', response_model=WorkPageResponse)
    async def pulls_page(repo: Annotated[str, Query(min_length=1, max_length=512)], client: Annotated[httpx.AsyncClient, Depends(github_client)], state: str = 'all', page: Annotated[int, Query(ge=1, le=1000)] = 1, per_page: Annotated[int, Query(ge=1, le=100)] = 20, refresh: bool = False):
        return await page_data(repo, client, 'pulls', state, page, per_page, refresh)

    return router
