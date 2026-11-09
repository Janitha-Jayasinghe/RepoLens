"""Immutable, expiring analytics snapshots shared by comparison and PDF reports."""
import asyncio
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import AwareDatetime, BaseModel, model_validator
from starlette.concurrency import run_in_threadpool

if __package__:
    from .work_items import SnapshotCache, cache_scope
    from .pdf_reports import render_report
else:
    from work_items import SnapshotCache, cache_scope
    from pdf_reports import render_report

SNAPSHOT_STORE = SnapshotCache(capacity=64)
SNAPSHOT_LOOKUP = SnapshotCache(capacity=64)


class SectionError(BaseModel):
    code: str
    message: str
    status: int
    retry_after: int | None = None


class SnapshotSection(BaseModel):
    status: Literal['available', 'unavailable']
    data: dict[str, Any] | None = None
    error: SectionError | None = None

    @model_validator(mode='after')
    def consistent(self):
        if (self.status == 'available' and (self.data is None or self.error is not None)) or (self.status == 'unavailable' and (self.data is not None or self.error is None)):
            raise ValueError('Section availability must match its data/error')
        return self


class AnalyticsSnapshot(BaseModel):
    id: UUID
    overview: dict[str, Any]
    days: Literal[7, 30, 90]
    languages: SnapshotSection
    contributors: SnapshotSection
    commits: SnapshotSection
    health: SnapshotSection
    analyzed_at: AwareDatetime
    expires_at: AwareDatetime
    cached: bool
    collection_complete: bool
    rate_limited: bool
    retry_after: int | None
    notes: list[str]


def create_snapshot_router(analyze, languages_service, contributors_service, commits_service, health_service, github_client, fail):
    router = APIRouter()

    @router.get('/api/snapshot', response_model=AnalyticsSnapshot)
    async def snapshot(repo: Annotated[str, Query(min_length=1, max_length=512)], client: Annotated[httpx.AsyncClient, Depends(github_client)], days: int = 30, refresh: bool = False):
        if days not in (7, 30, 90):
            fail(422, 'invalid_time_range', 'Choose 7, 30, or 90 days for commit analytics.')
        started = time.monotonic()
        try:
            async with asyncio.timeout(55):
                overview = await analyze(repo, client)
        except TimeoutError:
            fail(504, 'snapshot_timeout', 'Repository verification took too long. Please retry.')
        canonical = overview.repository.full_name
        scope = cache_scope()
        key = (scope, canonical, days)
        identifier = None if refresh else SNAPSHOT_LOOKUP.get(key)
        stored = SNAPSHOT_STORE.get((scope, identifier)) if identifier else None
        if stored is not None:
            return AnalyticsSnapshot.model_validate({**stored, 'cached': True})
        sections = {}
        retry_after = None

        async def collect(name, callback):
            nonlocal retry_after
            if retry_after is not None:
                sections[name] = SnapshotSection(status='unavailable', error=SectionError(code='github_rate_limited', message='Collection stopped after a GitHub rate limit.', status=429, retry_after=retry_after))
                return
            try:
                result = await callback()
                sections[name] = SnapshotSection(status='available', data=result.model_dump(mode='json'))
                if name == 'health' and result.rate_limited:
                    retry_after = result.retry_after or 60
            except HTTPException as error:
                detail = error.detail if isinstance(error.detail, dict) else {}
                wait = detail.get('retry_after')
                sections[name] = SnapshotSection(status='unavailable', error=SectionError(code=detail.get('code', 'upstream_error'), message=detail.get('message', 'This analytics section is unavailable.'), status=error.status_code, retry_after=wait))
                if error.status_code == 429:
                    retry_after = wait or 60

        try:
            async with asyncio.timeout(max(0.001, 55 - (time.monotonic() - started))):
                await collect('languages', lambda: languages_service(overview, client))
                await collect('contributors', lambda: contributors_service(overview, client))
                await collect('commits', lambda: commits_service(canonical, client, days, None, analysis=overview))
                await collect('health', lambda: health_service(canonical, client))
        except TimeoutError:
            pass
        for name in ('languages', 'contributors', 'commits', 'health'):
            sections.setdefault(name, SnapshotSection(status='unavailable', error=SectionError(code='snapshot_timeout', message='The snapshot collection deadline expired. This section is omitted.', status=504)))
        now = datetime.now(timezone.utc)
        result = AnalyticsSnapshot(id=uuid4(), overview=overview.model_dump(mode='json'), days=days, **sections, analyzed_at=now, expires_at=now + timedelta(minutes=5), cached=False, collection_complete=all(section.status == 'available' for section in sections.values()), rate_limited=retry_after is not None, retry_after=retry_after, notes=['Metrics are independent snapshots, not an atomic GitHub transaction or a ranking of repository quality.', 'Contributors are the returned top-10 page, not the total contributor population.', 'Commit charts/totals cover only an exhausted selected UTC window; partial histories are never extrapolated.', 'Maintenance is an explainable heuristic; incomplete health assessments have no overall score.'])
        SNAPSHOT_STORE.put((scope, str(result.id)), result.model_dump(mode='json'), 300)
        if retry_after is None:
            SNAPSHOT_LOOKUP.put(key, str(result.id), 120)
        return result

    @router.get('/api/reports/{snapshot_id}.pdf', response_class=Response)
    async def report(snapshot_id: UUID, client: Annotated[httpx.AsyncClient, Depends(github_client)]):
        stored = SNAPSHOT_STORE.get((cache_scope(), str(snapshot_id)))
        if stored is None:
            fail(410, 'snapshot_expired', 'The report snapshot expired or is unavailable. Prepare a new snapshot before exporting.')
        canonical = stored['overview']['repository']['full_name']
        # Do not serve cached public analytics after visibility becomes private.
        await analyze(canonical, client)
        document = await run_in_threadpool(render_report, stored)
        safe_name = re.sub(r'[^A-Za-z0-9_.-]', '-', canonical)
        date = datetime.fromisoformat(stored['analyzed_at'].replace('Z', '+00:00')).strftime('%Y%m%d')
        return Response(document, media_type='application/pdf', headers={'Content-Disposition': f'attachment; filename="repolens-{safe_name}-{date}.pdf"', 'Cache-Control': 'private, no-store', 'X-RepoLens-Snapshot': str(snapshot_id)})

    return router
