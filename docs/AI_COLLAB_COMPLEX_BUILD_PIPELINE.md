# VIBA AI Collaboration Complex Build Pipeline

VIBA must handle large, complex builds through controlled AI collaboration, not one giant prompt and not a chaotic chat screen.

## Core pipeline

```txt
Intake
→ scope clarification
→ architecture plan
→ task breakdown
→ dependency map
→ specialist agent assignment
→ staged execution
→ inter-agent questions
→ tool handoffs
→ GitHub/Railway Doctor checks
→ approval gates
→ PR/checkpoint creation
→ verification
→ proof report
→ credit receipt
```

## Build modes

### Planning mode

Outputs:

```txt
project goal
assumptions
unknowns
repo/deployment context needed
proposed architecture
task list
risk list
estimated credit range
recommended budget cap
```

### Doctor mode

Checks GitHub, Railway, CI, build status, env requirements, Stripe setup, health endpoints, and known deployment blockers. Doctor mode must not change GitHub or Railway by default.

### Build mode

Executes staged work only after task breakdown, credit quote, budget cap, and required approvals.

### Repair mode

Fixes specific failures with minimal patches, validation, proof report, and approval before merge/deploy.

## Specialist roles

```txt
Architect Agent  → system design and decomposition
Frontend Agent   → UI, routes, components, mobile responsiveness
Backend Agent    → APIs, database, auth, billing, queues
DevOps Agent     → GitHub Actions, Railway, env vars, deployment
Billing Agent    → Stripe, credits, receipts, finance safety
QA Agent         → tests, build verification, acceptance checks
Doctor Agent     → GitHub/Railway diagnostics and blocker classification
Product Agent    → UX clarity, clean professional interface, user flow
```

## Collaboration rules

```txt
questions are task-scoped
answers attach to the originating task
handoffs preserve partial work
fallbacks preserve partial work
major events are shown in the timeline
raw logs and noisy internals are hidden by default
```

## Cost controls

Large builds require:

```txt
credit quote range
session budget cap
provider safe-mode status
allowed live providers
stop behaviour at cap
approval before exceeding cap
```

Safe deployment defaults:

```env
VIBA_COST_SAFE_MODE=true
VIBA_LIVE_AGENTS_ENABLED=false
VIBA_BACKGROUND_MAX_TURNS=3
```

## GitHub/Railway Doctor integration

Doctor mode must plug into the same collaboration pipeline:

```txt
Doctor diagnostic creates findings
findings become tasks
tasks route to specialist agents
repair proposals become PR/checkpoint work
approval gate controls merge/deploy
proof report closes the loop
```

## Proof report

Every complex build or repair should finish with:

```txt
objective
files/components changed
checks performed
build/typecheck status
GitHub/Railway status
billing/credit events
known remaining risks
rollback plan
next recommended action
```

## UI rule

The user should not see complexity as clutter.

Default UI:

```txt
status card
health/progress score
current phase
top 3 blockers
next action
credit estimate / budget cap
one primary button
expandable details
```

The UI must remain clean, crisp, professional, stable, and easy to understand.
