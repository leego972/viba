# Manus Deployment Handoff — VIBA / Bridge AI

## Mission

Do not build new product features in this pass.

Your job is to complete the deployment setup:

```txt
1. Set up Stripe products/prices.
2. Configure Stripe webhook and Billing Portal.
3. Set Railway environment variables.
4. Deploy to Railway.
5. Fix only build/deploy/runtime blockers if they appear.
6. Verify billing, safe mode, and health endpoint.
7. Report exactly what was configured and what remains unverified.
```

## Current branch and validation status

Repository:

```txt
leego972/bridge-ai
```

Branch:

```txt
mobile-capacitor-redesign
```

GitHub CI on the current head has passed:

```txt
Install dependencies: success
Typecheck backend and workspace: success
Build API server: success
Build Bridge AI frontend: success
```

This means the code currently passes GitHub build validation. If Railway fails, treat it as a deployment/environment/start-command issue unless logs prove otherwise.

## Product direction

VIBA is an AI operations mission-control platform.

Core product pillars:

```txt
AI collaboration pipeline
GitHub/Railway Doctor mode
large complex build handling
clean, crisp, professional UI
credit quotes, budget caps, receipts, and proof reports
provider spend safety
```

The UI must be:

```txt
clean
crisp
professional
stable
easy to understand
not cheap
not tacky
not noisy
not jumpy
not overloaded with logs by default
```

Do not use accounting-software language in product copy. The product is not accounting software.

## What Manus must not do

Do not:

```txt
build new product features
change pricing
redesign UI
turn on auto top-up
enable all live providers
remove safe-mode controls
collect raw card numbers
commit secrets
merge/deploy without owner approval
change GitHub/Railway settings beyond deployment requirements
```

## Stripe setup task

Create Stripe products/prices in the correct Stripe mode.

Use live mode only for production. Use test mode only for staging/testing.

### Subscription prices

Create these recurring monthly prices:

```txt
VIBA Member Monthly
Price: USD $50/month
Credits: 1,500 per month
Railway env var: STRIPE_BILLING_SUBSCRIPTION_PRICE_ID
Legacy env var: STRIPE_PRICE_ID, same value as Member price
```

```txt
VIBA Pro Monthly
Price: USD $150/month
Credits: 6,000 per month
Railway env var: STRIPE_BILLING_PRO_SUBSCRIPTION_PRICE_ID
```

Recommended metadata:

```txt
system=viba_billing
type=subscription
planKey=viba_member or viba_pro
credits=1500 or 6000
trialDailyCredits=500
```

### One-time top-up prices

Create these one-time prices:

```txt
VIBA 1,000 Credit Pack  | USD $50  | STRIPE_BILLING_CREDITS_1000_PRICE_ID
VIBA 2,000 Credit Pack  | USD $100 | STRIPE_BILLING_CREDITS_2000_PRICE_ID
VIBA 3,000 Credit Pack  | USD $150 | STRIPE_BILLING_CREDITS_3000_PRICE_ID
VIBA 4,000 Credit Pack  | USD $200 | STRIPE_BILLING_CREDITS_4000_PRICE_ID
VIBA 5,000 Credit Pack  | USD $250 | STRIPE_BILLING_CREDITS_5000_PRICE_ID
VIBA 6,000 Credit Pack  | USD $300 | STRIPE_BILLING_CREDITS_6000_PRICE_ID
```

Top-up metadata:

```txt
system=viba_billing
type=credit_pack
credits=<credit amount>
packKey=credits_<credit amount>
```

Examples:

```txt
credits=1000
packKey=credits_1000
```

```txt
credits=6000
packKey=credits_6000
```

## Stripe webhook setup

Create webhook endpoint:

```txt
https://viba.guru/api/stripe/webhook
```

Enable events:

```txt
checkout.session.completed
invoice.payment_succeeded
invoice.payment_failed
customer.subscription.updated
customer.subscription.deleted
payment_intent.succeeded
payment_intent.payment_failed
```

Set webhook signing secret in Railway:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Stripe Billing Portal setup

Enable Stripe Billing Portal.

Recommended settings:

```txt
allow payment method updates
allow invoice history
allow subscription cancellation
allow plan switching between Member and Pro if supported
```

Auto top-up must remain disabled until database controls, idempotency, warning emails, and payment-failure lockout are fully implemented and tested.

## Railway environment variables

Set these on the Railway app service.

### Core app

```env
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=<64+ char random secret>
PUBLIC_ORIGIN=https://viba.guru
VIBA_PUBLIC_URL=https://viba.guru
CORS_ALLOWED_ORIGINS=https://viba.guru,https://www.viba.guru
```

