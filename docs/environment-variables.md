# Environment Variables

  All env vars are **server-only** (never sent to the browser) unless noted.
  API keys can also be set via the **Admin → Config** panel — the DB value takes priority over the env var.

  > **Never commit real secrets.** Copy `.env.example` to `.env` (gitignored) for local work.

  ---

  ## Quick reference

  | Variable | Required | Default | Group |
  |---|---|---|---|
  | `DATABASE_URL` | ✅ Yes | — | Database |
  | `SESSION_SECRET` | ✅ Yes | — | Server |
  | `ADMIN_TOKEN` | ✅ Yes | — | Access control |
  | `PORT` | auto | — | Server |
  | `ACCESS_TOKEN` | No | (open) | Access control |
  | `ARCHIBALD_BYPASS_TOKEN` | No | — | Access control |
  | `VIBA_PUBLIC_URL` | No | `https://viba.guru` | Server |
  | `OPENAI_API_KEY` | No | (simulation) | AI providers |
  | `ANTHROPIC_API_KEY` | No | (simulation) | AI providers |
  | `GEMINI_API_KEY` | No | (simulation) | AI providers |
  | `PERPLEXITY_API_KEY` | No | (simulation) | AI providers |
  | `REPLIT_API_KEY` | No | (simulation) | AI providers |
  | `MANUS_API_KEY` | No | (simulation) | AI providers |
  | `OPENAI_MODEL` | No | `gpt-4.1-mini` | Model overrides |
  | `ANTHROPIC_MODEL` | No | `claude-sonnet-4-5` | Model overrides |
  | `GEMINI_MODEL` | No | `gemini-2.0-flash` | Model overrides |
  | `PERPLEXITY_MODEL` | No | `sonar` | Model overrides |
  | `STRIPE_SECRET_KEY` | Stripe only | — | Stripe |
  | `STRIPE_PUBLISHABLE_KEY` | Stripe only | — | Stripe |
  | `STRIPE_PRICE_ID` | Stripe only | — | Stripe |
  | `STRIPE_WEBHOOK_SECRET` | Stripe only | — | Stripe |
  | `SMTP_HOST` | Email only | — | Email |
  | `SMTP_PORT` | No | `587` | Email |
  | `SMTP_USER` | Email only | — | Email |
  | `SMTP_PASS` | Email only | — | Email |
  | `SMTP_FROM` | No | `SMTP_USER` | Email |
  | `CIRCUIT_OPEN_THRESHOLD` | No | `5` | Circuit breaker |
  | `CIRCUIT_TIMEOUT_MS` | No | `300000` | Circuit breaker |
  | `NODE_ENV` | auto | — | Runtime |

  ---

  ## Database

  ### `DATABASE_URL`
  - **Required** · Server-only
  - Full PostgreSQL connection string. The API server and Drizzle ORM both read this on startup. If absent, the process exits immediately with a clear error.
  - **Example:** `postgresql://user:password@host:5432/dbname`
  - Railway: copy from the **Variables** tab of your Postgres plugin.

  ---

  ## Server

  ### `PORT`
  - **Auto-set** · Server-only
  - The port the Express server binds to. Set automatically by Railway and Replit via the workflow runner. **Do not set manually** — misconfigured values conflict with the proxy.
  - **Example:** `5000` (Replit default)

  ### `SESSION_SECRET`
  - **Required** · Server-only
  - Random secret used to sign express-session cookies. Must be long, random, and stable across deploys (changing it invalidates all active sessions).
  - **Generate:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  - **Example:** `a3f8d2...64-char-hex`

  ### `VIBA_PUBLIC_URL`
  - **Optional** · Server-only
  - Public HTTPS base URL of this deployment. Used to build links in outgoing access-token emails. Must not have a trailing slash.
  - **Default:** `https://viba.guru`
  - **Example:** `https://viba.guru`

  ### `NODE_ENV`
  - **Auto-set** · Server-only
  - Controls logging format (JSON in production, pretty in development) and error detail in API responses.
  - **Default (Railway):** `production`

  ---

  ## Access Control

  ### `ACCESS_TOKEN`
  - **Optional** · Server-only
  - A single static bearer token for the legacy access gate. When set, every `/api/*` request must include `Authorization: Bearer <token>` or `X-Access-Token: <token>`. When absent, the API operates in **open mode**.
  - Intended for low-traffic deployments or development. **Prefer Stripe subscriptions for production.**
  - Routes `/api/auth/config` and `/api/auth/verify` are always exempt (they bootstrap the gate).
  - **Example:** `viba_abc123...`

  ### `ADMIN_TOKEN`
  - **Required** · Server-only
  - Bearer token protecting all `/api/admin/*` endpoints. Without it, every admin request returns `503 Admin not configured`.
  - Keep this distinct from `ACCESS_TOKEN` — it has wider destructive permissions.
  - **Generate:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  - **Example:** `a9f2b1...64-char-hex`

  ### `ARCHIBALD_BYPASS_TOKEN`
  - **Optional** · Server-only
  - Shared secret between VIBA and Archibald Titan AI (which embeds VIBA at the `/bridge` route). When a request includes this token, it skips subscriber access checks — useful so Archibald's own users don't need a separate VIBA subscription.
  - Must match the `VIBA_BYPASS_TOKEN` (or equivalent) env var set in the Archibald environment.
  - **Example:** `bypass_abc123...`

  ---

  ## AI Provider API Keys

  All provider keys are **optional**. Without a key, that provider automatically runs in **simulation (mock) mode** — responses are plausible-looking fakes, no API credit is spent. This keeps the app runnable during development and demos.

  Keys can be set via env var **or** via the Admin → Config panel. The DB value takes priority when both are present.

  ### `OPENAI_API_KEY`
  - **Optional** · Server-only · Admin-configurable
  - Enables the ChatGPT / OpenAI provider with real API calls.
  - Create at: <https://platform.openai.com/api-keys>
  - **Example:** `sk-proj-...`

  ### `ANTHROPIC_API_KEY`
  - **Optional** · Server-only · Admin-configurable
  - Enables the Claude / Anthropic provider.
  - Create at: <https://console.anthropic.com/settings/keys>
  - **Example:** `sk-ant-api03-...`

  ### `GEMINI_API_KEY`
  - **Optional** · Server-only · Admin-configurable
  - Enables the Gemini / Google provider.
  - ⚠️ **The variable name is `GEMINI_API_KEY`** — not `GOOGLE_API_KEY`.
  - Create at: <https://aistudio.google.com/app/apikey>
  - **Example:** `AIzaSy...`

  ### `PERPLEXITY_API_KEY`
  - **Optional** · Server-only · Admin-configurable
  - Enables the Perplexity research and web-search provider.
  - Create at: <https://www.perplexity.ai/settings/api>
  - **Example:** `pplx-...`

  ### `REPLIT_API_KEY`
  - **Optional** · Server-only · Admin-configurable
  - Enables the Replit agent provider.
  - **Example:** `r_...`

  ### `MANUS_API_KEY`
  - **Optional** · Server-only · Admin-configurable
  - Enables the Manus agent provider.

  ---

  ## Model Overrides

  Override the default model used per provider. Can also be changed via Admin → Config (DB takes priority).

  ### `OPENAI_MODEL`
  - **Optional** · Server-only · Admin-configurable · Default: `gpt-4.1-mini`
  - **Example:** `gpt-4o`

  ### `ANTHROPIC_MODEL`
  - **Optional** · Server-only · Admin-configurable · Default: `claude-sonnet-4-5`
  - **Example:** `claude-opus-4-5`

  ### `GEMINI_MODEL`
  - **Optional** · Server-only · Admin-configurable · Default: `gemini-2.0-flash`
  - **Example:** `gemini-2.5-pro`

  ### `PERPLEXITY_MODEL`
  - **Optional** · Server-only · Admin-configurable · Default: `sonar`
  - **Example:** `sonar-pro`

  ---

  ## Stripe Payments

  All four Stripe variables are **optional as a group**. When `STRIPE_SECRET_KEY` is absent, the pricing page shows a coming-soon state and the access gate falls back to `ACCESS_TOKEN` mode.

  All four must be set together for live subscriptions to work.

  ### `STRIPE_SECRET_KEY`
  - **Required for Stripe** · Server-only
  - Stripe secret key. Use `sk_test_...` for development, `sk_live_...` for production.
  - Dashboard: <https://dashboard.stripe.com/apikeys>
  - **Example:** `sk_test_51...`

  ### `STRIPE_PUBLISHABLE_KEY`
  - **Required for Stripe** · Server-only (proxied to browser via `/api/stripe/config`, never via VITE env)
  - Stripe publishable key.
  - Dashboard: <https://dashboard.stripe.com/apikeys>
  - **Example:** `pk_test_51...`

  ### `STRIPE_PRICE_ID`
  - **Required for Stripe** · Server-only
  - ID of the recurring `$50/month` Stripe Price. Create the product and price in the Stripe Dashboard, then paste the `price_...` ID here.
  - Dashboard: <https://dashboard.stripe.com/products>
  - **Example:** `price_1ABC...`

  ### `STRIPE_WEBHOOK_SECRET`
  - **Required for Stripe** · Server-only
  - Signing secret from the Stripe webhook endpoint configuration. Used to verify that incoming webhook events are genuinely from Stripe.
  - Create a webhook at <https://dashboard.stripe.com/webhooks> pointing to `https://viba.guru/api/stripe/webhook`.
  - **Events to enable:** `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.payment_succeeded`
  - **Example:** `whsec_...`

  ---

  ## Email (SMTP)

  Used to deliver the access token to new subscribers immediately after Stripe checkout completes. All SMTP variables are **optional as a group**. When absent, the server logs a warning and skips sending — the token is still visible in the admin **Users** tab.

  ### `SMTP_HOST`
  - **Required for email** · Server-only
  - SMTP server hostname.
  - **Examples:** `smtp.sendgrid.net` · `smtp.mailgun.org` · `smtp.postmarkapp.com`

  ### `SMTP_PORT`
  - **Optional** · Server-only · Default: `587`
  - SMTP port. Use `465` for SSL, `587` for STARTTLS.

  ### `SMTP_USER`
  - **Required for email** · Server-only
  - SMTP authentication username. For SendGrid this is the literal string `apikey`.

  ### `SMTP_PASS`
  - **Required for email** · Server-only
  - SMTP authentication password or API key value. Keep this secret.

  ### `SMTP_FROM`
  - **Optional** · Server-only · Default: value of `SMTP_USER`
  - The `From:` address shown to recipients.
  - **Example:** `noreply@viba.guru`

  ---

  ## Circuit Breaker

  The circuit breaker automatically falls back a provider to simulation mode after repeated failures, then probes it again after a timeout. State is **persisted in the `circuit_state` DB table** so it survives restarts. You can reset circuits via the Admin → Health panel.

  ### `CIRCUIT_OPEN_THRESHOLD`
  - **Optional** · Server-only · Default: `5`
  - Number of consecutive provider failures before the circuit opens (trips to simulation).
  - The server **fails fast at startup** if this is set to a non-positive integer.
  - **Example:** `3`

  ### `CIRCUIT_TIMEOUT_MS`
  - **Optional** · Server-only · Default: `300000` (5 minutes)
  - Milliseconds the circuit stays open before a single half-open probe is allowed.
  - The server **fails fast at startup** if this is set to a non-positive integer.
  - **Example:** `120000` (2 minutes)

  ---

  ## Notes

  ### No VITE_ client-side env vars
  The frontend reads all configuration through API endpoints — there are no `VITE_*` environment variables in this repository. The Stripe publishable key is returned by `GET /api/stripe/config`; auth mode is returned by `GET /api/auth/config`.

  ### The `VITE_BRIDGE_AI_URL` variable
  This variable belongs to the **Archibald Titan AI** repo (leego972/archibald-titan-ai), not to this repo. After deploying VIBA, update `VITE_BRIDGE_AI_URL` in the Archibald Railway environment to point to the VIBA production URL (`https://viba.guru/`).

  ### Admin-configurable keys
  `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`, and the `*_MODEL` overrides can be set in the **Admin → Config** panel after deployment. The DB value takes priority over the environment variable, so you can rotate keys without redeploying.
  