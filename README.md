# BridgeAI

**Plug-and-play AI-to-AI integration platform.** Connect multiple AI providers, assign a project goal, and watch them collaborate autonomously — no glue code required.

## What It Does

BridgeAI orchestrates multi-agent AI workflows. You pick a goal, configure which AI providers join the session, and the platform routes tasks between them: a Strategist plans, a Builder implements, a Reviewer critiques, and QA signs off. Every step is logged, every decision is traceable, and human approval gates are enforced when needed.

## Features

| Feature | Details |
|---|---|
| **6 AI Providers** | OpenAI (GPT-4o), Anthropic (Claude 3.5), Google (Gemini 1.5), Perplexity, Manus, Replit — all via mock adapters out of the box; real OpenAI calls when `OPENAI_API_KEY` is provided |
| **Role-based orchestration** | Strategist → Builder → Reviewer → QA pipeline with automatic role assignment |
| **Run Next / Run Full** | Step through one agent turn at a time or trigger an 8-turn autonomous workflow |
| **Live task board** | Tasks move from Planned → In Progress → Review → Complete in real time (2 s polling) |
| **Shared conversation** | Full message thread visible to all agents, colour-coded by provider |
| **Shared memory** | Persistent key-value memory store per session; agents read & write context |
| **Approval modal** | Human-in-the-loop gate: blocked actions surface a modal before proceeding |
| **Audit log** | Every agent action, task transition, and approval is time-stamped and stored |
| **Estimated cost display** | Per-session cost estimate shown on session cards |
| **Three autonomy modes** | Manual (step-only), Supervised (approval gates), Autonomous (fully automatic) |

## Tech Stack

- **Frontend** — React 18 + Vite 7, TailwindCSS v4, shadcn/ui, TanStack Query, Wouter
- **Backend** — Express 5, Node 24, Pino logging
- **Database** — PostgreSQL + Drizzle ORM
- **API contract** — OpenAPI 3.1 spec → Orval codegen (React Query hooks + Zod schemas)
- **Monorepo** — pnpm workspaces

## Project Structure

```
artifacts/
  bridge-ai/        # React + Vite frontend (served at /)
  api-server/       # Express 5 API server (served at /api)
lib/
  db/               # Drizzle schema + migrations
  api-spec/         # OpenAPI spec + Orval config
  api-zod/          # Generated Zod schemas
  api-client-react/ # Generated React Query hooks
```

## Pages

| Route | Page |
|---|---|
| `/` | Landing — hero, how-it-works, feature grid, CTA |
| `/dashboard` | All sessions with status badges and cost estimates |
| `/sessions/new` | Create session wizard — goal, autonomy mode, provider selection |
| `/sessions/:id` | Live workspace — conversation thread, task board, agent panel, approval modal |
| `/settings` | API key management per provider |

## Running Locally

The app is fully functional with mock agents — no API keys needed.

```bash
# Start API server
pnpm --filter @workspace/api-server run dev

# Start frontend
pnpm --filter @workspace/bridge-ai run dev
```

Both are also wired as Replit workflows and start automatically.

## Using a Real OpenAI Key

1. Go to `/settings` in the app.
2. Enter your `OPENAI_API_KEY`.
3. When creating a session, add an agent with provider `openai` — it will use the real API instead of the mock adapter.

## API Overview

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sessions` | List all sessions |
| `POST` | `/api/sessions` | Create a session |
| `GET` | `/api/sessions/:id` | Get session detail |
| `POST` | `/api/sessions/:id/agents` | Add an agent |
| `POST` | `/api/sessions/:id/run-next` | Run one agent step |
| `POST` | `/api/sessions/:id/run-full` | Run full workflow (up to 8 turns) |
| `POST` | `/api/sessions/:id/send` | Inject a user message |
| `POST` | `/api/sessions/:id/approve/:approvalId` | Approve a pending action |
| `POST` | `/api/sessions/:id/stop` | Stop an active session |
| `GET` | `/api/sessions/:id/tasks` | List tasks |
| `GET` | `/api/sessions/:id/messages` | List conversation |
| `GET` | `/api/sessions/:id/memory` | Get shared memory |
| `GET` | `/api/sessions/:id/audit-logs` | Get audit trail |
| `GET` | `/api/sessions/:id/approvals` | List approval requests |
| `GET/POST` | `/api/settings` | Read/write API key settings |

## Key Commands

```bash
pnpm run typecheck                          # Full typecheck across all packages
pnpm run build                              # Typecheck + build all packages
pnpm --filter @workspace/api-spec run codegen   # Regenerate hooks from OpenAPI spec
pnpm --filter @workspace/db run push        # Push DB schema changes (dev only)
```
