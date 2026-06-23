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

## 4. Stripe billing variables

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

## 5. Stripe webhook setup

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
```

Copy the webhook signing secret into Railway:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

## 6. AI provider keys

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

## 7. Admin and internal maintenance variables

Set admin/internal controls:

```env
ADMIN_TOKEN=<64+ char random secret>
VIBA_INTERNAL_MAINTENANCE_TOKEN=<64+ char random secret>
```

Optional, only if Bridge/VIBA must accept bypassed calls from Archibald Titan:

```env
ARCHIBALD_BYPASS_TOKEN=<shared secret matching the Archibald side>
```

## 8. OAuth variables, if enabled

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

## 9. Email variables, if email delivery is required

Set SMTP variables for verification/welcome/billing emails:

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=...
SMTP_FROM=noreply@viba.guru
```

If SMTP is omitted, email sending may be skipped or logged as failed depending on the route.

## 10. Optional runtime controls

```env
VIBA_BACKGROUND_MAX_TURNS=100
CIRCUIT_OPEN_THRESHOLD=5
CIRCUIT_TIMEOUT_MS=300000
```

## 11. Post-deploy verification checklist

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
8. Stripe webhook receives `checkout.session.completed` and credits are granted.
9. In safe mode, live agents fall back to simulation even when API keys exist.
10. `run-next` and `run-full` only work when the user has active billing/credits.
11. Normal chat remains free.
12. Agent task actions deduct credits by action complexity.
13. Out-of-credit sessions pause and point users to Billing.

## 12. Notes for Manus

- Do not hardcode secrets into code.
- Do not commit `.env` files.
- If provider spend spikes, immediately set `VIBA_COST_SAFE_MODE=true`, `VIBA_LIVE_AGENTS_ENABLED=false`, and `VIBA_BACKGROUND_MAX_TURNS=1`.
- If Stripe appears disabled even when new billing variables exist, confirm `STRIPE_PRICE_ID` is also set for legacy compatibility.
- If Railway build passes but billing fails, check Stripe webhook secret and price IDs first.
- If AI providers are missing keys or blocked by safe mode, VIBA falls back to mock/simulation mode for those providers.
