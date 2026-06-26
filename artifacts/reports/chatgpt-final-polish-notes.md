# ChatGPT Final Polish Notes

Branch: `viba-final-polish-chatgpt`

This branch adds one final repo-side hardening item that could be safely completed from ChatGPT without runtime access:

- Adds persistent Stripe webhook event reservation/status tracking in `artifacts/api-server/src/lib/billingFinancialSafety.ts`.
- Updates `artifacts/api-server/src/routes/stripeWebhook.ts` to use persistent webhook idempotency rather than only the old in-memory guard.
- Updates paid credit renewal reset to use a dedicated PostgreSQL client transaction so the user credit update and ledger insertion commit/rollback together.

CI cleanup:

- Removed the optional unmounted financial-safety status route to keep the final polish focused on the live Stripe webhook path only.
- The core hardening remains wired through `stripeWebhook.ts`.

Required GitHub/Replit checks:

- `pnpm install --no-frozen-lockfile`
- `pnpm run typecheck`
- `pnpm --filter @workspace/api-server run test`
- `pnpm --filter @workspace/api-server run build`
- `pnpm --filter @workspace/bridge-ai run build`
- `pnpm run safe-build`
