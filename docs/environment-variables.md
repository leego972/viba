# Environment Variables

All environment variables supported by the VIBA API server. Variables can be set as OS environment variables or stored in the `settings` table via the admin panel (DB-stored settings take precedence over env vars for API keys).

---

## Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required for all DB operations). |

---

## Security & Access Control

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Secret used to sign session cookies. **Required in production** — a random 32+ character string. Defaults to `dev-secret-change-me-in-production` which must never be used in production. |
| `PUBLIC_ORIGIN` | Full public URL of the deployed API (e.g. `https://viba.guru`). Used in OAuth callbacks, password reset links, and email verification URLs. Defaults to the request's protocol + hostname if not set. |
| `ACCESS_TOKEN` | Bearer token that gates all `/api` routes. If unset, the API is open. Auth bootstrap endpoints are always exempt. |
| `ADMIN_TOKEN` | Bearer token for admin panel routes (`/admin`). Required to access agent settings, circuit breakers, and destructive operations. |
| `ARCHIBALD_BYPASS_TOKEN` | Token accepted by the access gate for the embedded Archibald Titan AI integration. Allows the Archibald host to call VIBA without the user-facing ACCESS_TOKEN. |

---

## Email (SMTP)

Transactional emails (welcome, password reset, email verification, billing alerts). All five variables must be set together for emails to send; if any is missing, email is silently skipped.

| Variable | Description |
|---|---|
| `SMTP_HOST` | SMTP server hostname (e.g. `smtp.sendgrid.net`, `smtp.mailgun.org`). |
| `SMTP_USER` | SMTP authentication username (often the sending email address). |
| `SMTP_PASS` | SMTP authentication password or API key. Store as a Railway secret. |
| `SMTP_FROM` | "From" address for outbound emails (e.g. `noreply@viba.guru`). Defaults to `SMTP_USER` if not set. |
| `SMTP_PORT` | SMTP port (default: `587`). Use `465` for SSL; the server will enable `secure: true` automatically when port is 465. |

---

## Stripe (Monetization)

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key for creating checkout sessions and managing subscriptions. |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key exposed to the frontend for Stripe.js. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret for verifying incoming events. |
| `STRIPE_PRICE_ID` | _(legacy)_ The Stripe Price ID for the subscription plan. Now auto-provisioned at startup if not set. |

Products and prices are **auto-provisioned at startup** when `STRIPE_SECRET_KEY` is set. Individual price IDs are stored in the `billing_price_ids` DB table and do not need to be set manually.

---

## Admin Bootstrap

| Variable | Description |
|---|---|
| `ADMIN_BOOTSTRAP_EMAIL` | Email of the admin account to create/update at startup. Bootstrap is skipped if this is not set. |
| `ADMIN_BOOTSTRAP_PASSWORD` | Password for the admin account. Only used when creating the account; never overwrites an existing password on update. Bootstrap is skipped if this is not set. |

Both variables must be set together to enable admin bootstrapping. The bootstrapped account receives `subscription_status = active` and unlimited credits (`999999999`). Omit both in environments where no privileged bootstrap account is needed.

---

## Agent API Keys (LLM Inference)

