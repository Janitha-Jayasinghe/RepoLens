# RepoLens

Public GitHub repository analytics, built incrementally. Phase 9 adds side-by-side public repository comparison and downloadable PDF analytics reports. Maintenance assessments remain transparent, evidence-based heuristics. No repository statistics are fabricated.

## Requirements

Node.js 22.12+ (Node 24 recommended), npm, and Python 3.11 or newer. The existing `backend/venv` can be reused.

## Installation

From the workspace root, install backend dependencies if needed:

```powershell
python -m venv backend/venv
.\backend\venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
```

Skip virtual environment creation when the existing one is already working. `requirements-dev.txt` adds Pytest and PDF inspection tools; `requirements.txt` contains the runtime dependencies.

Install frontend dependencies:

```powershell
cd frontend
npm ci
```

Optional frontend configuration: copy `frontend/.env.example` to `frontend/.env.local` if no local file exists. `VITE_API_BASE_URL` defaults to `http://127.0.0.1:8000`. Restart Vite after changing it. All `VITE_` variables are public; never put credentials in them.

Optional backend configuration: create `backend/.env` using `.env.example` only if no file already exists. `GITHUB_TOKEN` is read only by the backend and is optional for public repositories. `CORS_ORIGINS` defaults to `http://127.0.0.1:5173,http://localhost:5173`; configure exact origins for other frontend ports or deployments. Never commit the token or overwrite an existing environment file.

## Run both servers

Terminal 1, from the project root:

```powershell
.\backend\venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

Terminal 2, from the project root:

```powershell
cd frontend
npm run dev
```

Open http://127.0.0.1:5173. API documentation: http://127.0.0.1:8000/docs.

## Repository search

Enter `facebook/react`, `vuejs/core`, or a full GitHub repository URL. HTTPS/HTTP GitHub URLs, `www.github.com`, a trailing slash, and `.git` clone suffixes are supported. URLs from other hosts, credential-bearing URLs, query strings, fragments, extra path segments, encoded paths, and invalid names are rejected.

The selected repository lives in the `repo` URL parameter, for example `/?repo=vuejs%2Fcore`. It survives route changes and reloads. Successful searches replace aliases with GitHub's canonical `full_name`; during verification `facebook/react` resolved to `react/react`. Overview shows the owner avatar, canonical identity, description, language, license, branch, topics, stars, forks, combined open issues and pull requests, subscribers, repository size, and creation/last-push dates. Languages and Contributors provide interactive charts and exact data breakdowns. Commits provides time-bounded history, filtering, and daily activity only for exhausted ranges. Issues & Pull Requests provides separate queues and explicitly scoped charts. Health explains maintenance indicators and leaves missing evidence unscored. Comparison accepts two public repository URLs or names independently of the workspace selection. Reports prepares a reviewed snapshot for the selected repository.

Analyze can run another search without a reload. Refresh re-fetches the selected repository. Previous requests are cancelled and stale responses are ignored. Errors remove the previous result so it cannot be mistaken for the newly requested repository. Loading skeletons appear while fetching.

GitHub rate-limit responses show a retry countdown and disable requests until it expires. There are no automatic retries. This follows [GitHub's rate-limit guidance](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#rate-limit-errors). The countdown is local to the current app session; reloading creates a new session and GitHub remains the authority for limits.

## API contract

The initial backend had only `GET /`. Phase 3 adds `/api/analyze`; the original root response is preserved:

```json
{"message":"RepoLens API is running!","status":"success"}
```

`GET /api/analyze?repo=owner/repository` retrieves one public repository from GitHub's REST API. It follows redirects, uses a server-side token when configured, and applies connection/request timeouts. This overview request does not fetch languages or contributors; those are requested only when their page opens. Commit history is requested separately when the Commits page opens.

Success fields:

| Field | Contents |
| --- | --- |
| `requested_repo` | Validated owner/repository input |
| `repository` | Typed repository metadata from GitHub |
| `repository.owner` | Owner login, avatar URL, and profile URL |
| `repository.full_name`, `html_url` | Canonical repository identity and link |
| `repository.stargazers_count`, `forks_count` | GitHub-reported counts |
| `repository.open_issues_count` | Combined open issues **and pull requests**, never an issues-only count |
| `repository.subscribers_count` | Actual watchers/subscribers; nullable when unavailable |
| `repository.size` | GitHub-reported repository size in KB; nullable when unavailable |
| `repository.license` | Detected license key, name, and SPDX identifier, or null |
| `repository.topics` | Reported topics; an empty array means no topics, null means unavailable |
| `repository.created_at`, `pushed_at` | Creation and latest push timestamps; push can be null |
| `analyzed_at` | UTC retrieval timestamp |
| `source_url` | Canonical GitHub repository URL |

The complete Pydantic schema is available in `/docs` and `/openapi.json`; TypeScript interfaces live in `frontend/src/types/repository.ts`. The frontend validates successful response shapes before rendering.

Application errors use `detail: { code, message, retry_after?, reset_at? }`. FastAPI query validation can return its standard `detail` array, which the client also handles. Status codes include 422 (invalid input), 404 (not found/non-public), 403 (access denied), 429 (GitHub rate limit), 502 (upstream/network/schema failure), 503 (GitHub still preparing analytics), and 504 (upstream timeout). Rate-limit errors include a `Retry-After` header and retry delay. Raw credentials and upstream exception text are not returned.

## Tests and verification

From the project root:

```powershell
.\backend\venv\Scripts\python.exe -B -m pytest backend/tests -q -p no:cacheprovider
cd frontend
npm test
npm run build
```

Backend tests use HTTPX mock transports; frontend unit tests use Vitest. Synthetic fixtures are isolated to tests. They never provide production data.

Live checks with the backend running:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/
Invoke-RestMethod 'http://127.0.0.1:8000/api/analyze?repo=facebook/react'
Invoke-RestMethod 'http://127.0.0.1:8000/api/analyze?repo=vuejs/core'
```

