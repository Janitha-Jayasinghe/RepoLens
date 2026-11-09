# Repository maintenance-health methodology

Version: `maintenance-v1`.

This is an explainable maintenance-signal heuristic, not an objective source-code quality, correctness, security, or productivity score. Weights and time bands are product choices, not an industry benchmark.

## Fixed scoring rules

| Factor | Weight | Rule |
| --- | ---: | --- |
| Default-branch commit recency | 25 | Age of the default-branch tip commit (committer timestamp): <=7 days: 25; <=30: 20; <=90: 10; <=180: 5; older or a confirmed empty repository: 0. |
| README availability | 15 | A README reported by GitHub with size >0 bytes: 15; a confirmed missing or empty README: 0. Contents and documentation quality are not judged. |
| License availability | 10 | A detected license with a recognized SPDX identifier: 10; a detected custom/unrecognized license: 5; GitHub explicitly reports no detected license: 0. This is not legal advice or proof of licensing adequacy. |
| Stable GitHub release recency | 15 | Publication age from GitHub latest stable release endpoint: <=90 days: 15; <=180: 10; <=365: 5; older or no stable GitHub release: 0. Tags, prereleases, and releases on other channels are not assessed. |
| Issue acknowledgement (sample) | 20 | Among up to 5 newest issues at least 7 days old found in the first 300 newest raw issue items across at most 3 pages (PRs excluded), require at least 3 assessable issues. Award round-half-up(20 x acknowledged/sample). Acknowledgement means a comment within 7 days by a different account whose GitHub author_association is OWNER, MEMBER, or COLLABORATOR. Inspect at most the first 100 comments per issue. Associated automation can count; reply helpfulness and repository-wide responsiveness are not measured. |
| Merged pull-request recency | 15 | Age of the latest provable merged_at timestamp: <=30 days: 15; <=90: 10; <=180: 5; older or a fully exhausted closed-PR list with no merges: 0. Inspect at most 100 recently updated closed PRs. If more pages exist, recency is assessable only when the newest observed merge is at least as recent as the oldest loaded updated_at; unseen older-updated pages cannot then contain a newer merge. |

Weights total 100. Time bands compare exact elapsed UTC seconds; displayed ages are rounded. The comparison time is returned as `analyzed_at`, and timestamp evidence is returned with each factor. Activity uses actual commit/merge/release timestamps, never stars, forks, push dates substituted for commits, or invented trends.

## Complete and incomplete assessments

- With all six factors assessed, the overall score is the integer sum of earned factor points (0?100). A verified zero is a real complete score.
- A missing, unavailable, malformed, future-dated, or insufficient signal has `score: null`, not zero. No weights are redistributed.
- If any factor is unscored, the overall `score` is null and status is `incomplete`. The circular display says Unscored.
- `observed_points` sums verified points; `available_weight` sums assessed weights. Bounds are `[observed_points, observed_points + 100 - available_weight]`. They are mathematical possibilities, not predictions or normalized scores.
- A confirmed empty Git repository, missing/empty README, absent detected license, missing stable release, or fully exhausted PR list without merges is different from a failed or forbidden request. Confirmed absence follows the documented zero-point rule; request failures remain unscored.

## Bounded evidence collection

Each assessment first verifies public repository visibility and resolves the canonical name. It has an approximately 24-second overall request budget. Completed factors survive a later timeout or rate limit; remaining factors stay unscored.

Commit recency uses the default-branch tip commit committer date. README presence uses the nonempty file size reported by the README endpoint. License detection uses the explicit repository metadata field; an omitted field is unavailable, whereas an explicit null means no detected license. Releases use the publication timestamp of the stable release selected by GitHub latest-release endpoint; other channels and prereleases are outside scope.

Issue acknowledgement scans at most three pages of 100 raw issue/PR records, newest-created first, excluding PRs and issues younger than seven days. It stops once five mature issues have been found, and requires at least three distinct mature issues. For each selected issue, a reported zero comment count establishes no acknowledgement; otherwise at most the first 100 comments are inspected. A qualifying comment is within seven days of issue creation, comes from a different GitHub login (case-insensitive), and has association OWNER, MEMBER, or COLLABORATOR. Automation with an eligible association can count. If an unseen comment page or unknown comment identity could change a negative result, the factor remains unscored. This is a small acknowledgement proxy, not repository-wide responsiveness or an evaluation of reply quality.

PR recency scans at most 100 closed PRs sorted by descending updated timestamp. It uses merged_at, not closed_at. When more pages exist, the newest observed merge must be at least as recent as the oldest loaded update: unseen older-updated PRs cannot then contain a newer merge under the API ordering. Otherwise recency is unavailable. No sample count is presented as a complete PR total.

Stable, mature, archived, direct-commit, or non-GitHub-release projects can have lower activity without requiring changes. Interpret suggestions against project goals. Do not create empty commits, artificial replies, or unnecessary releases to manipulate the heuristic.

## API and caching

`GET /api/health?repo=owner/repository` returns canonical repository, methodology version, overall status/score, verified points/weights/bounds, six factor rules/scores/explanations/evidence/source URLs, maintenance suggestions, data-gap suggestions, limitations, retrieval/cache metadata, and rate-limit retry metadata.

Each factor includes status assessed/unavailable, fixed weight, nullable points, the exact rule, an explanation, source links, evidence, and a suggestion when an assessed factor earns fewer than its available points. Maintenance actions are kept separate from retries needed to resolve missing data.

Only complete assessments are cached, for 120 seconds in a bounded process-local cache. Keys separate credentials, canonical repositories, and methodology versions. Public visibility is rechecked before cached data is returned. `refresh=true` or the dedicated Refresh assessment button bypasses this cache. The global repository refresh may reuse a still-valid assessment; its original timestamp and cached status stay visible. Incomplete assessments are not cached.

A rate limit during collection returns an incomplete assessment with `rate_limited: true` and `retry_after`. The frontend preserves known factors, shares the search cooldown, and never retries automatically. If repository visibility itself cannot be verified, the existing structured API error is returned instead.

## Implementation and tests

- Backend rules and pure scoring: `backend/health_scoring.py`.
- Bounded evidence retrieval and API: `backend/health_api.py`.
- Backend tests: `backend/tests/test_health_scoring.py` and health cases in `backend/tests/test_api.py`.
- Frontend response integrity checks: `frontend/src/services/health.ts`; rules are not duplicated in the browser.
- Health page and circular SVG gauge: `frontend/src/pages/HealthPage.tsx`, `frontend/src/components/analytics/HealthGauge.tsx`.
- Reproducible live browser check: `frontend/scripts/verify-health.cjs`.
