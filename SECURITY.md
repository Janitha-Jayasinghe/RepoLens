# Security and operational boundaries

RepoLens supports public repositories only. GITHUB_TOKEN is read on the server and never accepted from browser input, returned in errors, or included in VITE_ variables. Use a token with the minimum permissions required for public read access; do not grant private repository access for this application. Rotate a leaked token immediately and remove it from Git history before publishing.

The .gitignore excludes .env files, dependencies, logs, virtual environments and build output, while retaining .env.example templates. Docker build context excludes all local environment files. Containers receive tokens at runtime only. Review `git status` and staged changes before pushing. Never paste tokens into issue reports, screenshots, shell command arguments or repository URLs.

Input validation restricts repository identifiers to GitHub; HTTPX connects to GitHub's API with explicit timeouts. Public visibility is verified even when server credentials can read more. Cross-origin reads are restricted to configured origins. CORS does not authenticate callers or protect the backend from direct traffic. Responses disable shared caching and MIME sniffing. The provided proxy adds a basic request-rate limit; stronger shared-quota/concurrency controls remain a deployment responsibility.

Report snapshot IDs are opaque expiring identifiers, not user authorization. All application data is public. In-memory caches are credential-scoped and bounded. No private analytics should be added without authentication and an authorization design.

Report a suspected vulnerability privately to the repository owner through an available private contact or GitHub private vulnerability reporting. Do not include live credentials in public issues. No contact address is invented here.
