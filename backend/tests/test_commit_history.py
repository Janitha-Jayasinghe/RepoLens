from datetime import datetime, timezone
import pytest
from backend.commit_history import aggregate_commit_activity, normalize_commit


def raw(sha='a' * 40, committed='2020-01-02T10:00:00Z', authored='2019-01-01T00:00:00Z'):
    return {'sha': sha, 'html_url': f'https://github.com/owner/repo/commit/{sha}', 'commit': {'message': 'Subject\n\nBody', 'author': {'name': 'Git author', 'email': 'unused@example.test', 'date': authored}, 'committer': {'date': committed}}, 'author': None}


def test_normalization_preserves_message_git_author_and_actual_committer_date():
    record = normalize_commit(raw())
    assert record.message == 'Subject\n\nBody'
    assert record.author_name == 'Git author'
    assert record.author_login is None
    assert record.committed_at.year == 2020
    assert record.authored_at.year == 2019
    assert 'email' not in record.model_dump()


def test_linked_author_is_kept_separate_from_git_author_name():
    payload = raw(); payload['author'] = {'login': 'example', 'html_url': 'https://github.com/example', 'avatar_url': 'https://avatars.githubusercontent.com/u/1'}
    record = normalize_commit(payload)
    assert record.author_name == 'Git author'
    assert record.author_login == 'example'


@pytest.mark.parametrize('payload', [None, {}, raw(sha='bad'), raw(committed=None), raw(committed='2020-01-01T00:00:00')])
def test_bad_commit_fields_are_not_replaced_with_fabricated_dates(payload):
    with pytest.raises(ValueError):
        normalize_commit(payload)


def test_aggregation_uses_utc_committer_dates_and_deduplicates():
    start = datetime(2020, 1, 1, tzinfo=timezone.utc)
    end = datetime(2020, 1, 3, 23, 59, tzinfo=timezone.utc)
    records = [normalize_commit(raw()), normalize_commit(raw()), normalize_commit(raw('b' * 40, '2020-01-03T01:00:00+02:00')), normalize_commit(raw('c' * 40, '2020-01-04T00:00:00Z'))]
    days = aggregate_commit_activity(records, start, end)
    assert [day.model_dump() for day in days] == [{'date': '2020-01-01', 'count': 0}, {'date': '2020-01-02', 'count': 2}, {'date': '2020-01-03', 'count': 0}]


def test_range_boundaries_are_inclusive():
    start = datetime(2020, 1, 1, tzinfo=timezone.utc)
    end = datetime(2020, 1, 1, 12, tzinfo=timezone.utc)
    records = [normalize_commit(raw('a' * 40, start.isoformat())), normalize_commit(raw('b' * 40, end.isoformat())), normalize_commit(raw('c' * 40, '2020-01-01T12:00:01Z'))]
    assert aggregate_commit_activity(records, start, end)[0].count == 2


def test_naive_or_reversed_aggregation_bounds_are_rejected():
    with pytest.raises(ValueError):
        aggregate_commit_activity([], datetime(2020, 1, 1), datetime(2020, 1, 2))
    with pytest.raises(ValueError):
        aggregate_commit_activity([], datetime(2020, 1, 2, tzinfo=timezone.utc), datetime(2020, 1, 1, tzinfo=timezone.utc))