These keys power the LLM chat completion calls made by each provider adapter. They can alternatively be stored in the `settings` table via the admin panel.

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key (ChatGPT adapter). |
| `OPENAI_MODEL` | Override the default OpenAI model (default: `gpt-4o-mini`). |
| `ANTHROPIC_API_KEY` | Anthropic API key (Claude adapter). |
| `ANTHROPIC_MODEL` | Override the default Anthropic model (default: `claude-3-5-haiku-20241022`). |
| `GEMINI_API_KEY` | Google Gemini API key. **Note: this is `GEMINI_API_KEY`, NOT `GOOGLE_API_KEY`.** |
| `GEMINI_MODEL` | Override the default Gemini model (default: `gemini-1.5-flash`). |
| `PERPLEXITY_API_KEY` | Perplexity API key. |
| `PERPLEXITY_MODEL` | Override the default Perplexity model (default: `llama-3.1-sonar-small-128k-online`). |
| `REPLIT_API_KEY` | Replit AI API key (used for the LLM chat completion fallback path). |
| `REPLIT_MODEL` | Override the default Replit model (default: `replit-code-v1-3b`). |
| `MANUS_API_KEY` | Manus API key (used for the LLM chat completion fallback path). |
| `MANUS_MODEL` | Override the default Manus model (default: `manus-deep-research-1`). |
| `GROQ_API_KEY` | Groq API key — **free** at [console.groq.com](https://console.groq.com), no credit card required. Unlocks Llama 3.3 70B, Mixtral 8x7B, Gemma 2 with full tool/function calling support. |
| `GROQ_MODEL` | Override the default Groq model (default: `llama-3.3-70b-versatile`). |
| `OLLAMA_BASE_URL` | Base URL of a running Ollama instance (default: `http://localhost:11434`). Ollama is free and runs models locally — no API key needed. |
| `OLLAMA_MODEL` | Model to use with Ollama (default: `llama3.2`). Pull models with `ollama pull <name>`. Tool-capable models: `llama3.1:8b`, `qwen2.5:7b`, `mistral:7b`. |

---

## Railway MCP (Deployment Control Agent)

Railway MCP lets the Railway agent adapter control Railway services directly — deploy, rollback, manage env vars, stream logs — using Railway's official MCP server at `https://railway.com/mcp`.

| Variable | Description |
|---|---|
| `RAILWAY_TOKEN` | Railway API token. Generate one in Railway → Account Settings → Tokens. Required to enable real Railway operations. Without it the Railway agent runs in simulation mode. |
| `RAILWAY_REASONING_MODEL` | Override the OpenAI model used for reasoning about which Railway tools to call (default: `gpt-4.1-mini`). Must be an OpenAI-compatible model. |

When `RAILWAY_TOKEN` is set, the Railway agent also needs a reasoning LLM. It will use `OPENAI_API_KEY` first, then `ANTHROPIC_API_KEY` as fallback. Both can be configured via the admin settings panel or as env vars.

**Capabilities unlocked with RAILWAY_TOKEN:**
- List / inspect projects and services
- Trigger deployments and rollbacks
- Stream deployment logs
- Read and write environment variables
- Check service health and metrics

---

## Real Code Execution (Tool-Capable Agents)

These variables unlock real code and git execution for Replit and Manus adapters when a repo is connected to a session. Without them, both adapters fall back to LLM-only responses.

| Variable | Description |
|---|---|
| `REPLIT_AGENT_URL` | Base URL of the Replit Agent execution API (e.g. `https://replit.com/api/v0/agent`). When set **and** a session has a `repoUrl`, the ReplitAdapter submits tasks to this API for real code execution (clone, test, build, deploy) instead of using LLM chat only. Supports POST `/tasks` to submit and GET `/tasks/{taskId}` to poll. |
| `MANUS_WORKSPACE_API_KEY` | API key for the Manus Workspace Task API — distinct from the LLM inference key (`MANUS_API_KEY`). When set, the ManusAdapter submits multi-step executable workflows to `https://api.manus.im/v1/tasks` for real web browsing, data gathering, and code execution. |

| `REPLIT_AGENT_TIMEOUT_MS` | Total polling budget in milliseconds for Replit Agent task execution (default: `60000` = 60s). The adapter polls every 4s; max attempts = `ceil(budget / 4000)`. On timeout, any partial result already received is persisted rather than discarded. |
| `MANUS_TASK_TIMEOUT_MS` | Total polling budget in milliseconds for Manus Workspace task execution (default: `60000` = 60s). The adapter polls every 5s; max attempts = `ceil(budget / 5000)`. On timeout, any partial result already received is persisted rather than discarded. |

### How real execution works

1. If `REPLIT_AGENT_URL` is set and the session has a `repoUrl`, the ReplitAdapter POSTs a task to the agent API with the task description, repo URL, branch, and environment. It then polls every 4 seconds up to `REPLIT_AGENT_TIMEOUT_MS` (default 60s).
2. During polling, the adapter emits a `agent_running` audit log event on every poll cycle with the current status and elapsed time, giving the session feed live progress indicators.
3. If the polling budget is exhausted, any partial outputs or summary already received are persisted with `completionStatus: "in_progress"` rather than discarded. The task can be retried on the next run.
4. Structured outputs (file diffs, test results, build logs, deployment URLs) are returned by the agent API and stored in the `metadata.toolOutputs` field of the message record.
5. If the agent API call fails (not times out), the adapter falls back to LLM-only mode transparently.
6. The same pattern applies to ManusAdapter with `MANUS_WORKSPACE_API_KEY` and `MANUS_TASK_TIMEOUT_MS`.

---

## Circuit Breaker

| Variable | Description |
|---|---|
| `CIRCUIT_BREAKER_THRESHOLD` | Number of consecutive failures before opening the circuit for a provider (default: `3`). |
| `CIRCUIT_BREAKER_RESET_MS` | Milliseconds before a tripped circuit enters half-open state (default: `60000`). |

---

## Session Defaults

| Variable | Description |
|---|---|
| `DEFAULT_AUTONOMY_MODE` | Default autonomy mode for new sessions: `Autonomous` or `Supervised` (default: `Autonomous`). |

---

## Deployment Notes

- Set all secrets as Railway environment variables, not in `.env` files committed to source control.
- After changing `REPLIT_AGENT_URL` or `MANUS_WORKSPACE_API_KEY`, restart the API server — they are read at adapter call time, not at startup.
- `VITE_BRIDGE_AI_URL` must be set in the **frontend** environment (Archibald Titan AI on Railway) pointing to `https://viba.guru/`. It is not an API server variable.
