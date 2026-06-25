# VIBA Final-Only Replit Pass

Use this after reviewing branch `viba-final-polish-chatgpt`.

## Pull the final polish branch

```bash
git fetch origin
git checkout viba-final-polish-chatgpt
git pull origin viba-final-polish-chatgpt
```

## Confirm the branch contains ChatGPT's final repo-side changes

Required files:

- `artifacts/api-server/src/lib/billingFinancialSafety.ts`
- `artifacts/api-server/src/routes/stripeWebhook.ts`
- `artifacts/reports/chatgpt-final-polish-notes.md`

## Optional cleanup before build

If `artifacts/api-server/src/routes/billingFinancialSafety.ts` exists but is not mounted, either:

1. Mount it in `artifacts/api-server/src/routes/index.ts`, or
2. Delete it if typecheck reports it as unused.

Do not remove the persistent webhook idempotency code from `billingFinancialSafety.ts`.
Do not remove the `stripeWebhook.ts` changes.

## Run final checks

```bash
pnpm install --no-frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/bridge-ai run build
pnpm run safe-build
```

## Check launch readiness

Start the app if required, then run:

```bash
curl -X POST http://localhost:3000/api/launch-readiness/run \
  -H "Content-Type: application/json" \
  -H "x-admin-token: $ADMIN_TOKEN"

curl http://localhost:3000/api/launch-readiness/evidence-pack \
  -H "x-admin-token: $ADMIN_TOKEN"
```

## Manual owner UI check

Open:

- `/dashboard`
- `/onboarding`
- `/security-center`
- `/secure-vault` or credentials page
- `/agent-console`
- `/tool-console`
- `/qa-release-gate`
- `/project-import`
- `/production-ops`
- `/launch-readiness`
- `/billing`

Confirm:

- no raw secrets display
- no console errors
- mobile nav does not overflow
- billing page loads
- launch readiness page loads
- QA gate loads
- vault metadata only
- custom AI key input clears after save

## Final report required

Return:

```text
Branch:
Commit:
ChatGPT final polish branch merged into integration branch: yes/no
Persistent Stripe webhook idempotency: pass/fail
Paid credit reset transaction: pass/fail
Existing features removed: yes/no
Existing routes removed: yes/no
Security weakened: yes/no
Typecheck:
API tests:
API build:
Frontend build:
Safe build:
Launch readiness status:
Remaining blockers:

FINAL PROGRAM BUILD PASSED — READY FOR OWNER MERGE
```

If any check fails, do not merge. Report exact failing file, error, and command.
