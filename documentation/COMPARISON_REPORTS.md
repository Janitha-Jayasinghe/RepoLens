# Phase 9 ? Comparison and PDF reports

## Implementation

- `backend/snapshot_api.py`: snapshot orchestration, bounded caches, report endpoint.
- `backend/pdf_reports.py`: embedded-font ReportLab PDF layout and vector charts.
- `backend/main.py`: existing analytics services reused, PDF headers exposed through CORS; existing routes retained.
- `frontend/src/pages/ComparisonPage.tsx`, `ReportsPage.tsx`: responsive workflows with validation, independent loading/errors, cancellation, success feedback.
- `frontend/src/services/{snapshot,comparison}.ts`, `types/snapshot.ts`: runtime response validation, strict typed sections, shared calculations and binary download validation.
- `frontend/src/components/analytics/ComparisonCharts.tsx`: responsive branded Recharts comparisons.
- Existing centralized API service, rate-limit handling, router, shell, and CSS extended.

## API

`GET /api/snapshot?repo=vuejs/core&days=7&refresh=false`

Accepts the same repository identifiers as overview. Supported windows: 7, 30, 90 UTC calendar days. Verifies public canonical metadata, then collects languages, contributor sample, bounded commits, and existing maintenance assessment. Each section has `status`, `data`, or a structured `error`; partial failures preserve successful sections. Rate limits stop further collection. Total collection budget is 55 seconds; frontend timeout is 65 seconds. `collection_complete` means section retrieval succeeded, not that commit history or maintenance evidence is complete. Inspect each section's coverage/status.

Immutable snapshot UUIDs are retained for five minutes in a bounded 64-entry in-memory cache. Repository/window lookups reuse snapshots for up to two minutes, with a fresh public-visibility check. `refresh=true` bypasses that lookup. Cache keys include backend credential scope. Server restarts, eviction, or expiry require new preparation. Existing health caching retains its own timestamps.

`GET /api/reports/{snapshot_uuid}.pdf`

Exports exactly the server-held snapshot, after rechecking public visibility. Does not accept client statistics or recollect analytics. Returns `application/pdf`, attachment filename, `Cache-Control: no-store`, and `X-RepoLens-Snapshot`. Missing/expired snapshots return 410. Invalid identifiers and GitHub/network errors use existing structured API errors. PDF rendering runs in a worker thread.

## Accuracy and layout

Star/fork counts retain real zero values. Language percentages use each repository's complete detected-byte denominator; missing distributions have no zero-filled percentages. Daily commit charts appear only for exhausted bounded ranges. Contributors are explicitly the returned top-10 sample, not a complete population. Combined open issues and PRs are labeled correctly. Incomplete maintenance assessments retain factor evidence without an overall score. These are maintenance heuristics, never an objective source-code quality ranking.

PDFs use embedded Vera fonts, black text, white paper, jet-orange accents, native vector charts, linked sources, retrieval times and a generation timestamp. Unsupported font characters use explicit Unicode code-point notation; the report explains this substitution. Extremely long commit subjects are shortened with an explicit marker and a link to GitHub. Unavailable optional metadata and unavailable analytics are omitted with explanations, never fabricated.

## Verification ? 9 November 2026

- Backend: **178 tests passed**, including immutable exports, expiry, cache/refresh, visibility, unavailable sections, rate limits, strict PDF parsing, embedded fonts, source links, palette, text bounds, escaping, and long content.
- Frontend: **82 tests passed**, covering validators, comparison transformations, genuine zero versus unavailable, partial commits, snapshot requests, PDF MIME/signature checks, safe filenames, and expired downloads.
- Strict TypeScript and Vite production build passed.
- Live browser: `vuejs/core` and `octocat/Hello-World`; displayed star/fork values checked against returned snapshots. Both retrieved all requested sections; Hello-World health remained incomplete. Invalid URL rejected before submission. Comparison layout checked at 320, 375, 768, 1024 and 1440 pixels in both themes; no horizontal overflow or JavaScript page errors.
- Report preparation reused the exact Vue comparison snapshot UUID. Actual browser download produced a **7-page, 64,018-byte PDF**, parsed with pypdf and PyMuPDF; every extracted text span stayed inside its page. First page rendered and inspected visually. Live metadata is recorded in `reports/phase-9-live-verification.json`; values can change on GitHub.
- Screenshots: `screenshots/phase-9-comparison-dark.png`, `phase-9-comparison-light.png`, `phase-9-reports.png`, `phase-9-pdf-preview.png`.

Only Phase 9 is implemented. Settings and any subsequent phase remain outside this change.
