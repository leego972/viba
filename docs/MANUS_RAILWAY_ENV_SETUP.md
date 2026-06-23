# Manus Railway Environment Setup — VIBA / Bridge AI

Use this checklist after merging/deploying the PR to Railway. Do not commit real secret values to GitHub. Set them only in Railway service variables.

## 1. Railway project structure

Create or confirm these Railway services:

1. **VIBA API/Web service** — the app service deployed from this repo.
2. **PostgreSQL plugin/service** — Railway Postgres attached to the app.

Railway should automatically provide `DATABASE_URL` from the Postgres service. Do not manually invent a database URL unless Railway failed to inject one.

## 2. Required production variables

Set these on the VIBA app service:

```env
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=<64+ char random secret>
PUBLIC_ORIGIN=https://viba.guru
VIBA_PUBLIC_URL=https://viba.guru
CORS_ALLOWED_ORIGINS=https://viba.guru,https://www.viba.guru
```

Generate `SESSION_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Do **not** set `PORT`; Railway sets it automatically.

## 3. Emergency cost-safety variables

Set these during first production rollout or any period where provider spend is not yet proven safe:

```env
VIBA_COST_SAFE_MODE=true
VIBA_LIVE_AGENTS_ENABLED=false
VIBA_BACKGROUND_MAX_TURNS=3
```

These variables force paid/live providers into simulation mode even if API keys are present. This prevents surprise OpenAI/Anthropic/Gemini/Perplexity/Replit/Manus/Railway reasoning bills while deployment, billing, Doctor mode, and UI flows are being tested.

When controlled live testing is ready, disable safe mode and allow only selected providers:

```env
VIBA_COST_SAFE_MODE=false
VIBA_LIVE_AGENTS_ENABLED=true
VIBA_ALLOWED_LIVE_PROVIDERS=groq,openai
VIBA_BACKGROUND_MAX_TURNS=5
```

Do not enable all live providers at once. Raise limits only after spend is measured.

## 4. Financial fail-closed and auto-top-up defaults

Set these Railway variables before enabling live billing or live AI execution. These are platform defaults only; user-level controls still need database-backed settings before auto top-up goes live.

```env
VIBA_BILLING_FAIL_CLOSED=true
VIBA_AUTO_TOPUP_DEFAULT_ENABLED=false
VIBA_AUTO_TOPUP_DEFAULT_PACK_KEY=credits_1000
VIBA_AUTO_TOPUP_DEFAULT_CREDIT_FLOOR=100
VIBA_AUTO_TOPUP_DEFAULT_MAX_PER_PERIOD=1
VIBA_AUTO_TOPUP_REQUIRE_PAYMENT_METHOD=true
VIBA_LOCK_BILLABLE_ON_PAYMENT_FAILURE=true
VIBA_PROVIDER_SPEND_SAFE_MODE=true
VIBA_PROVIDER_SPEND_MONTHLY_LIMIT_USD=100
VIBA_PROVIDER_SPEND_WARNING_USD=50
```

Required interpretation:

- `VIBA_BILLING_FAIL_CLOSED=true` means billable AI execution must block if billing cannot be verified.
- `VIBA_AUTO_TOPUP_DEFAULT_ENABLED=false` means auto top-up is opt-in only.
- `VIBA_AUTO_TOPUP_DEFAULT_PACK_KEY=credits_1000` means the safe default is the smallest $50 / 1,000-credit pack.
- `VIBA_AUTO_TOPUP_DEFAULT_MAX_PER_PERIOD=1` means one automatic top-up per billing period unless the user explicitly changes it.
- `VIBA_LOCK_BILLABLE_ON_PAYMENT_FAILURE=true` means failed payment locks billable execution until payment is resolved.
- Provider spend warning/limit values are owner-safety controls and must not be confused with user credits.

## 5. Stripe billing variables

Set Stripe variables on the VIBA app service.

Required for live billing:

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Current plan prices:

```env
STRIPE_BILLING_SUBSCRIPTION_PRICE_ID=price_...   # VIBA Member: $50/month, 1,500 credits
STRIPE_BILLING_PRO_SUBSCRIPTION_PRICE_ID=price_... # VIBA Pro: $150/month, 6,000 credits
```

Legacy compatibility variable. Set this to the same value as `STRIPE_BILLING_SUBSCRIPTION_PRICE_ID` unless the old Stripe routes are removed:

```env
STRIPE_PRICE_ID=price_... # same as Member $50/month price
```

Top-up price IDs. Create one-time Stripe prices for each pack and paste the IDs here:

```env
STRIPE_BILLING_CREDITS_1000_PRICE_ID=price_... # $50 / 1,000 credits
STRIPE_BILLING_CREDITS_2000_PRICE_ID=price_... # $100 / 2,000 credits
STRIPE_BILLING_CREDITS_3000_PRICE_ID=price_... # $150 / 3,000 credits
STRIPE_BILLING_CREDITS_4000_PRICE_ID=price_... # $200 / 4,000 credits
STRIPE_BILLING_CREDITS_5000_PRICE_ID=price_... # $250 / 5,000 credits
STRIPE_BILLING_CREDITS_6000_PRICE_ID=price_... # $300 / 6,000 credits
```

The backend can create Stripe products/prices if these top-up price IDs are omitted, but production should use fixed Stripe price IDs so billing is predictable and auditable.

## 6. Stripe auto-top-up and payment-method setup

Stripe must also be configured to support future auto top-up safely.

Required in Stripe:

1. Enable customers to save/update payment methods through Stripe Billing Portal.
2. Configure the subscription/checkout flow so reusable payment methods are available for authorised future charges.
3. Do not attempt off-session charges unless the customer has explicitly opted in and Stripe has a reusable payment method.
4. Set top-up price metadata for every one-time credit pack:

```txt
system=viba_billing
type=credit_pack
credits=<credit_amount>
packKey=credits_<credit_amount>
```

5. Enable Billing Portal customer actions:
   - update payment method
   - cancel subscription
   - view invoices
   - switch between Member and Pro if supported by the Stripe account

Auto top-up must remain disabled until payment failure locking, idempotent webhooks, idempotent credit grants, and warning emails are verified.

## 7. Stripe webhook setup

In Stripe Dashboard, create a webhook endpoint:

```txt
https://viba.guru/api/stripe/webhook
```

Enable these events:

```txt
checkout.session.completed
invoice.payment_succeeded
invoice.payment_failed
customer.subscription.updated
customer.subscription.deleted
payment_intent.succeeded
payment_intent.payment_failed
```

Copy the webhook signing secret into Railway:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

## 8. AI provider keys

Set only the providers intentionally allowed for live spend. Omit any provider that should run in simulation/mock mode.

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
PERPLEXITY_API_KEY=...
REPLIT_API_KEY=...
MANUS_API_KEY=...
RAILWAY_TOKEN=...
GITHUB_TOKEN=...
```

