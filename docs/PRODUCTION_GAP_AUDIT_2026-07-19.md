# VIBA / BridgeAI Production Gap Audit — 2026-07-19

Branch: `checkpoint/production-hardening-20260719`
Base: `main` at `70f9982b0b2fe0162d4a0b9fda99311beadc5c01`

## Audit position

VIBA is no longer just the earlier simple BridgeAI connector. The active repository is `leego972/viba`, formerly reachable through `leego972/bridge-ai`, and it now contains a broad multi-agent SaaS platform:

- Express API server
- React/Vite frontend
- PostgreSQL / Drizzle schema layer
- session orchestration
- provider connections
- encrypted credential vault
- auth and billing foundation
- deployment modules
- admin maintenance modules
- SEO / content / growth modules

The product is commercially promising, but production readiness must be based on verified build/test evidence, not claims.

## Fixes applied in this checkpoint

### 1. Provider secrets now save to encrypted vault from Settings

File changed:

- `artifacts/api-server/src/routes/settings.ts`

Before this checkpoint, the Settings route masked API keys when returning them to the frontend, but Settings-saved provider secrets could still be inserted into `settingsTable` as normal values.

Changed behavior:

- Provider API keys are written through `saveVibaCredential()`.
- Legacy plaintext setting rows for provider keys are deleted after vault save.
- Deleting a key clears both the legacy setting and the encrypted vault entry.
- Provider enable/disable flags still stay in normal settings.
- Vault-backed provider keys are returned to Settings as `***SET***` synthetic safe values so the UI still shows them as configured.
- Credential save/delete events are written through `logVibaEvent()`.

Provider secret keys covered:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `PERPLEXITY_API_KEY`
- `MISTRAL_API_KEY`
- `DEEPSEEK_API_KEY`
- `GROQ_API_KEY`
- `VENICE_API_KEY`
- `CUSTOM_API_KEY`
- `GITHUB_TOKEN`
- `VAST_AI_API_KEY`
- `ELEVENLABS_API_KEY`
- `RAILWAY_TOKEN`

### 2. Missing provider endpoint settings were added to allow-list

File changed:

- `artifacts/api-server/src/routes/settings.ts`

Added allowed config keys:

- `VENICE_ENDPOINT`
- `DEEPSEEK_ENDPOINT`
- `GITHUB_ENDPOINT`
- `RAILWAY_TOKEN`
- `RAILWAY_REASONING_MODEL`

This prevents valid provider configuration from being rejected as unknown.

### 3. Production startup now requires a dedicated credential vault key

File changed:

- `artifacts/api-server/src/app.ts`

In production, the server now refuses to start unless at least one of these is configured:

```txt
CREDENTIAL_ENCRYPTION_KEY
MASTER_ENCRYPTION_KEY
```

This avoids silently relying on a generic session secret for encrypted credential storage in production.

### 4. Central session ownership guard added

File changed:

- `artifacts/api-server/src/app.ts`

A central ownership guard now protects every concrete `/api/sessions/:id` route before individual route handlers run.

Rules:

- unauthenticated users receive `401`
- invalid IDs receive `400`
- missing sessions receive `404`
- users trying to access someone else’s session receive `403`
- controlled bypass mode still works for the embed path

This reduces the chance that a new future handler accidentally trusts only a numeric session ID.

### 5. Session list route now owner-scoped

Files changed:

- `artifacts/api-server/src/routes/sessionList.ts`
- `artifacts/api-server/src/routes/index.ts`

The secure session list route is registered before the legacy sessions router. Normal authenticated users now see only sessions where `sessions.user_id` matches their user ID.

Bypass mode keeps broader visibility for the controlled embed use case.

### 6. Users DB schema aligned with startup migrations

File changed:

- `lib/db/src/schema/users.ts`

Added schema fields already created by startup migrations:

- `autoTopupEnabled`
- `autoTopupThreshold`
- `autoTopupPackKey`
- `planKey`
- `deletedAt`

