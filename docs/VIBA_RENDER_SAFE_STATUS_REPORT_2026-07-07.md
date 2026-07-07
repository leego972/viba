# VIBA Render-Safe Status Report — 2026-07-07

Branch: `audit/viba-render-safe-status-20260707-report`

Purpose: capture the current VIBA repo state without changing runtime/build code and without risking the live Render build.

## Safety outcome

This branch is documentation-only. It does not change:

- `package.json`
- `render.yaml`
- `render-build.sh`
- API runtime files
- frontend runtime files
- database schema
- deployment engine code
- Render start/build commands

Therefore this branch should not change the Render build output.

## Render build contract found on `main`

The current Render service contract is:

- service name: `viba`
- runtime: `node`
- build command: `bash render-build.sh`
- start command: `npm start`
- health check path: `/api/healthz`
- auto deploy trigger: `commit`
- required pinned env defaults in `render.yaml`:
  - `COREPACK_INTEGRITY_KEYS=0`
  - `NODE_ENV=production`
  - `NODE_VERSION=22.22.1`
  - `PNPM_VERSION=10.24.0`

The root `package.json` currently enforces pnpm via `preinstall`, starts the API with:

```bash
node --enable-source-maps artifacts/api-server/dist/index.mjs
```

and builds using:

```bash
pnpm run typecheck && pnpm -r --if-present run build
```

`render-build.sh` currently:

1. sets production/runtime safety env vars,
2. disables Playwright browser download for Render,
3. installs with pnpm,
4. builds `@workspace/bridge-ai`,
5. builds `@workspace/api-server`,
6. verifies Render output via `scripts/verify-render-output.mjs`.

These files are the Render protection boundary. Do not change them inside feature PRs unless the branch proves `bash render-build.sh` passes.

## Deploy engine status found in code

The VIBA deploy module is present in `main` under:

```txt
artifacts/api-server/src/modules/deploy/
```

Observed deployed-code capabilities:

- deploy routes exist and are mounted at `/api/deploy` behind the access-token middleware.
- GitHub deploy routes exist and are mounted at `/api/deploy/github`.
- GitHub webhook verification exists before webhook work is accepted.
- push webhooks create `GITHUB_PUSH` deployment records when repo and branch match.
- manual deployment, redeploy, rollback, env, add-on, and domain endpoints exist.
- deployment pipeline has a Docker path and a Render-backed fallback path.
- Render adapter supports service creation, deploy trigger, deploy polling, env sync, Postgres, Redis, and custom domains.
- add-on creation writes managed `DATABASE_URL` / `REDIS_URL` values into encrypted env storage.

Important: presence in code is not the same as verified production operation. I did not run Docker, Caddy, Render API calls, database migrations, or live GitHub App webhook tests from this connector.

## PR status observed

Open PR #21 exists:

`feat: VIBA Deploy Engine — GitHub App auto-deploy, managed add-ons, encrypted secrets, AI diagnosis`

Important PR metadata observed:

- state: open
- merged: false
- mergeable: false
- base: `main`
- head: `feature/viba-deploy-engine-github-autodeploy-addons`
- changed files: 22
- additions: 3660
- deletions: 1
- PR body claims:
  - typecheck passed
  - 44 tests passed
  - Docker E2E blocked because Docker unavailable in Replit
  - Caddy live routing blocked because VPS/Caddy required
  - GitHub App env vars blocked until configured

Recommendation: do not merge PR #21 while `mergeable=false`. Rebase or close it after confirming whether its files are already present on `main`.

## Latest main commit workflow evidence

Latest observed main commit:

```txt
f77120fd014e050824f889fffd9f0432f822675d
fix: dashboard CTA buttons size="sm" instead of size="lg"
```

No GitHub Actions workflow runs were found for that commit through the connector. That means I cannot claim CI passed on GitHub for latest `main`.

## Feature inventory status

| Feature | Current status | Reason |
|---|---|---|
| Render build contract | PRESENT | `render.yaml`, root scripts, and `render-build.sh` exist. |
| `/api/healthz` | PRESENT | API app defines health endpoint. |
| GitHub App deploy routes | PRESENT IN CODE | Mounted under `/api/deploy/github`. |
| Deploy engine routes | PRESENT IN CODE | Mounted under `/api/deploy`. |
| Manual deploy | PRESENT IN CODE | `/projects/:projectId/deploy`. |
| Redeploy | PRESENT IN CODE | `/projects/:projectId/redeploy`. |
| Rollback | PRESENT IN CODE | `/projects/:projectId/rollback`. |
| Managed Postgres add-on | PRESENT IN CODE | Docker/Render path exists. Not live-tested. |
| Managed Redis add-on | PRESENT IN CODE | Docker/Render path exists. Not live-tested. |
| Render deployment adapter | PRESENT IN CODE | Service/deploy/env/add-on methods exist. Not live-tested. |
| Docker deployment adapter | PRESENT IN CODE | Docker path exists. Not live-tested. |
| Caddy routing | PRESENT IN CODE | Caddy adapter referenced. Not live-tested. |
| GitHub webhook auto-deploy | PRESENT IN CODE | Signature check and branch filtering exist. Not live-tested. |
| Secret encryption/log masking | PRESENT IN CODE | `secrets.service` used by deploy service. Not independently tested here. |
| Build/typecheck/test proof | NOT VERIFIED HERE | Connector cannot run `pnpm` or Docker. |
| Render production deploy proof | NOT VERIFIED HERE | Connector cannot access Render logs/deploys. |

## Render-safe merge gate

Before any feature PR touches `main`, run this exact gate in Replit or local/VPS:

```bash
corepack enable
pnpm install --no-frozen-lockfile --prod=false
pnpm run typecheck
pnpm test
bash render-build.sh
npm start
curl -f http://localhost:3000/api/healthz || curl -f http://localhost:${PORT:-3000}/api/healthz
```

If `npm start` uses a different bound port in Render, document the actual port and confirm `/api/healthz` responds.

## Render-specific no-break rules

Do not merge a feature PR into `main` if it changes any of these without passing `bash render-build.sh`:

- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `render.yaml`
- `render-build.sh`
- `scripts/verify-render-output.mjs`
- `artifacts/api-server/package.json`
- `artifacts/bridge-ai/package.json`
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/index.ts`
- database schema/migration files
- auth/access-token middleware
- session middleware
- static frontend serving path

## Next safe action order

1. Keep Render production on latest known working `main` until proof exists.
2. Rebase or close stale open PRs that are already represented on `main`.
3. Run the Render-safe merge gate locally/Replit.
4. Only after green gate, deploy latest `main` to Render.
5. Configure deploy-engine secrets on a staging Render service first, not production:
   - `RENDER_API_KEY`
   - `RENDER_OWNER_ID`
   - `GITHUB_APP_ID`
   - `GITHUB_APP_CLIENT_ID`
   - `GITHUB_APP_CLIENT_SECRET`
   - `GITHUB_APP_PRIVATE_KEY_BASE64`
   - `GITHUB_APP_WEBHOOK_SECRET`
   - `GITHUB_APP_CALLBACK_URL`
   - `PUBLIC_VIBA_DEPLOY_URL`
6. Test GitHub App install/callback/webhook on staging.
7. Test one sample deployment on staging.
8. Test managed Postgres and Redis creation on staging.
9. Test rollback on staging.
10. Only then expose deploy features in production UI.

## Work I did not do

I did not modify production code.
I did not merge PRs.
I did not run Docker/Caddy.
I did not run Render API calls.
I did not change secrets.
I did not touch the live Render build configuration.