Manual browser checks:

1. Search `facebook/react` and verify the canonical name in the result and URL.
2. Search `https://github.com/vuejs/core.git` without reloading, then refresh.
3. Navigate to Languages and Settings; confirm the repository stays selected. Reload and use browser Back.
4. Search `repolens-nonexistent-owner-73921/missing-repository`; verify a useful error and absence of the previous result.
5. Search `https://example.com/facebook/react`; verify client-side rejection with no API request.
6. Stop the backend and refresh to verify the connection error. Restart it and retry.
7. At 320px, 375px, 768px, and desktop widths, check the search controls and selected result in both themes.

Phase 3 verification also exercised delayed responses, cancellation races, malformed responses, rate-limit cooldown/recovery, and no automatic retries using temporary headless-browser tooling outside the project. Production data is always obtained from the real backend.

## Architecture

```text
backend/
  main.py                 # Public repository, analytics, commit routes, and CORS
  commit_history.py       # Commit normalization and UTC aggregation
  work_items.py           # Issue/PR router, normalization, and scoped TTL caches
  health_scoring.py       # Versioned pure maintenance scoring rules
  health_api.py           # Bounded evidence collection and health API
  requirements.txt
  requirements-dev.txt
  tests/test_api.py
frontend/src/
  app/                    # Routing and navigation metadata
  components/layout/      # Responsive shell and repository search
  components/ui/          # Cards, controls, tooltips, skeletons, error boundary
  components/analytics/   # Shared charts, approved chart palette, request states
  components/RepositoryResult.tsx
  hooks/                  # Theme, selected repository, on-demand analytics state
  pages/                  # Overview, Languages, Contributors, Commits, Issues, Health, Settings
  services/               # API client, parsing, and unit tests
  styles/                 # Approved palette and responsive styling
  types/                  # Backend response interfaces
```

React Router supports `/`, `/languages`, `/contributors`, `/commits`, `/issues`, `/health`, `/comparison`, `/reports`, and `/settings`. Desktop navigation collapses; a modal mobile drawer provides keyboard focus containment and Escape dismissal. Theme selection is saved locally when storage is available, with system preference used initially.

