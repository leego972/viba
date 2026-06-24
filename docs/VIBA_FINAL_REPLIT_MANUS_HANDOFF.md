# VIBA Final Replit + Manus Handoff

Branch: `viba-full-product-completion`
PR: #4

## Current status

The branch contains the market-readiness surfaces, provider/config pages, public demo pages, session timeline/map, usage/recovery/team/client/security/report comparison surfaces, and routing changes.

Replit reported:
- API typecheck: clean
- frontend typecheck: clean
- API build: pass
- frontend build: pass
- tests: 289/289 pass

## Critical review warning

Some endpoints were reported as stubs/planned. They must not remain stubs before the PR is marked ready.

Fix these routes into thin functional loops:

- `POST /api/crews/:id/start-session`
- `GET /api/team`
- `POST /api/team/invite`
- `PATCH /api/team/:memberId`
- `GET /api/clients`
- `POST /api/clients`
- `PATCH /api/clients/:id`
- `GET /api/clients/:id/reports`
- `GET /api/reports/compare`
- `GET /api/connectors/status`
- approved Doctor repair PR generator if not fully wired

## Product rules

- No deployment from this branch.
- No merge until owner approval.
- No Stripe live activation inside the code sprint.
- No paid providers enabled by default.
- No secrets printed or committed.
- No fake completion reports.

## Replit final build pass

Replit must replace all planned/stub returns with real thin loops:

1. Crews must create supervised simulation sessions.
2. Team must persist role records or expose safe role/capability matrix with member table.
3. Clients must persist client records and linked reports.
4. Report comparison must compare stored Doctor reports.
5. Connector status must be env/vault/config based, with no secret values returned.
6. Approved Doctor self-repair must create a branch/PR only after explicit confirmation, or must clearly remain blocked until GitHub credential is available.

## Manus production setup pass

After PR #4 is reviewed, merged, and main CI is green, Manus should handle production setup only:

### Railway env vars

Required:
- `DATABASE_URL`
- `SESSION_SECRET`
- `PUBLIC_ORIGIN`
- `ACCESS_TOKEN`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

Optional/only when owner approves live billing/providers:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PUBLISHABLE_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `RAILWAY_TOKEN`
- `GITHUB_TOKEN`
- `CREDENTIAL_ENCRYPTION_KEY`

Rules:
- Values are entered in Railway only.
- Never paste secret values into GitHub, logs, PR comments, or ChatGPT.
- Report present/missing by name only.

### Stripe setup

Only after owner approval:
- create products/prices matching current app pricing
- configure webhook endpoint to Railway production URL
- enable required webhook events
- set Stripe env vars in Railway
- run webhook test
- do not change app pricing without owner approval

### Domain setup

- Connect production domain to Railway.
- Configure DNS records from Railway.
- Verify SSL issued.
- Confirm `PUBLIC_ORIGIN` matches production domain.
- Confirm CORS allows production domain.

### Final production smoke test

Run after deploy:
- health endpoint
- signup
- email verification
- login/logout
- create session
- provider page loads, default off
- connector page loads
- Doctor run/history/report/proposal/checklist/implementation plan
- proof report exports
- share report link
- demo pages public
- market readiness
- mobile iPhone Safari layout

Final recommendation must be either:
- `Ready for controlled launch`
- or `Blocked`, with exact blockers.
