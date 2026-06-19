---
name: VIBA Credit Billing System
description: Stripe subscription + credit billing — architecture decisions, env vars, and key patterns
---

## Plan
- $50/month, 7-day free trial (card captured upfront, auto-charged day 8)
- 1,000 credits/month included; credit top-up packs available when exhausted
- Services suspended (never data deleted) on lapsed subscription or zero credits
- The admin bootstrap account (email set via ADMIN_BOOTSTRAP_EMAIL env var) gets infinite credits (999999999) and subscription_status='active'

## Key files
- `artifacts/api-server/src/lib/billing.ts` — Stripe singleton, product auto-provisioning, credit CRUD, subscription helpers
- `artifacts/api-server/src/lib/billingEmail.ts` — email notifications (payment failed, canceled, credits exhausted)
- `artifacts/api-server/src/routes/billing.ts` — billing REST routes
- `artifacts/api-server/src/routes/stripeWebhook.ts` — Stripe webhook (handles both new billing + legacy subscriber flow)
- `artifacts/bridge-ai/src/pages/billing.tsx` — billing management UI
- `artifacts/bridge-ai/src/pages/pricing.tsx` — public pricing page
- `artifacts/bridge-ai/src/pages/checkout-success.tsx` — polls /api/billing/status until active

## DB columns added via startup migrations (index.ts)
Users table: stripe_customer_id, stripe_subscription_id, subscription_status, credits_remaining, credits_period_end, credits_exhausted_notified_at

## Credit gate
Middleware in app.ts on `/api/sessions/:id/run-next` and `/api/sessions/:id/run-full`.
Returns 402 with `error_code: "subscription_required"` or `"out_of_credits"`.
Bypass users (Archibald embed) are always exempt. Fails open on billing errors.

## Env vars (Railway)
STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET.
Products/prices are auto-provisioned at startup if env vars not set — no manual Stripe dashboard setup needed.

## Session types
express-session SessionData augmentation lives in `artifacts/api-server/src/types/session.d.ts` (global, picked up by all route files). Do NOT duplicate in individual route files.

## Post-merge drizzle-kit TTY issue
`drizzle push` prompts for TTY when adding unique constraints to non-empty tables.
Workaround: apply constraints directly via SQL (`ALTER TABLE ... ADD CONSTRAINT ... UNIQUE`).
**Why:** CI/non-TTY environments can't answer drizzle-kit's interactive prompt.
**How to apply:** Add idempotent SQL (`DO $$ BEGIN ... EXCEPTION WHEN duplicate_table THEN NULL; END $$;`) instead of relying on drizzle push for constraints on live tables.
