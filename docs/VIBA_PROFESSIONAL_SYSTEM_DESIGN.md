# VIBA Professional System Design Blueprint

VIBA is **not accounting software**.

VIBA is an **AI operations mission-control platform** for diagnosing, planning, repairing, and managing technical projects through a controlled collaboration pipeline of specialist AI agents.

The intended visual and control style should feel like clean professional accounting software: organised, calm, ledger-aware, receipt-based, auditable, and financially clear. The product category remains AI operations, not bookkeeping.

## 1. Product definition

VIBA helps users run controlled AI work across projects, repositories, deployments, billing, and tools.

Flagship workflow:

```txt
GitHub/Railway Doctor
→ cheap deterministic diagnosis
→ clear findings
→ credit quote
→ budget cap
→ owner approval
→ controlled repair proposal
→ receipt/proof report
→ audit trail
```

The system must not become a loose chatbot with tools. It must be a controlled AI collaboration system with financial-grade safeguards.

## 2. AI collaboration pipeline

The AI collaboration pipeline is the core product.

Required pipeline stages:

```txt
intake
context collection
task decomposition
agent assignment
agent-to-agent questions
handoff when tools are needed
fallback/reroute if provider fails
approval gate for sensitive work
credit quote/reservation
execution
receipt/proof report
audit log
```

Existing pipeline components already present in the repo include:

```txt
agentLoop.ts              → task assignment, execution, credit reservation, audit events
agentComms.ts             → task-scoped inter-agent questions and answers
toolHandoff.ts            → handoff from text-only agent to tool-capable agent
fallbackPool.ts           → provider fallback/rerouting
backgroundSessionRunner.ts → full-run/background progression
selfAudit.ts              → GitHub/self-audit/checkpoint/PR workflow foundation
actionCreditBilling.ts    → action complexity credit estimation and reservation
```

Doctor mode must connect into this same pipeline. It should not be a separate disconnected tool.

## 3. Accounting-style UI intent

The UI should borrow from clean accounting software because that style is trusted for money, records, and operational control.

This means:

```txt
clean tables
simple cards
clear balances
transaction-like receipts
status labels
filters
search
exportable records
low visual noise
obvious primary action
advanced detail hidden until expanded
```

It does **not** mean:

```txt
bookkeeping product
invoice-only product
generic finance app
spreadsheet-heavy interface
cluttered ledger screens everywhere
```

The visual feel should be professional, structured, and calm.

## 4. Financial-grade control discipline

Every billable or mutating AI action must behave like a controlled transaction.

Required record qualities:

```txt
unique ID
user/session/task ID
timestamp
source event
before credit balance
action quote
credits reserved/spent
after credit balance
agent/provider used
reason
receipt
idempotency key where payment is involved
audit log entry
rollback/checkpoint context where possible
```

No vague billing. No hidden provider spend. No silent overcharging. No billable action without a record.

## 5. Core design principles

### 5.1 Finance must be exact

Anything touching money must be:

```txt
idempotent
auditable
fail-closed
explicitly consented
replay-safe
test-covered
impossible to silently overcharge
```

If billing state cannot be verified, billable AI execution must stop.

### 5.2 Provider spend is separate from user credits

User credits control what customers can consume.

Provider spend controls protect VIBA from OpenAI, Anthropic, Gemini, Perplexity, Replit, Manus, Railway reasoning, Groq, and similar external bills.

Both are mandatory.

### 5.3 Cheap-first execution

Execution order:

1. Deterministic checks.
2. Existing logs/evidence parsing.
3. Cheap model summarisation only if needed.
4. Expensive model/agent only after quote, budget cap, and user approval.
5. Mutating repair only after explicit approval.

### 5.4 Clean UI over feature noise

Each screen must answer:

```txt
What is happening?
What will it cost?
What should I do next?
```

Advanced logs, raw evidence, agent chatter, and technical detail must be collapsed by default.

## 6. System layers

### 6.1 Presentation layer

Responsible for:

