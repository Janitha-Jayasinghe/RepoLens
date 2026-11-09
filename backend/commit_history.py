"""Commit normalization and UTC aggregation. No statistics are inferred from partial pages."""
from datetime import datetime, timedelta, timezone
import re

from pydantic import AwareDatetime, BaseModel, Field, ValidationError


class CommitRecord(BaseModel):
    sha: str
    html_url: str
    message: str
    author_name: str | None
    author_login: str | None
    author_url: str | None
    avatar_url: str | None
    authored_at: AwareDatetime | None
    committed_at: AwareDatetime


class CommitActivityDay(BaseModel):
    date: str
    count: int = Field(ge=0)


class CommitHistoryResponse(BaseModel):
    repository: str
    default_branch: str
    head_sha: str | None
    commits: list[CommitRecord]
    fetched_count: int
    days: int
    author_filter: str | None
    range_start: AwareDatetime
    range_end: AwareDatetime
    complete: bool
    has_more: bool
    pages_fetched: int
    max_pages: int
    per_page: int
    activity: list[CommitActivityDay] | None
    coverage_note: str
    analyzed_at: AwareDatetime
    source_url: str


def normalize_commit(payload: object) -> CommitRecord:
    if not isinstance(payload, dict):
        raise ValueError('Commit must be an object')
    sha = payload.get('sha')
    details = payload.get('commit')
    if not isinstance(sha, str) or not re.fullmatch(r'(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})', sha) or not isinstance(details, dict):
        raise ValueError('Missing commit identity')
    author = details.get('author') or {}
    committer = details.get('committer') or {}
    profile = payload.get('author') or {}
    if not all(isinstance(item, dict) for item in [author, committer, profile]):
        raise ValueError('Invalid commit author')
    try:
        return CommitRecord(sha=sha, html_url=payload.get('html_url'), message=details.get('message'), author_name=author.get('name'), author_login=profile.get('login'), author_url=profile.get('html_url'), avatar_url=profile.get('avatar_url'), authored_at=author.get('date'), committed_at=committer.get('date'))
    except ValidationError as error:
        raise ValueError('Incomplete commit fields') from error


def aggregate_commit_activity(commits: list[CommitRecord], start: datetime, end: datetime) -> list[CommitActivityDay]:
    """Call only once the entire bounded query is exhausted. Empty dates can then be true zeros."""
    if start.tzinfo is None or end.tzinfo is None or start > end:
        raise ValueError('A valid timezone-aware range is required')
    start = start.astimezone(timezone.utc)
    end = end.astimezone(timezone.utc)
    counts = {}
    day = start.date()
    while day <= end.date():
        counts[day.isoformat()] = 0
        day += timedelta(days=1)
    seen = set()
    for commit in commits:
        if commit.sha in seen:
            continue
        seen.add(commit.sha)
        timestamp = commit.committed_at.astimezone(timezone.utc)
        if start <= timestamp <= end:
            counts[timestamp.date().isoformat()] += 1
    return [CommitActivityDay(date=date, count=count) for date, count in counts.items()]
