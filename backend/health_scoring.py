"""Pure, versioned maintenance indicators. This is not a source-code quality model."""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, Field

METHOD_VERSION = 'maintenance-v1'
RULES = {
    'commits': {'label': 'Default-branch commit recency', 'weight': 25, 'rule': 'Age of the default-branch tip commit (committer timestamp): <=7 days: 25; <=30: 20; <=90: 10; <=180: 5; older or a confirmed empty repository: 0.', 'bands': [(7, 25), (30, 20), (90, 10), (180, 5)], 'suggestion': 'If active development is intended, review the default branch and publish meaningful maintenance changes. Do not create empty commits to improve this indicator.'},
    'readme': {'label': 'README availability', 'weight': 15, 'rule': 'A README reported by GitHub with size >0 bytes: 15; a confirmed missing or empty README: 0. Contents and documentation quality are not judged.', 'suggestion': 'Add a nonempty README covering purpose, installation, usage, support, and maintenance expectations.'},
    'license': {'label': 'License availability', 'weight': 10, 'rule': 'A detected license with a recognized SPDX identifier: 10; a detected custom/unrecognized license: 5; GitHub explicitly reports no detected license: 0. This is not legal advice or proof of licensing adequacy.', 'suggestion': 'Review the intended licensing terms and add or clarify a license file where appropriate. GitHub detection is not a legal conclusion.'},
    'releases': {'label': 'Stable GitHub release recency', 'weight': 15, 'rule': 'Publication age from GitHub latest stable release endpoint: <=90 days: 15; <=180: 10; <=365: 5; older or no stable GitHub release: 0. Tags, prereleases, and releases on other channels are not assessed.', 'bands': [(90, 15), (180, 10), (365, 5)], 'suggestion': 'Document the release cadence. If GitHub releases suit the project, publish a stable release with useful release notes; other distribution channels are outside this indicator.'},
    'issues': {'label': 'Issue acknowledgement (sample)', 'weight': 20, 'rule': 'Among up to 5 newest issues at least 7 days old found in the first 300 newest raw issue items across at most 3 pages (PRs excluded), require at least 3 assessable issues. Award round-half-up(20 x acknowledged/sample). Acknowledgement means a comment within 7 days by a different account whose GitHub author_association is OWNER, MEMBER, or COLLABORATOR. Inspect at most the first 100 comments per issue. Associated automation can count; reply helpfulness and repository-wide responsiveness are not measured.', 'suggestion': 'Review the sampled issues, acknowledge support requests within a week, or clearly document support expectations. Useful replies matter more than optimizing this proxy.'},
    'pulls': {'label': 'Merged pull-request recency', 'weight': 15, 'rule': 'Age of the latest provable merged_at timestamp: <=30 days: 15; <=90: 10; <=180: 5; older or a fully exhausted closed-PR list with no merges: 0. Inspect at most 100 recently updated closed PRs. If more pages exist, recency is assessable only when the newest observed merge is at least as recent as the oldest loaded updated_at; unseen older-updated pages cannot then contain a newer merge.', 'bands': [(30, 15), (90, 10), (180, 5)], 'suggestion': 'Review incoming pull requests and merge appropriate changes if collaboration is part of the project workflow. Direct-commit or stable projects may legitimately have little PR activity.'},
}


@dataclass
class Observation:
    available: bool
    value: Any = None
    explanation: str = ''
    evidence: list[str] = field(default_factory=list)
    source_urls: list[str] = field(default_factory=list)


class HealthFactor(BaseModel):
    id: str
    label: str
    weight: int = Field(ge=0, le=100)
    score: int | None = Field(ge=0, le=100)
    status: Literal['assessed', 'unavailable']
    rule: str
    explanation: str
    evidence: list[str]
    source_urls: list[str]
    suggestion: str | None


class HealthResponse(BaseModel):
    repository: str
    methodology_version: str
    status: Literal['complete', 'incomplete']
    score: int | None = Field(ge=0, le=100)
    observed_points: int
    available_weight: int
    lower_bound: int
    upper_bound: int
    factors: list[HealthFactor]
    maintenance_suggestions: list[str]
    data_suggestions: list[str]
    limitations: list[str]
    analyzed_at: AwareDatetime
    cached: bool
    cache_expires_at: AwareDatetime | None
    rate_limited: bool
    retry_after: int | None


