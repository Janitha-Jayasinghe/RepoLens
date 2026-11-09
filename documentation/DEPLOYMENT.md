# Deployment

## Recommended portfolio deployment

Use the supplied Compose stack on a small Linux host behind a TLS reverse proxy. It serves the static Vite build with unprivileged Nginx and proxies `/api/` to one unprivileged FastAPI container. The API has no published host port. Configure a DNS name, HTTPS termination, request/body/concurrency limits and monitoring at the host ingress. The supplied port binds only to localhost; forward from the host ingress to `127.0.0.1:8080`.

```sh
# Create root .env from .env.example only if absent; configure public origin and token.
docker compose config --quiet
docker compose build
docker compose up -d --wait
curl http://localhost:8080/api/healthz
# Stop without deleting application source:
docker compose down
```

For a real domain set `VITE_API_BASE_URL=https://repolens.example` before building and `CORS_ORIGINS=https://repolens.example` at runtime. Replace the example host. Vite configuration is public and baked into JavaScript; changing it requires rebuilding. Put GITHUB_TOKEN only in backend runtime environment/host secret management. Do not use `--reload` in production. Keep one backend worker/replica because snapshot IDs live in memory. Rolling restarts invalidate prepared reports.

Nginx handles SPA deep links, fingerprinted assets, API timeouts and a basic per-IP limit. This limit is not a complete quota or distributed abuse-control system. Add authenticated access or stronger edge controls before exposing a shared GitHub token to significant public traffic. Health probes test liveness, not GitHub availability; they consume no GitHub quota.

An alternative is static frontend hosting with SPA rewrites plus a separately hosted FastAPI service. Set the public API URL at frontend build time and allow only the frontend origin through backend CORS. Keep API HTTPS to avoid mixed-content failures. Never serve production traffic with Vite dev or preview servers. Avoid GitHub Pages subpath hosting unless Router basename and Vite base are configured together.

Container files are prepared and validated structurally locally. The local Docker engine was unavailable during this review, so actual image builds and container smoke tests must be run by the added CI job or on a host with Docker running. CI has not been executed on GitHub yet.

References: [Vite static deployment](https://vite.dev/guide/static-deploy), [FastAPI containers](https://fastapi.tiangolo.com/deployment/docker/).