This reduces schema drift between Drizzle definitions and live startup migrations.

### 7. GitHub Actions CI added

File added:

- `.github/workflows/ci.yml`

CI now runs:

- pnpm install with frozen lockfile
- DB schema push against Postgres service
- typecheck
- API tests
- full build
- safe build gate

## Remaining gaps that require runtime verification

These are not safe to mark complete until Replit/GitHub Actions/Railway actually run the checks.

### Build and typecheck

Required commands:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/api-server run test
```

Do not merge this checkpoint until those pass.

### Settings vault behavior

Manual test:

1. Log in.
2. Save an OpenAI key in Settings.
3. Confirm Settings returns `***SET***`.
4. Confirm `settings` table does not contain the plaintext API key.
5. Confirm `viba_credentials` contains encrypted vault rows.
6. Confirm provider status shows configured.
7. Clear the key.
8. Confirm provider status becomes disabled/not configured.

### Session isolation

Manual/API test:

1. Create User A and User B.
2. User A creates a session.
3. User B attempts:
   - `GET /api/sessions/:id`
   - `PATCH /api/sessions/:id`
   - `DELETE /api/sessions/:id`
   - `POST /api/sessions/:id/run-next`
   - `POST /api/sessions/:id/run-full`
   - `GET /api/sessions/:id/stream`
4. Expected: `403` for User B.
5. User B calls `GET /api/sessions`.
6. Expected: User A’s session is not listed.

### Billing gates

Manual Stripe test mode verification is still required:

- subscribe
- billing portal
- cancellation
- expired payment
- credit depletion
- route access after cancellation

### Admin/source-repo controls

Must verify normal users cannot trigger:

- self repair
- self audit
- checkpoint
- merge
- admin maintenance
- source repository write operations

### Frontend flow

Must verify in browser/mobile:

- landing page
- signup/login/logout
- provider settings
- dashboard
- session creation
- live workflow
- stop/reopen
- approvals
- export
- billing page
- admin dashboard visibility

## Market-competing gaps not fixed in this checkpoint

These are product/architecture improvements larger than a safe one-pass patch.

### Durable workflow queue

Current long workflow execution still needs verification. A market-grade platform should move full workflow execution behind a durable queue such as BullMQ/Redis or a DB-backed job queue.

Target behavior:

- `POST /api/sessions/:id/run-full` returns a job ID
- worker executes steps
- retries are durable
- cancellation is durable
- result is resumable after server restart

### Organization/workspace model

The app is user-scoped. A market-grade team SaaS should add:

- organizations
- workspaces
- roles
- invitations
- workspace-scoped credentials
- workspace-scoped sessions
- admin/member/viewer permissions

### SSE/event streaming durability

The live stream should be verified for scale. Best production design:

- workflow_events table
- delta events
- `Last-Event-ID` support
- no full-session polling under load

### Full provider cost ledger

A market-grade AI orchestration tool needs exact or estimated per-run usage:

- provider
- model
- latency
- input tokens
- output tokens
- cost
- fallback reason
- quality score
- user/session/workspace attribution

### Security test coverage

Add automated tests for:

- cross-user session access denial
- settings vault save/mask/delete
- production startup refusing missing vault key
- CORS denial in production
- cancellation behavior
- billing gate failures

## Recommended Replit order from here

1. Pull branch `checkpoint/production-hardening-20260719`.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm run typecheck`.
4. Fix the first TypeScript error only, then rerun.
5. Run `pnpm --filter @workspace/api-server run test`.
6. Run `pnpm run build`.
7. Start server with production-like env.
8. Test auth, settings vault, and session isolation first.
9. Only after those pass, continue UI or feature work.

## Production verdict

Current checkpoint status: `HARDENED, NOT YET VERIFIED`.

Do not call it 100% production-ready until CI and manual smoke tests pass in the real environment.
