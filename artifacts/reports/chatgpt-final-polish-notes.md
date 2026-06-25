# ChatGPT Final Polish Notes

Branch: `viba-final-polish-chatgpt`

This branch adds one final repo-side hardening item that could be safely completed from ChatGPT without runtime access:

- Adds persistent Stripe webhook event reservation/status tracking in `artifacts/api-server/src/lib/billingFinancialSafety.ts`.
- Updates `artifacts/api-server/src/routes/stripeWebhook.ts` to use persistent webhook idempotency rather than only the old in-memory guard.
- Updates paid credit renewal reset to use a dedicated PostgreSQL client transaction so the user credit update and ledger insertion commit/rollback together.

Runtime checks still required in Replit:

- `pnpm install --no-frozen-lockfile`
- `pnpm run typecheck`
- `pnpm --filter @workspace/api-server run test`
- `pnpm --filter @workspace/api-server run build`
- `pnpm --filter @workspace/bridge-ai run build`
- `pnpm run safe-build`

A separate optional route for reading financial-safety status was created but could not be mounted from ChatGPT because the route-registry update was blocked by safety controls. Replit should either mount it safely or delete the unused route if typecheck requires it. The core webhook hardening itself is wired through `stripeWebhook.ts`.
