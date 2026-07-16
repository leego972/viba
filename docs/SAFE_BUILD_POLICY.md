# VIBA Safe Build Policy

## Rules

1. **Every task starts on a feature branch.** No work goes directly to `main`. Branch from the latest `main` HEAD and name the branch descriptively (e.g. `viba-safe-build-vault-hardening`).

2. **No experimental work straight to `main`.** `main` is the production branch (deployed via Render). It must always be deployable.

3. **`main` must always pass safe-build.** Every commit on `main` must pass `pnpm run safe-build` without hard failures.

4. **Merge only after safe-build passes.** Run `pnpm run safe-build` on the branch before opening a PR. If the report shows `"mergeAllowed": false`, fix the branch — do not merge.

5. **If safe-build fails, fix the branch — do not merge.** Investigate the `artifacts/reports/safe-build-report.json` report, fix the failing steps, and re-run. Never force-push to `main` to skip checks.

6. **High-risk features require extra verification.** If a feature touches any of the following, produce a manual verification report in addition to safe-build:
   - Browser automation / Playwright
   - Deployment provider connectors (Render, Railway, Vercel, etc.)
   - Payments (Stripe, billing, subscriptions, credits)
   - User credentials, secrets, vault, or BYOK keys
   - Auth, sessions, OAuth, or password flows
   - Server middleware, CORS, or public origin config

7. **A feature is "done" only when all of the following are true:**
   - Code is committed on a named branch
   - All new routes and components are mounted and reachable
   - `pnpm run typecheck` passes (zero errors)
   - `pnpm --filter @workspace/api-server run test` passes
   - `pnpm --filter @workspace/api-server run build` succeeds
   - `pnpm --filter @workspace/bridge-ai run build` succeeds
   - No secrets are leaked (no keys, tokens, or passwords in source, logs, or API responses)
   - A `safe-build-report.json` is generated and reviewed

## Safe Build Command

```bash
pnpm run safe-build
```

Generates `artifacts/reports/safe-build-report.json` with:
- `status` — `passed` or `failed`
- `mergeAllowed` — boolean
- `railwayDeployAllowed` — boolean
- `failedSteps` — list of blocking failures
- `warnings` — non-blocking issues (browser, Railway CLI (informational only))
- Per-step output (last 3000 chars)

## Branch Lifecycle

```
feature-branch → safe-build passes → PR opened → review → merge to main → Render deploys
```

Never:
- Push directly to `main`
- Merge a branch with a `failed` safe-build report
- Merge a branch that has typecheck errors
- Merge a branch where API tests are failing