def score_observations(repository: str, observations: dict[str, Observation], now: datetime) -> HealthResponse:
    if now.tzinfo is None:
        raise ValueError('Scoring time must be timezone-aware')
    factors = []
    for key, rule in RULES.items():
        observation = observations.get(key, Observation(False, explanation='This signal was not collected.'))
        points = None
        reason = observation.explanation
        extra_evidence = []
        if observation.available:
            try:
                if key in ('commits', 'releases', 'pulls'):
                    if observation.value is None:
                        points = 0
                        reason = reason or 'The source confirms no qualifying activity.'
                    else:
                        date = observation.value
                        if not isinstance(date, datetime) or date.tzinfo is None:
                            raise ValueError('Missing timezone-aware activity timestamp')
                        age = (now.astimezone(timezone.utc) - date.astimezone(timezone.utc)).total_seconds() / 86400
                        if age < 0:
                            raise ValueError('Activity timestamp is in the future')
                        points = next((score for limit, score in rule['bands'] if age <= limit), 0)
                        reason = (reason + ' ' if reason else '') + f'Observed activity is {age:.2f} days old (rounded); exact elapsed-time bands award {points}/{rule["weight"]}.'
                        extra_evidence.append(f'Activity timestamp (UTC): {date.astimezone(timezone.utc).isoformat()}')
                elif key == 'readme':
                    if type(observation.value) is not int or observation.value < 0:
                        raise ValueError('README size is unavailable')
                    points = 15 if observation.value > 0 else 0
                    reason = reason or (f'GitHub reports a nonempty README ({observation.value} bytes).' if points else 'GitHub confirms a missing or empty README.')
                elif key == 'license':
                    if observation.value not in ('recognized', 'custom', 'none'):
                        raise ValueError('License detection is unavailable')
                    points = {'recognized': 10, 'custom': 5, 'none': 0}[observation.value]
                    reason = reason or f'GitHub license detection category: {observation.value}.'
                else:
                    sample = observation.value
                    if not isinstance(sample, dict) or type(sample.get('sample_size')) is not int or type(sample.get('acknowledged')) is not int or not 3 <= sample['sample_size'] <= 5 or not 0 <= sample['acknowledged'] <= sample['sample_size']:
                        raise ValueError('At least 3 fully assessable mature issues are required')
                    points = int((Decimal(20) * sample['acknowledged'] / sample['sample_size']).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
                    reason = f'{sample["acknowledged"]}/{sample["sample_size"]} sampled mature issues received a qualifying acknowledgement within 7 days; round-half-up awards {points}/20. This sample is not all issues.'
            except (ValueError, TypeError, KeyError) as error:
                points = None
                reason = str(error)
        if points is None:
            reason = reason or 'The source did not provide enough evidence to assess this factor.'
        factors.append(HealthFactor(id=key, label=rule['label'], weight=rule['weight'], score=points, status='unavailable' if points is None else 'assessed', rule=rule['rule'], explanation=reason, evidence=observation.evidence + extra_evidence, source_urls=observation.source_urls, suggestion=rule['suggestion'] if points is not None and points < rule['weight'] else None))
    weight = sum(factor.weight for factor in factors if factor.score is not None)
    earned = sum(factor.score for factor in factors if factor.score is not None)
    complete = weight == 100
    return HealthResponse(repository=repository, methodology_version=METHOD_VERSION, status='complete' if complete else 'incomplete', score=earned if complete else None, observed_points=earned, available_weight=weight, lower_bound=earned, upper_bound=earned + 100 - weight, factors=factors, maintenance_suggestions=[factor.suggestion for factor in factors if factor.suggestion], data_suggestions=[f'Retry or verify {factor.label.lower()}: {factor.explanation}' for factor in factors if factor.score is None], limitations=['This is an explainable maintenance-signal heuristic, not an objective source-code quality, security, or correctness score.', 'Weights and time bands are product choices, not a validated industry benchmark.', 'Stable, mature, archived, or direct-commit projects can legitimately have little recent activity. Interpret the result against project goals.', 'README and license checks measure detection only. Other documentation, licensing terms, and external release channels are not evaluated.', 'Issue acknowledgement is a small sample and an account-association proxy; automation can count, and useful support is not judged.', 'A missing factor is never assigned zero or reweighted. Incomplete assessments have no overall score; bounds are possibilities, not estimates.'], analyzed_at=now, cached=False, cache_expires_at=None, rate_limited=False, retry_after=None)