Optional model overrides:

```env
OPENAI_MODEL=gpt-4.1-mini
ANTHROPIC_MODEL=claude-sonnet-4-5
GEMINI_MODEL=gemini-2.0-flash
PERPLEXITY_MODEL=sonar
RAILWAY_REASONING_MODEL=gpt-4.1-mini
```

## 9. Admin and internal maintenance variables

Set admin/internal controls:

```env
ADMIN_TOKEN=<64+ char random secret>
VIBA_INTERNAL_MAINTENANCE_TOKEN=<64+ char random secret>
```

Optional, only if Bridge/VIBA must accept bypassed calls from Archibald Titan:

```env
ARCHIBALD_BYPASS_TOKEN=<shared secret matching the Archibald side>
```

## 10. OAuth variables, if enabled

Only set these if Google/GitHub login is being used. Make sure OAuth callback URLs match the live domain.

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Expected callbacks:

```txt
https://viba.guru/api/auth/google/callback
https://viba.guru/api/auth/github/callback
```

## 11. Email variables, if email delivery is required

Set SMTP variables for verification/welcome/billing emails:

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=...
SMTP_FROM=noreply@viba.guru
```

If SMTP is omitted, email sending may be skipped or logged as failed depending on the route.

## 12. Optional runtime controls

```env
VIBA_BACKGROUND_MAX_TURNS=100
CIRCUIT_OPEN_THRESHOLD=5
CIRCUIT_TIMEOUT_MS=300000
```

## 13. Post-deploy verification checklist

After setting variables and redeploying, verify:

1. Railway deploy completes without env/startup errors.
2. `https://viba.guru/api/healthz` returns healthy.
3. Signup/login works and creates a session cookie.
4. `/pricing` displays both plans:
   - Member: $50/month, 1,500 credits
   - Pro: $150/month, 6,000 credits
5. Stripe checkout opens for Member.
6. Stripe checkout opens for Pro.
7. `/billing` shows top-up packs from $50 to $300.
8. Stripe webhook receives `checkout.session.completed` and credits are granted once only.
9. Stripe webhook replay does not grant duplicate credits.
10. Failed payment locks billable execution.
11. In safe mode, live agents fall back to simulation even when API keys exist.
12. `run-next` and `run-full` only work when the user has active billing/credits.
13. Normal chat remains free.
14. Agent task actions deduct credits by action complexity.
15. Out-of-credit sessions pause and point users to Billing.

## 14. Notes for Manus

- Do not hardcode secrets into code.
- Do not commit `.env` files.
- If provider spend spikes, immediately set `VIBA_COST_SAFE_MODE=true`, `VIBA_LIVE_AGENTS_ENABLED=false`, and `VIBA_BACKGROUND_MAX_TURNS=1`.
- If payment/billing state cannot be verified, billable AI execution must fail closed.
- If Stripe appears disabled even when new billing variables exist, confirm `STRIPE_PRICE_ID` is also set for legacy compatibility.
- If Railway build passes but billing fails, check Stripe webhook secret and price IDs first.
- If AI providers are missing keys or blocked by safe mode, VIBA falls back to mock/simulation mode for those providers.