```txt
dashboard
pricing/billing
Doctor UI
session workspace
progress cards
credit quote cards
receipt/proof cards
mobile shell
```

Rules:

```txt
one primary action per screen
simple status card first
finance state visible where relevant
advanced evidence/logs collapsed
mobile stricter than desktop
```

### 6.2 API/control layer

Responsible for:

```txt
auth/session checks
billing eligibility gate
provider safe-mode gate
Doctor routes
session routes
background run control
billing routes
Stripe webhooks
settings/credentials routes
```

This layer must fail closed on finance/billing uncertainty.

### 6.3 Deterministic diagnostics layer

Cheap checks only:

```txt
repo file existence
workflow config checks
package manager mismatch
lockfile/package manifest mismatch
Railway env checklist
Stripe env checklist
health endpoint checks
public URL checks
route registration checks
known error pattern detection
```

This layer should not call paid AI providers.

### 6.4 Agent orchestration layer

Responsible for:

```txt
task routing
agent assignment
agent-to-agent questions
provider adapter selection
fallbacks
handoff timeline
complexity estimation
budget enforcement
credit reservation/deduction
receipts
```

This layer must respect provider safe mode and user budget caps.

### 6.5 Billing/finance layer

Responsible for:

```txt
subscriptions
monthly credit reset
top-up purchases
credit transactions
auto top-up settings later
payment failure lockout
billing idempotency
webhook replay safety
finance audit trail
```

This layer must never trust front-end state for billing decisions.

### 6.6 Provider spend safety layer

Responsible for:

```txt
VIBA_COST_SAFE_MODE
VIBA_LIVE_AGENTS_ENABLED
VIBA_ALLOWED_LIVE_PROVIDERS
VIBA_BACKGROUND_MAX_TURNS
provider spend warning threshold
provider spend hard limit
emergency shutdown path
```

This protects VIBA from runaway external provider bills.

### 6.7 Persistence/audit layer

Responsible for:

```txt
users
sessions
messages
tasks
credit_transactions
billing controls
idempotency keys
Doctor reports
activity logs
checkpoints
repair PR records
```

Every financial or mutating action must leave an audit trail.

## 7. GitHub/Railway Doctor design

Doctor mode is a flagship feature.

### 7.1 Doctor v1: deterministic, cheap, safe

Inspect:

```txt
GitHub repo metadata
branch status
workflow status
latest CI run result
package manager files
lock/package mismatch risk
Railway env checklist
Stripe env checklist
public health endpoint
known deployment failure patterns
```

Return:

```txt
health score
top blockers
severity-ranked findings
evidence labels
estimated next-action credits
safe next step
whether live-agent escalation is needed
```

Doctor v1 must not:

```txt
call expensive providers by default
mutate GitHub by default
mutate Railway by default
change env vars by default
merge PRs by default
redeploy by default
```

### 7.2 Doctor v2: paid analysis behind gates

Paid analysis may happen only after:

```txt
credit quote shown
provider spend warning shown
budget cap selected
user approval recorded
safe provider allow-list checked
```

### 7.3 Doctor v3: repair proposal

Repair mode must be PR-first:

```txt
checkpoint before branch/PR
PR-only repair by default
owner approval before merge
owner approval before Railway mutation
rollback plan included
proof report included
```

## 8. Billing and credit model

### 8.1 Plans

```txt
VIBA Member: $50/month, 1,500 credits
VIBA Pro: $150/month, 6,000 credits
Trial: 500 credits/day for 3 days, daily reset, no banking
```

### 8.2 Top-ups

```txt
$50  = 1,000 credits
$100 = 2,000 credits
$150 = 3,000 credits
$200 = 4,000 credits
$250 = 5,000 credits
$300 = 6,000 credits
```

### 8.3 Charging rule

Normal chat is free.

Credits are deducted only when agents perform billable task/action work.

Every billable action should have:

```txt
pre-action quote
action complexity
agent/provider used
credits reserved/spent
remaining balance
receipt
```

### 8.4 Budget cap rule

