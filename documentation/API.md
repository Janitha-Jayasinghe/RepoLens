# API reference

Base URL locally: `http://127.0.0.1:8000`. Interactive schemas: `/docs`; machine-readable contract: `/openapi.json`. All application routes are read-only GET requests. No browser token parameter is supported. Only public GitHub repositories are accepted.

| Endpoint | Parameters | Result / coverage |
| --- | --- | --- |
| `/` | none | Original status/message, also container liveness |
| `/api/analyze` | `repo` | Canonical repository metadata, overview counts and source/time |
| `/api/languages` | `repo` | Language byte map and full detected total |
| `/api/contributors` | `repo` | First page, up to 10 ranked contributors, `has_more`; not all contributors |
| `/api/commits` | `repo`, `days=30`, `author` optional | 7/30/90 UTC-day bounded history, pinned default-branch head, max 500 commits; daily chart only when range exhausted |
| `/api/issues` | `repo`, `state=all`, `page=1`, `per_page=20`, `refresh=false` | Raw GitHub pagination with PRs removed; state open/closed/all |
| `/api/pull-requests` | same | State open/closed/merged/all; closed excludes merged |
| `/api/work-items/summary` | `repo`, `refresh=false` | Separate search counts; incomplete results explicitly unavailable |
| `/api/health` | `repo`, `refresh=false` | Six weighted maintenance signals, rules, evidence, suggestions, uncertainty; overall score only with complete evidence |
| `/api/snapshot` | `repo`, `days=30`, `refresh=false` | Immutable expiring multi-section snapshot; individual failures retained |
| `/api/reports/{snapshot_id}.pdf` | UUID path | Server-held PDF after public-visibility check; expires in five minutes |

`repo` accepts `owner/repository` or a GitHub repository URL. Issue/PR pages range 1?1000; page size 1?100. Defaults and full field definitions are in OpenAPI, which is generated from the actual models. Sample requests:

```sh
curl 'http://127.0.0.1:8000/api/analyze?repo=vuejs/core'
curl 'http://127.0.0.1:8000/api/commits?repo=octocat/Hello-World&days=7'
curl 'http://127.0.0.1:8000/api/issues?repo=vuejs/core&state=open&page=1'
```

Errors use `detail: {code, message, ...}`; FastAPI parameter-validation failures use its standard `detail` array. Typical status codes: 404 missing/private, 410 expired snapshot, 422 invalid input, 429 GitHub rate limit (`Retry-After`), 502 upstream/credential failure, 503 GitHub preparing data, 504 timeout. Partial health and snapshot responses can be HTTP 200 with explicit missing evidence; inspect payload status rather than assuming completeness.

No analytics response should be stored by shared HTTP caches. Application caches retain timestamps and check public visibility; they are bounded and process-local. See [health methodology](HEALTH_SCORING.md) and [snapshot/PDF details](COMPARISON_REPORTS.md). A reverse proxy adds deployment-specific rate limiting; CORS is not authentication or abuse prevention.
