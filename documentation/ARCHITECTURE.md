# Architecture and design decisions

```text
Browser: React + Router + strict TypeScript
  CSS tokens / Tailwind / Recharts / local theme preference
      | centralized API client, schema validation, cancellation
      v
FastAPI: validation -> public canonical repository verification
  main.py           overview, languages, contributor sample
  commit_history.py bounded history normalization + UTC aggregation
  work_items.py     separated issue/PR queues, search counts, TTL cache
  health_api.py -> health_scoring.py: evidence -> transparent weighted rules
  snapshot_api.py   immutable section snapshots -> pdf_reports.py
      | HTTPX: server-only token, timeouts, rate-limit translation
      v
GitHub REST API
```

The frontend stores repository/window/filter context in URLs and the appearance preference in optional local storage. No repository dataset or secret is bundled. Shared repository state preserves navigation context; on-demand analytics avoid fetching every expensive endpoint on every page. Abort signals and generation guards discard stale responses. Global and route-level error boundaries provide recovery; the shell survives page render failures.

Pydantic models validate backend responses. Normalizers and aggregation functions are independently testable. API tests use HTTPX MockTransport; production code always requests GitHub. PDF exports use server snapshots rather than trusting browser-provided counts. ReportLab emits embedded-font text and native vector charts without remote image fetching.

Bounded in-memory caches are scoped by server credential fingerprint, repository and query parameters. Metadata visibility is rechecked before reuse and export. One process is required for reliable report-ID lookup. Horizontal scaling needs shared cache/storage and distributed quota controls first. There is no database, user account system or background polling.

Testing layers: Vitest transformation/client contracts plus jsdom keyboard/recovery tests; Pytest scoring, normalization, API failure/security contracts and PDF parsing/render inspection; optional Playwright live GitHub checks; CI frontend/backend jobs and container smoke checks. Fixtures are synthetic test data and never production fallbacks.

Tradeoffs: bounded commit history prevents unbounded API use but cannot always produce a complete chart. Top-10 contributor coverage is explicit. Maintenance heuristics explain repository signals rather than source-code quality. Separate sections have separate source timestamps and are not an atomic GitHub transaction.