Background/full-run must require or strongly prompt for a session budget cap.

If cap is reached:

```txt
pause execution
show reason
show remaining work
ask user to increase cap or stop
```

## 9. Auto top-up model

Auto top-up is required eventually, but must be built after the finance base is fully safe.

It must be opt-in.

User controls:

```txt
auto top-up on/off
top-up pack amount
credit floor
max automatic top-ups per period
```

Default:

```txt
auto top-up off
$50 / 1,000-credit pack
floor 100 credits
max 1 automatic top-up per billing period
```

If payment fails:

```txt
lock billable execution
send email
show billing recovery action
allow normal free chat if intended
```

No auto top-up can go live without:

```txt
idempotent charge attempts
idempotent webhooks
payment failure lockout
warning emails
manual recovery flow
tests
```

## 10. Stripe design

Stripe owns payment methods. VIBA must never collect raw card data.

Stripe setup must include:

```txt
Member subscription price
Pro subscription price
six top-up prices
webhook endpoint
Billing Portal
payment method update support
invoice history
subscription cancellation
optional plan switching
```

Webhook events:

```txt
checkout.session.completed
invoice.payment_succeeded
invoice.payment_failed
customer.subscription.updated
customer.subscription.deleted
payment_intent.succeeded
payment_intent.payment_failed
```

Every webhook must be replay-safe.

## 11. Railway deployment design

Railway variables must be configured in one pass after build validation.

Required groups:

```txt
core app vars
cost safety vars
finance fail-closed vars
Stripe vars
provider keys
admin/internal tokens
email vars
OAuth vars if enabled
```

No final env list should be treated as complete until:

```txt
CI typecheck passes
production build passes
env usage is scanned
server startup requirements are checked
Railway deploy logs are reviewed
```

## 12. Provider spend controls

Default safe deployment:

```env
VIBA_COST_SAFE_MODE=true
VIBA_LIVE_AGENTS_ENABLED=false
VIBA_BACKGROUND_MAX_TURNS=3
```

Controlled live testing:

```env
VIBA_COST_SAFE_MODE=false
VIBA_LIVE_AGENTS_ENABLED=true
VIBA_ALLOWED_LIVE_PROVIDERS=groq,openai
VIBA_BACKGROUND_MAX_TURNS=5
```

Emergency shutdown:

```env
VIBA_COST_SAFE_MODE=true
VIBA_LIVE_AGENTS_ENABLED=false
VIBA_BACKGROUND_MAX_TURNS=1
```

The system must never require removing API keys to stop spend. A Railway env toggle must be enough.

## 13. UI design language

The UI should look like clean professional accounting software, applied to AI operations.

Doctor UI default layout:

```txt
Status card
Health score
Top 3 blockers
Estimated next action cost
Primary CTA
Expandable evidence
Expandable logs
```

Billing UI must clearly show:

```txt
current credits
plan
renewal/reset rule
top-up options
auto top-up status when built
billable lock state
payment problem if any
```

Agent execution UI must show:

```txt
next planned action
complexity badge
credit quote
budget cap
approval state
progress
receipt
```

## 14. Implementation order

Professional order:

1. Build/CI validation gate.
2. Env scan and final Manus setup handoff.
3. Stripe prices + Railway variables.
4. Safe-mode deployment.
5. Billing verification.
6. Deterministic Doctor v1.
7. Credit quote + receipt UI.
8. Budget caps.
9. Proof reports.
10. Paid-agent Doctor escalation.
11. PR-based repair mode.
12. Auto top-up only after finance tests pass.

## 15. Current Manus job

Manus should not build new product features in the deployment pass.

Manus should:

```txt
set up Stripe prices
set up Stripe webhook
set up Billing Portal
set Railway env vars
run build/typecheck
fix only build/deploy blockers
verify safe mode
verify billing checkout
verify health endpoint
report results
```

Manus should not:

```txt
add new features
redesign UI
change pricing
turn on auto top-up
enable all live providers
merge/deploy without owner approval
```