Do not set `PORT`; Railway sets it automatically.

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Provider spend safety

For first deploy and testing, use safe mode:

```env
VIBA_COST_SAFE_MODE=true
VIBA_LIVE_AGENTS_ENABLED=false
VIBA_BACKGROUND_MAX_TURNS=3
```

Emergency shutdown settings:

```env
VIBA_COST_SAFE_MODE=true
VIBA_LIVE_AGENTS_ENABLED=false
VIBA_BACKGROUND_MAX_TURNS=1
```

Controlled live testing later:

```env
VIBA_COST_SAFE_MODE=false
VIBA_LIVE_AGENTS_ENABLED=true
VIBA_ALLOWED_LIVE_PROVIDERS=groq,openai
VIBA_BACKGROUND_MAX_TURNS=5
```

Do not enable all live providers at once.

### Billing fail-closed and auto-top-up defaults

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

These vars are platform defaults. Auto top-up must not be enabled until the actual user-level settings and payment safety code are complete.

### Stripe

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_BILLING_SUBSCRIPTION_PRICE_ID=price_...
STRIPE_BILLING_PRO_SUBSCRIPTION_PRICE_ID=price_...
STRIPE_PRICE_ID=price_... # same as Member price
STRIPE_BILLING_CREDITS_1000_PRICE_ID=price_...
STRIPE_BILLING_CREDITS_2000_PRICE_ID=price_...
STRIPE_BILLING_CREDITS_3000_PRICE_ID=price_...
STRIPE_BILLING_CREDITS_4000_PRICE_ID=price_...
STRIPE_BILLING_CREDITS_5000_PRICE_ID=price_...
STRIPE_BILLING_CREDITS_6000_PRICE_ID=price_...
```

Do not mix test-mode price IDs with live-mode API keys.

### AI provider keys

Only set keys for providers intentionally allowed later. Safe mode will block live spend during first rollout.

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
PERPLEXITY_API_KEY=...
REPLIT_API_KEY=...
MANUS_API_KEY=...
RAILWAY_TOKEN=...
GITHUB_TOKEN=...
GROQ_API_KEY=...
```

Optional model overrides:

```env
OPENAI_MODEL=gpt-4.1-mini
ANTHROPIC_MODEL=claude-sonnet-4-5
GEMINI_MODEL=gemini-2.0-flash
PERPLEXITY_MODEL=sonar
RAILWAY_REASONING_MODEL=gpt-4.1-mini
GROQ_MODEL=llama-3.3-70b-versatile
```

### Admin/internal

```env
ADMIN_TOKEN=<64+ char random secret>
VIBA_INTERNAL_MAINTENANCE_TOKEN=<64+ char random secret>
```

Optional only if Archibald integration is active:

```env
ARCHIBALD_BYPASS_TOKEN=<shared secret matching Archibald side>
```

### OAuth if enabled

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

### Email if enabled

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=...
SMTP_FROM=noreply@viba.guru
```

## Railway deploy verification

After deploying, verify in this order:

```txt
1. Railway build/deploy completes.
2. App starts without env/startup errors.
3. https://viba.guru/api/healthz returns healthy.
4. Signup/login works and session cookie is created.
5. /pricing shows Member $50 and Pro $150.
6. Member checkout opens correct Stripe product.
7. Pro checkout opens correct Stripe product.
8. /billing shows $50-$300 top-up packs.
9. Top-up checkout opens correct Stripe one-time price.
10. Stripe webhook receives checkout.session.completed.
11. Credits are granted once only.
12. Replaying webhook does not duplicate credits.
13. Failed payment locks billable execution if implemented.
14. Safe mode forces live agents into simulation even when provider keys exist.
15. Normal chat remains free.
16. Billable run-next/run-full requires billing/credits.
```

## If Railway build fails

Do not add new features.

Fix only the blocker needed for deployment.

Required process:

```txt
1. Copy the exact Railway error.
2. Identify whether it is install, build, start, env, database, or route/runtime.
3. Apply the smallest safe fix.
4. Re-run build/deploy.
5. Report before/after evidence.
```

## Final report required from Manus

Report these items back:

```txt
Stripe mode used: live or test
Member price ID set
Pro price ID set
six top-up price IDs set
Webhook URL configured
Webhook events enabled
Billing Portal enabled
Railway env vars set
Safe mode status
Railway deploy status
Health endpoint result
Pricing page result
Billing page result
Checkout result
Webhook result
Known unresolved risks
Any code fixes made for build/deploy only
```
