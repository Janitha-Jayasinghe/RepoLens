import pytest
from backend.work_items import SnapshotCache, normalize_work_page


def payload(number=1, state='open', merged=False):
    at = '2020-01-01T00:00:00Z'
    return {'number': number, 'title': 'Example PR', 'html_url': f'https://github.com/owner/repo/pull/{number}', 'state': state, 'merged_at': at if merged else None, 'closed_at': at if state == 'closed' else None, 'created_at': at, 'updated_at': at, 'user': None}


def test_cache_expires_and_copies_values():
    now = [0]
    cache = SnapshotCache(clock=lambda: now[0])
    source = {'count': 1}; cache.put('a', source, 60); source['count'] = 9
    result = cache.get('a'); assert result['count'] == 1
    result['count'] = 8; assert cache.get('a')['count'] == 1
    now[0] = 60; assert cache.get('a') is None


def test_cache_capacity_evicts_least_recently_used():
    cache = SnapshotCache(capacity=2)
    cache.put('a', {}, 60); cache.put('b', {}, 60); cache.get('a'); cache.put('c', {}, 60)
    assert cache.get('b') is None
    assert cache.get('a') == {}


def test_merge_timestamp_drives_normalized_state_and_comments_stay_unknown():
    item = normalize_work_page([payload(state='closed', merged=True)], 'pulls', 'owner/repo', 'merged')[0]
    assert item.state == 'merged'
    assert item.comments is None
    assert item.author_login is None


def test_repeated_work_item_numbers_are_not_double_counted():
    assert len(normalize_work_page([payload(), payload()], 'pulls', 'owner/repo', 'all')) == 1


@pytest.mark.parametrize('value', [None, {}, [payload(state='merged')], [payload(state='open', merged=True)]])
def test_bad_work_item_states_and_pages_are_rejected(value):
    with pytest.raises(ValueError):
        normalize_work_page(value, 'pulls', 'owner/repo', 'all')