Tailwind v4 uses its Vite plugin. Default color tokens are removed; only black, white, jet black, jet orange, orange hover, and opacity variations are used. External descriptions are rendered in grayscale so multicolored emoji do not introduce extra hues. Recharts fills, strokes, axes, grids, custom tooltips, and responsive legends explicitly use the approved tokens. The chart routes are loaded lazily so the overview does not load Recharts. Production hosting must return `index.html` for frontend routes. Deployment is not configured.

## Screenshots and roadmap

[Overview dark](screenshots/phase-4-overview-dark.png) | [Overview light](screenshots/phase-4-overview-light.png) | [Overview mobile](screenshots/phase-4-overview-mobile.png) | [Phase 3 search](screenshots/phase-3-search.png) | [Desktop dark](screenshots/phase-2-desktop-dark.png) | [Desktop light](screenshots/phase-2-desktop-light.png) | [Mobile navigation](screenshots/phase-2-mobile.png)

Next phases: comparisons, PDF reports, remaining preferences, and final portfolio documentation. Phase 8 stops at explainable maintenance-health scoring.

## Phase 4 data conventions and browser verification

Counts use exact comma-separated values, with no fabricated growth rates, historical trends, or inferred popularity. Subscribers use `subscribers_count`, not `watchers_count`, which GitHub uses for stars ([GitHub documentation](https://docs.github.com/en/rest/activity/watching#watching-versus-starring)). Size preserves the GitHub KB unit; dates are explicitly UTC, with full timestamps available on date tooltips. Owner avatars and emoji descriptions are rendered in grayscale to maintain the approved palette.

Missing counts and size show `Not reported`, rather than zero. Missing descriptions, languages, licenses, topics, avatars, and last-push dates have explicit fallback states. `No license detected` describes GitHub's detection result, not a legal conclusion. Zero is displayed when actually reported. Existing root, search, refresh, redirect, error, and rate-limit functionality remains available.

Phase 4 verification passed 38 frontend tests and 35 backend tests, plus the strict TypeScript/production build. Live browser checks compared displayed values with actual responses for `facebook/react` (canonical `react/react` during verification), `vuejs/core`, and `octocat/Hello-World`. Controlled response replays exercised missing fields, zero values, and loading states. Responsive checks covered 320, 375, 768, 1024, and 1440px in both themes. GitHub links and selected-repository preservation were checked as well.

The optional reproducible browser script is `frontend/scripts/verify-overview.cjs`. It starts and stops its own frontend/backend, requires ports 5178 and 8000 to be free, uses live GitHub requests, and saves screenshots. Run it from the project root after unit tests and the build. To use temporary Playwright tooling without adding a project dependency:

```powershell
npm install --prefix "$env:TEMP\repolens-browser-review" playwright --no-package-lock --ignore-scripts --no-audit --no-fund
$env:PLAYWRIGHT_MODULE="$env:TEMP\repolens-browser-review\node_modules\playwright"
node frontend/scripts/verify-overview.cjs
```

The script uses installed Microsoft Edge on Windows. On other systems, set `BROWSER_EXECUTABLE_PATH` to a compatible Chromium browser or install the Playwright Chromium browser separately. Live checks require network access and available GitHub API quota; deterministic unit tests do not.

## Phase 5 language and contributor analytics

New API routes:

| Endpoint | Response |
| --- | --- |
| `GET /api/languages?repo=owner/repository` | Canonical `repository`, `languages` byte map, exact `total_bytes`, `source_url`, and UTC `analyzed_at` |
| `GET /api/contributors?repo=owner/repository` | Canonical `repository`, `contributors`, `returned_count`, `page`, `per_page`, `has_more`, `coverage_note`, source URL, and UTC timestamp |

Both endpoints verify that the repository is public before retrieving details, even when the server has a token. They reuse the existing GitHub timeout/error/rate-limit handling. Contributor 204 responses produce an explicit empty result; 202 processing responses produce a retryable 503 instead of fabricated data. An analytics failure does not discard a successful overview.

Languages includes a doughnut, horizontal byte chart, exact byte total, responsive selectable legend, and accessible breakdown table. Selecting a language highlights it in both charts and the table; it does not remove bytes from the percentage denominator. Custom hover/keyboard chart tooltips show exact values. Language percentages come from the returned byte counts; rounding may prevent displayed percentages from summing exactly to 100%.

Contributors includes ranked accounts, grayscale avatars, GitHub profile links, contribution counts, and a horizontal contribution chart. Select a leaderboard count to highlight a contributor. The API intentionally retrieves only page 1 with `per_page=10` and anonymous contributors excluded. The UI states that the returned top 10 are **not the complete contributor population**, whether or not GitHub reports another page. `returned_count` is a sample size, not a project-wide total. GitHub can cache contributor counts; bots are labeled and contribution counts do not measure productivity. See [GitHub contributor endpoint documentation](https://docs.github.com/en/rest/repos/repos#list-repository-contributors).

Each analytics page loads on demand, handles cancellation and repository changes, and offers its own refresh/retry control. The global Refresh button refreshes repository metadata and triggers the open analytics page to reload. Rate-limit errors share the search cooldown without automatic retries. Empty language maps, zero total bytes, and empty contributor pages have explicit empty states.

Phase 5 checks passed: 45 frontend tests, 55 backend tests, strict TypeScript, and the production build. Live browser checks verified Vue language bytes/total and contributor rankings/counts/profile links; repeated searches switched to React and back without a page reload. Interactive legend selection, tooltips, mobile resizing, approved SVG colors, empty/loading states, shared rate limits, and preservation of the overview were also verified.

After configuring the temporary Playwright tooling described above, run the reproducible analytics browser check from the project root (ports 5178 and 8000 must be free):

```powershell
node frontend/scripts/verify-analytics.cjs
```

This script requires live GitHub access and available API quota. Deterministic unit tests remain `npm test` and the Pytest command above.

[Languages dark](screenshots/phase-5-languages-dark.png) | [Languages light](screenshots/phase-5-languages-light.png) | [Languages mobile](screenshots/phase-5-languages-mobile.png)

[Contributors dark](screenshots/phase-5-contributors-dark.png) | [Contributors light](screenshots/phase-5-contributors-light.png) | [Contributors mobile](screenshots/phase-5-contributors-mobile.png)

## Phase 6 commit history and activity

`GET /api/commits?repo=owner/repository&days=30&author=optional-login` retrieves a supported **7-, 30-, or 90-day UTC calendar window**. The current day ends at the request timestamp and is explicitly a partial day. The optional author is a GitHub login; email and URL filters are not accepted. The existing `/`, overview, language, and contributor routes are preserved.

The endpoint verifies public visibility, resolves the canonical repository, pins the default branch's tip SHA, and paginates GitHub's [commit list API](https://docs.github.com/en/rest/commits/commits#list-commits). All pages use the same pinned SHA, time window, and author filter. A request reads at most five pages of 100 commits (500 raw records), deduplicates SHAs, and has a 25-second overall deadline. The list contains only unique returned commits whose committer timestamps lie inside the selected window. It does not claim to contain the repository's all-time history or all branches.

Response fields include:

| Field | Meaning |
| --- | --- |
| `repository`, `default_branch`, `head_sha` | Canonical repository and pinned history scope |
| `commits` | SHA, full message, commit URL, Git author name, optional linked GitHub profile/avatar, authored timestamp, committed timestamp |
| `fetched_count` | Number of unique commits fetched within this query, never an all-time total |
| `days`, `author_filter`, `range_start`, `range_end` | Applied filters and precise UTC bounds |
| `complete`, `has_more` | Whether the bounded GitHub query was exhausted |
| `pages_fetched`, `max_pages`, `per_page` | Explicit retrieval coverage |
| `activity` | Verified daily UTC counts for a complete range; **null for incomplete history** |
| `coverage_note`, `analyzed_at`, `source_url` | Explanation, retrieval time, and exact upstream query |

The activity chart is calculated from actual **committer** timestamps and includes merge commits. Git author names and authored dates are kept separate; an unlinked author is not replaced with an invented GitHub user. No author email is included in the response. Duplicate commits do not inflate daily counts.

Daily zeros are shown only after the selected query is exhausted. If GitHub reports more pages after the 500-record bound, the UI displays partial coverage and withholds the chart and daily counts rather than projecting a trend. Choose a shorter window or an author filter. A GitHub empty-repository response or an exhausted empty range produces a clear empty state. Timeouts, missing commit timestamps, pending GitHub data, and upstream failures produce errors rather than fabricated statistics. No 12-month trend or cached statistics endpoint is assumed.

The recent list displays up to 20 fetched commits per list page, short SHA links plus full SHA details, complete messages, author information, committed UTC timestamps, and functional GitHub links. Server-side time/author filters apply to both the list and chart. The local message/SHA filter affects only fetched list records; the chart remains based on the complete selected server-side range. Refresh re-runs the current filters. Repository changes reset author and message filters, and stale requests cannot overwrite newer ranges.

Phase 6 validation passed **55 frontend tests, 77 backend tests, strict TypeScript, and the production build**. Tests cover normalization, linked/unlinked authors, timezone conversion, duplicate SHAs, inclusive bounds, pagination, empty history, author filters, rate limits, malformed timestamps, and refusing charts for partial data. Live Vue verification returned 83 commits for the tested 30-day window with daily counts summing to 83; counts naturally change as the repository changes. Live browser checks exercised all three ranges and author filtering, plus the limited recent history of `octocat/Hello-World`. Controlled response replays verified partial-history suppression, loading states, unavailable statistics, and cooldowns. Responsive checks covered 320, 375, 768, 1024, and 1440px in both themes.

Re-run deterministic checks from the workspace root:

```powershell
.\backend\venv\Scripts\python.exe -B -m pytest backend/tests -q -p no:cacheprovider
cd frontend
npm test
npm run build
```

After the optional temporary Playwright setup described above, run from the workspace root with ports 5178 and 8000 free:

```powershell
node frontend/scripts/verify-commits.cjs
```

The browser check uses live GitHub quota and controlled test-only response replays; it starts/stops its own servers and saves screenshots. Production commit data always comes from GitHub through FastAPI.

[Commits dark](screenshots/phase-6-commits-dark.png) | [Commits light](screenshots/phase-6-commits-light.png) | [Mobile activity chart](screenshots/phase-6-commits-mobile-chart.png)

## Phase 7 issues and pull requests

New dedicated routes:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/work-items/summary?repo=owner/repository` | Separate search-reported open/closed issue and open/merged PR counts |
| `GET /api/issues?repo=owner/repository&state=all&page=1&per_page=20` | Recent issue rows, with PRs explicitly removed |
| `GET /api/pull-requests?repo=owner/repository&state=all&page=1&per_page=20` | Recent PR rows with explicit open/closed/merged states |

Issue states are `all`, `open`, and `closed`. PR states are `all`, `open`, `closed`, and `merged`. **Closed PRs means closed without merging** in this interface; merged PRs are identified by `merged_at`. GitHub's raw closed-PR response contains both, so filtering may leave a short or empty page. Issues never use `open_issues_count` as an issue-only total; that combined overview field is unchanged.

Summary queries use GitHub REST Search with `repo:canonical/name is:issue is:open`, `is:issue is:closed`, `is:pr is:open`, and `is:pr is:merged`. A summary count is displayed only when GitHub returns `incomplete_results: false`; otherwise its value is null and the UI says `Not reported`. Counts are GitHub search-reported snapshots, not counts inferred from partial pages. Search indexing can lag repository changes, and the independently retrieved summary/table snapshots are not atomic. The 1000-item search retrieval limit is not used to truncate `total_count` into a false total. See [GitHub search documentation](https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests).

Recent tables use the repository issue/pull endpoints, sorted by most recent update. Pages support 1?1000 and 1?100 raw items per page; the UI uses 20. The issue endpoint removes every item containing GitHub's `pull_request` discriminator ([GitHub issue documentation](https://docs.github.com/en/rest/issues/issues#list-repository-issues)). Pagination follows the raw GitHub API `Link` metadata, not the number of matching rows after filtering. Empty filtered pages can still have a Next page; no exact repository-wide total is inferred from them. Concurrent GitHub updates can change page boundaries.

A page response includes canonical repository, kind/state filter, normalized rows, `page`, `per_page`, `scanned_count`, `returned_count`, next/previous flags, coverage note, source URL, timestamp, and cache metadata. Rows expose title/number, separate state, author/profile link, timestamps, and comments when GitHub reports them. Missing comment counts remain null rather than zero. External label colors are never imported.

Two responsive charts are included: reported state distribution, and the latest-update dates of items in the **currently loaded API pages**. The latter counts each loaded item once by its latest `updated_at` in UTC; it is not a repository-wide activity trend, event count, or historical update series. Missing dates are not extrapolated. Changing filters or pages changes that sample. Incomplete summary counts are omitted from the summary chart.

Successful summaries are cached in process for 120 seconds; successful raw-page snapshots for 60 seconds. The cache is bounded to 128 entries, uses deep copies and monotonic expiry, and separates credentials, canonical repositories, kinds, states, pages, and page sizes. Public visibility is rechecked before serving a cache entry, so a cached public response is not served after the repository becomes private. Errors are not cached. Add `refresh=true`, or use a dedicated summary/table Refresh control, to bypass the cache. The global repository refresh reloads the view but can reuse still-valid work-item snapshots; their cached status and original timestamps remain visible. Restarting the backend clears this cache.

Existing GitHub timeout and rate-limit handling is shared by all new endpoints. A rate limit stops the remaining summary search queries and produces the structured retry response. The UI shares the search cooldown and does not automatically retry. A summary failure does not prevent independently successful issue/PR pages from being displayed. GitHub Search has a separate restrictive quota; tests and manual refreshes consume real API quota.

Phase 7 checks passed **64 frontend tests, 109 backend tests, strict TypeScript, and the production build**. Tests cover issue/PR separation, merged/unmerged states, short/empty raw pages, incomplete search counts, true zero counts, cache expiry/bypass/capacity/credential isolation, public visibility changes, rate limits, and UTC sample aggregation. Live public `vuejs/core` checks verified all four summary values, recent tables, open/closed issue filters, merged/unmerged PR filters, API-page navigation, and explicit refresh. Further live repository verification was rate-limited by GitHub. Isolated browser checks completed the full responsive/color/error suite and repository switching without additional GitHub requests. A 320px overflow caused by hidden link announcements escaping a scrolling table was fixed by establishing its positioning container.

Re-run the deterministic checks with the standard Pytest, `npm test`, and `npm run build` commands above. The optional browser script uses the same temporary Playwright setup as earlier phases. From the workspace root, with ports 5178 and 8000 free:

```powershell
node frontend/scripts/verify-work-items.cjs
```

For explicit isolated browser fixtures without any GitHub requests:

```powershell
$env:REPOLENS_OFFLINE_BROWSER_TESTS='1'
node frontend/scripts/verify-work-items.cjs
Remove-Item Env:REPOLENS_OFFLINE_BROWSER_TESTS
```

The fixture module is confined to `frontend/scripts/`, is never imported by the application/backend, and is absent from the production build. Offline screenshots go to the operating-system temporary directory, not the portfolio screenshots. Live-mode screenshots are generated in `documentation/screenshots/` only when the live browser run reaches that stage. No mock analytics are used in normal application behavior.

## Phase 8 explainable maintenance-health assessment

Open Health after selecting a repository. `GET /api/health?repo=owner/repository` calculates the score in FastAPI, with per-factor rules, evidence links, explanations, suggestions, and explicit data gaps. The frontend validates the arithmetic and renders the returned assessment; it does not apply its own scoring formula.

The fixed weights are commit-tip recency 25, README 15, license 10, stable GitHub release recency 15, sampled issue acknowledgement 20, and provable merged-PR recency 15. Complete scores sum to 0?100. Missing evidence is never assigned zero or normalized away: the overall score stays null, the orange ring says Unscored, and verified points plus possible bounds are shown. A complete zero remains a genuine zero. The page prominently explains that this is not an objective source-code quality, correctness, or security score.

See [the full scoring methodology](HEALTH_SCORING.md) for every band, sampling rule, absence/unavailability distinction, API field meaning, cache behavior, and interpretation limit. That document's rule table is generated from the backend rule definitions. Each factor also exposes its full rule directly in the UI.

Complete assessments are cached for two minutes with public-visibility revalidation and credential/version-separated keys; the dedicated Refresh assessment button sends `refresh=true`. Incomplete assessments are not cached. Rate-limit interruption preserves known factors, marks uncollected factors unavailable, and shares the existing UI retry cooldown without automatic retries.

Phase 8 verification passed 72 frontend tests and 164 backend tests, plus strict TypeScript and the production build. Tests cover fixed weights, exact recency boundaries, true zero versus unknown, future/invalid timestamps, sample rounding, self-replies and account associations, incomplete comment/PR pages, the three-page issue bound, timeout/rate-limit interruption, cache bypass/privacy, and frontend response integrity. Live `vuejs/core` verification produced a complete 84/100 assessment at the verification timestamp, with the UI matching each backend factor. This is a historical test observation, not a fixed repository score. Browser checks covered five widths in both themes, scoring-rule disclosure, evidence links, complete/incomplete/zero displays, loading states, shared cooldowns, and preserved overview navigation.

Re-run from the workspace root:

```powershell
.\backend\venv\Scripts\python.exe -B -m pytest backend/tests -q -p no:cacheprovider
cd frontend
npm test
npm run build
```

With the optional temporary Playwright setup described above, ports 5178 and 8000 free, and available GitHub quota:

```powershell
node frontend/scripts/verify-health.cjs
```

The browser script saves screenshots of the live assessment before running controlled test-only incomplete/zero/rate-limit response variants. Production scoring always uses the backend evidence collector.

[Health dark](screenshots/phase-8-health-dark.png) | [Health light](screenshots/phase-8-health-light.png) | [Health mobile](screenshots/phase-8-health-mobile.png)


## Phase 9: comparison and PDF reports

Open **Comparison**, enter two public GitHub repository URLs (or `owner/repository`), select a 7-, 30-, or 90-day commit window, and compare. The URL preserves both inputs and the window. Each side has independent loading and error states. Canonical aliases resolving to the same repository are identified. Charts compare stars, forks, and language percentages; cards show available activity and maintenance evidence. Partial histories and incomplete health assessments have no invented totals or overall score.

Open **Reports** for the selected repository, prepare a snapshot, review coverage, and download the PDF. Comparison cards also link directly to report preparation. PDFs contain available overview statistics, vector charts, top-contributor samples, bounded commit history, maintenance rules/evidence/suggestions, source links, and analysis/retrieval timestamps. Missing sections are explained and omitted. See [Phase 9 API and verification](COMPARISON_REPORTS.md) and the [generated live Vue report](reports/phase-9-vuejs-core.pdf).

Runtime PDF dependency: `reportlab>=5.1,<6`. Development checks use `pypdf>=7,<8` and `pymupdf>=1.26,<2`; install through the requirements files above. No additional frontend dependencies are required.

Verification from the project root:

```powershell
.\backend\venv\Scripts\python.exe -m pytest backend/tests -q
npm test --prefix frontend
npm run build --prefix frontend
```

Optional live browser verification (uses public GitHub quota, local ports 5178/8000, and installed Edge):

```powershell
$env:PLAYWRIGHT_MODULE="$env:TEMP/repolens-browser-review/node_modules/playwright"
node frontend/scripts/verify-comparison-reports.cjs
```

Use the temporary Playwright installation instructions elsewhere in this README first. The script owns and stops its server processes; leave those ports free. Generated sample files are verification artifacts, not application defaults.
