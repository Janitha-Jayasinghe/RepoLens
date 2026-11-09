from datetime import datetime, timedelta, timezone
from copy import deepcopy
import pytest
from backend.health_scoring import Observation, RULES, score_observations
from backend.health_api import acknowledgement_in_first_page, latest_provable_merge

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def complete():
    return {'commits': Observation(True, NOW), 'readme': Observation(True, 10), 'license': Observation(True, 'recognized'), 'releases': Observation(True, NOW), 'issues': Observation(True, {'sample_size': 5, 'acknowledged': 5}), 'pulls': Observation(True, NOW)}


def test_weights_are_transparent_and_total_one_hundred():
    assert {name: rule['weight'] for name, rule in RULES.items()} == {'commits': 25, 'readme': 15, 'license': 10, 'releases': 15, 'issues': 20, 'pulls': 15}
    assert sum(rule['weight'] for rule in RULES.values()) == 100
    assert all(rule['rule'] and rule['suggestion'] for rule in RULES.values())


@pytest.mark.parametrize('key,days,expected', [('commits', 7, 25), ('commits', 7 + 1/86400, 20), ('commits', 30, 20), ('commits', 90, 10), ('commits', 180, 5), ('commits', 181, 0), ('releases', 90, 15), ('releases', 180, 10), ('releases', 365, 5), ('releases', 366, 0), ('pulls', 30, 15), ('pulls', 90, 10), ('pulls', 180, 5), ('pulls', 181, 0)])
def test_exact_recency_boundaries(key, days, expected):
    signals = complete(); signals[key] = Observation(True, NOW - timedelta(days=days))
    result = score_observations('owner/repo', signals, NOW)
    assert next(factor for factor in result.factors if factor.id == key).score == expected
    assert result.score == 100 - RULES[key]['weight'] + expected


@pytest.mark.parametrize('key,value,expected', [('readme', 0, 0), ('readme', 1, 15), ('license', 'recognized', 10), ('license', 'custom', 5), ('license', 'none', 0), ('commits', None, 0), ('releases', None, 0), ('pulls', None, 0)])
def test_known_absence_and_detected_values_have_documented_scores(key, value, expected):
    signals = complete(); signals[key] = Observation(True, value)
    result = score_observations('owner/repo', signals, NOW)
    assert next(factor for factor in result.factors if factor.id == key).score == expected


@pytest.mark.parametrize('sample,ack,expected', [(3, 0, 0), (3, 1, 7), (3, 2, 13), (3, 3, 20), (5, 4, 16)])
def test_issue_acknowledgement_rounds_half_up(sample, ack, expected):
    signals = complete(); signals['issues'] = Observation(True, {'sample_size': sample, 'acknowledged': ack})
    result = score_observations('owner/repo', signals, NOW)
    assert next(factor for factor in result.factors if factor.id == 'issues').score == expected


def test_missing_data_never_becomes_zero_or_is_reweighted():
    signals = complete(); signals['issues'] = Observation(False, explanation='No sample available')
    result = score_observations('owner/repo', signals, NOW)
    assert result.score is None
    assert result.status == 'incomplete'
    assert result.observed_points == result.available_weight == 80
    assert (result.lower_bound, result.upper_bound) == (80, 100)
    assert next(factor for factor in result.factors if factor.id == 'issues').score is None


def test_no_evidence_produces_no_score_and_full_uncertainty_bounds():
    result = score_observations('owner/repo', {}, NOW)
    assert result.score is None
    assert result.available_weight == 0
    assert (result.lower_bound, result.upper_bound) == (0, 100)


def test_confirmed_zero_is_a_complete_score_not_a_missing_score():
    signals = complete()
    signals.update(commits=Observation(True, None), readme=Observation(True, 0), license=Observation(True, 'none'), releases=Observation(True, None), issues=Observation(True, {'sample_size': 3, 'acknowledged': 0}), pulls=Observation(True, None))
    result = score_observations('owner/repo', signals, NOW)
    assert result.score == 0
    assert result.status == 'complete'
    assert len(result.maintenance_suggestions) == 6


@pytest.mark.parametrize('key,value', [('commits', NOW + timedelta(seconds=1)), ('commits', datetime(2020, 1, 1)), ('readme', True), ('readme', -1), ('license', None), ('issues', {'sample_size': 2, 'acknowledged': 2}), ('issues', {'sample_size': 3, 'acknowledged': 4})])
def test_invalid_or_insufficient_signals_remain_unavailable(key, value):
    signals = complete(); signals[key] = Observation(True, value)
    assert score_observations('owner/repo', signals, NOW).score is None


def test_scoring_is_deterministic_and_does_not_mutate_observations():
    signals = complete(); before = deepcopy(signals)
    first = score_observations('owner/repo', signals, NOW)
    assert first.model_dump() == score_observations('owner/repo', signals, NOW).model_dump()
    assert signals == before
    assert any('not an objective' in text for text in first.limitations)


def issue():
    return {'created_at': '2020-01-01T00:00:00Z', 'user': {'login': 'Reporter'}}


def comment(login='maintainer', at='2020-01-02T00:00:00Z', association='MEMBER'):
    return {'created_at': at, 'user': {'login': login}, 'author_association': association}


def test_acknowledgement_requires_different_associated_account_within_seven_days():
    assert acknowledgement_in_first_page(issue(), [comment()], False)
    assert not acknowledgement_in_first_page(issue(), [comment('reporter')], False)
    assert not acknowledgement_in_first_page(issue(), [comment(association='NONE')], False)
    assert not acknowledgement_in_first_page(issue(), [comment(at='2020-01-09T00:00:00Z')], False)
    assert acknowledgement_in_first_page(issue(), [comment(at='2020-01-08T00:00:00Z')], False)


def test_incomplete_comments_cannot_silently_mean_no_acknowledgement():
    with pytest.raises(ValueError):
        acknowledgement_in_first_page(issue(), [comment('Reporter')], True)
    assert not acknowledgement_in_first_page(issue(), [], False)


def test_partial_pr_page_requires_proof_that_unseen_merges_cannot_be_newer():
    good = [{'state': 'closed', 'updated_at': '2020-01-03T00:00:00Z', 'merged_at': '2020-01-02T00:00:00Z'}, {'state': 'closed', 'updated_at': '2020-01-01T00:00:00Z', 'merged_at': None}]
    assert latest_provable_merge(good, True) == datetime(2020, 1, 2, tzinfo=timezone.utc)
    with pytest.raises(ValueError):
        latest_provable_merge(good[:1], True)
    assert latest_provable_merge([], False) is None
    with pytest.raises(ValueError):
        latest_provable_merge([], True)



def test_unseen_comment_pages_do_not_become_a_false_negative():
    # API comment IDs need not prove that unseen imported timestamps are later.
    with pytest.raises(ValueError):
        acknowledgement_in_first_page(issue(), [comment('Reporter', at='2020-01-20T00:00:00Z')], True)
