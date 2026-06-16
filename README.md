# BridgeAI — Multi-AI Orchestration Platform

  > Connect ChatGPT, Claude, Gemini, Perplexity, Manus, and Replit in one session. Assign them roles, give them a goal, and watch them collaborate autonomously.

  [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
  [![Express](https://img.shields.io/badge/Express-5.x-green)](https://expressjs.com/)
  [![React](https://img.shields.io/badge/React-19-61DAFB)](https://reactjs.org/)

  ---

  ## What is BridgeAI?

  BridgeAI is a **plug-and-play multi-agent orchestration platform**. You set a project goal, choose which AI providers to use, assign each one a role (Strategist, Builder, Researcher, Reviewer, etc.), and BridgeAI runs them through a structured collaboration workflow — automatically routing tasks to the most capable agent, retrying on failure, and surfacing the output in a clean real-time interface.

  **Key capabilities:**

  - 🔀 **Multi-provider** — OpenAI, Anthropic, Google Gemini, Perplexity, Replit, and Manus
  - 🛡️ **Circuit breaker** — automatically bypasses failing providers and falls back to alternatives
  - 📊 **Usage analytics** — tracks per-provider token spend, cost estimates, and fallback rates
  - 🔔 **Spike alerts** — email or webhook notifications when costs spike unexpectedly
  - 🧪 **AI Trainer Workbench** — analyse and score AI-labelling tasks with multi-model review
  - 💾 **Session export** — download any session as a full Markdown transcript
  - 🔁 **Simulation mode** — run sessions without real API keys using built-in mock agents

  ---

  ## Quick Start

  ### 1. Clone & install

  ```bash
  git clone https://github.com/leego972/bridge-ai.git
  cd bridge-ai
  pnpm install
  ```

  ### 2. Set up the database

  ```bash
  # Provision a PostgreSQL database (Neon, Supabase, or local)
  export DATABASE_URL="postgres://..."

  # Push the schema
  pnpm --filter @workspace/db run push
  ```

  ### 3. Add your API keys

  Open **Settings** in the app and enter the keys for the providers you want to use. You only need keys for the providers you select — unused providers run in simulation mode automatically.

  | Provider   | Key name              | Get key at                          |
  |------------|-----------------------|-------------------------------------|
  | OpenAI     | `OPENAI_API_KEY`      | platform.openai.com                 |
  | Anthropic  | `ANTHROPIC_API_KEY`   | console.anthropic.com               |
  | Google     | `GEMINI_API_KEY`      | aistudio.google.com                 |
  | Perplexity | `PERPLEXITY_API_KEY`  | perplexity.ai/settings/api          |
  | Replit     | `REPLIT_API_KEY`      | replit.com/account                  |
  | Manus      | `MANUS_API_KEY`       | manus.im                            |

  ### 4. Run the server

  ```bash
  pnpm --filter @workspace/api-server run dev
  ```

  ---

  ## Architecture

  ```
  artifacts/
    api-server/        Express 5 API — agent loop, adapters, circuit breaker
    bridge-ai/         React + Vite frontend
  lib/
    api-spec/          OpenAPI 3.1 spec (source of truth)
    api-client-react/  Auto-generated React Query hooks (from spec)
    api-zod/           Auto-generated Zod schemas (from spec)
    db/                Drizzle ORM schema + migrations
  ```

  **Request flow:**

  1. Frontend calls `POST /api/sessions` to create a session with selected agents
  2. Agent loop assigns tasks to agents via the task router (capability + role affinity scoring)
  3. Each agent runs through its adapter with retry + circuit breaker protection
  4. Results are streamed to the frontend via SSE (`/api/sessions/:id/stream`)
  5. Session state (messages, tasks, memory, audit log) is persisted in PostgreSQL

  ---

  ## Environment Variables

  See [docs/environment-variables.md](docs/environment-variables.md) for the full reference.

  **Required:**

  | Variable         | Description                  |
  |------------------|------------------------------|
  | `DATABASE_URL`   | PostgreSQL connection string |
  | `SESSION_SECRET` | Secret for signing sessions  |

  **Optional (provider API keys — set via UI Settings page):**

  `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`, `REPLIT_API_KEY`, `MANUS_API_KEY`

  **Optional (circuit breaker tuning):**

  | Variable                  | Default | Description                              |
  |---------------------------|---------|------------------------------------------|
  | `CIRCUIT_OPEN_THRESHOLD` | `5`     | Failures before a circuit opens         |
  | `CIRCUIT_TIMEOUT_MS`     | `300000`| How long a circuit stays open (ms)      |

  ---

  ## Development

  ```bash
  pnpm run typecheck          # Full typecheck across all packages
  pnpm run build              # Typecheck + build all packages
  pnpm --filter @workspace/api-spec run codegen   # Regenerate API hooks & Zod schemas
  pnpm --filter @workspace/db run push            # Push DB schema (dev only)
  ```

  ---

  ## Deployment

  Deploy to any platform that supports Node.js 20+:

  1. Set `DATABASE_URL` and `SESSION_SECRET` as environment variables
  2. Run `pnpm install && pnpm run build`
  3. Start: `pnpm --filter @workspace/api-server run start`

  For Replit deployments, the app auto-serves the frontend dist in production mode.

  ---

  ## License

  MIT
  