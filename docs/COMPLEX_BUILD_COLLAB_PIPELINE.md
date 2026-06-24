# VIBA Complex Build AI Collaboration Pipeline

VIBA must be able to handle large, complex builds — not just chat, not just debugging, and not only GitHub/Railway Doctor repairs.

The product goal is:

```txt
User gives a major build objective
→ VIBA decomposes it into phases
→ specialist AI agents collaborate
→ costs and approvals are controlled
→ GitHub/Railway execution is verified
→ user receives receipts, proof, and clean progress reporting
```

The interface should keep the clean accounting-software-style look: calm, structured, low-noise, status-driven, with receipts and expandable detail. The actual product remains AI operations mission control.

## 1. Supported large-build categories

VIBA should be able to manage:

```txt
new SaaS build
existing repo repair
Railway deployment repair
Stripe billing integration
mobile wrapper/app conversion
AI-agent workflow build
API/backend build
frontend redesign
security hardening pass
production readiness audit
multi-phase refactor
```

## 2. Pipeline stages

### 2.1 Intake

User describes the target outcome.

VIBA captures:

```txt
project goal
repo URL
branch
deployment provider
budget cap
urgency
risk tolerance
must-not-break areas
required integrations
billing/payment requirements
```

Output:

```txt
build objective summary
missing-context checklist
initial complexity estimate
suggested budget range
```

### 2.2 Context collection

VIBA gathers context before agents start spending credits.

Cheap-first checks:

```txt
repo tree
package files
workflow files
Railway config
known env requirements
existing routes/pages
build scripts
recent CI status
public URL health check
Stripe configuration checklist
```

No expensive model should be used for basic file and config discovery.

### 2.3 Architecture plan

VIBA produces a phased build plan:

```txt
Phase 1: foundation
Phase 2: backend/API
Phase 3: frontend/UI
Phase 4: billing/finance
Phase 5: deployment
Phase 6: verification
Phase 7: documentation/handoff
```

Each phase has:

```txt
goal
scope
owner agent
required tools
risk level
estimated credits
approval requirement
success criteria
rollback/checkpoint rule
```

### 2.4 Task decomposition

Large builds must become small controlled tasks.

Task rules:

```txt
single responsibility
clear acceptance criteria
linked dependency
assigned specialist agent
estimated credits
status
proof requirement
```

Task statuses:

```txt
planned
quoted
approved
in_progress
blocked_needs_tools
handoff_pending
review
completed
failed
paused_budget
paused_payment
```

### 2.5 Agent assignment

Specialist agents should be used by task type:

```txt
Architect agent       → system design, phase plan, risk map
Backend agent         → API/database/server logic
Frontend agent        → UI/UX/pages/components
Billing agent         → Stripe, credits, webhooks, financial controls
Deployment agent      → Railway, env, build logs, health checks
QA agent              → typecheck/build/test verification
Security agent        → secrets, auth, rate limits, safe failure
Documentation agent   → handoff, setup instructions, evidence reports
```

### 2.6 Agent-to-agent collaboration

Agents must be able to ask each other task-scoped questions.

Rules:

```txt
questions are tied to a task
answers are tied to the original question
maximum questions per step is capped
stale questions must not leak into unrelated tasks
unanswered questions should appear as blockers
```

This is the collaboration layer, not random chat.

### 2.7 Handoff and fallback

If an agent cannot complete work:

```txt
save partial work
record blocker
handoff to tool-capable agent
create sibling continuation task
preserve original task context
log audit event
show clean handoff timeline to user
```

If a provider fails:

```txt
classify failure
return task to provider pool
attempt cheaper/allowed fallback
record partial work
stop if fallback pool exhausted
```

### 2.8 Credit quote and budget gate

Before billable execution, VIBA must show:

```txt
estimated credits
complexity badge
provider/spend warning when relevant
remaining balance after action
session budget cap
approval button
```

Background full-run should require a budget cap.

If the cap is reached:

```txt
pause execution
show remaining work
show credits spent
ask user to increase cap or stop
```

### 2.9 Execution

Execution must be controlled:

```txt
reserve credits before action
run only allowed provider/tool
respect safe mode
respect budget cap
respect approval gates
persist result
write receipt
update task status
```

No uncontrolled live provider loops.

### 2.10 Verification

Every completed phase must have proof.

Verification types:

```txt
TypeScript/typecheck result
frontend build result
API build result
Railway deploy result
health endpoint check
Stripe checkout verification
webhook verification
manual test checklist
before/after diff summary
```

Evidence labels:

```txt
Green = verified by tool/log/test
Yellow = inferred from available evidence
Red = blocked/unverified
```

### 2.11 Proof report

Every large build should produce a clean report:

```txt
what was requested
what was built/fixed
files changed
credits spent
agents used
build/test results
remaining risks
manual verification required
Railway/Stripe/GitHub handoff
next recommended action
```

## 3. GitHub/Railway Doctor connection

Doctor mode is the diagnostic front door for complex builds.

Doctor must feed the collaboration pipeline like this:

```txt
Doctor finding
→ task created
→ specialist agent assigned
→ quote generated
→ approval requested
→ controlled execution
→ proof report
```

Doctor should not live as a separate isolated feature.

## 4. Clean UI model

Large-build UI must stay simple.

Default screen:

```txt
Project status
Current phase
Top 3 blockers
Budget used / budget cap
Next recommended action
```

Expandable areas:

```txt
all tasks
agent timeline
credit receipts
raw logs
diffs
provider details
Doctor evidence
```

Do not show full raw logs by default.

## 5. User-facing large-build controls

Required controls:

```txt
Start build plan
Approve phase
Set budget cap
Pause run
Resume run
Stop run
Increase budget
View proof report
Open GitHub PR
Open Railway deploy
Open Billing
```

Dangerous controls must require confirmation:

```txt
merge PR
change Railway env vars
trigger deploy
delete/replace files
run expensive provider analysis
enable auto top-up
```

## 6. Professional acceptance criteria

A complex-build pipeline feature is not accepted unless:

```txt
it decomposes work into clear phases and tasks
it routes to specialist agents
it supports agent-to-agent collaboration
it has credit quote before billable execution
it supports budget cap and pause
it logs receipts/audit events
it produces proof reports
it does not overwhelm the UI
it fails closed on billing/payment uncertainty
it obeys provider safe mode
```

## 7. Build order

Implement in this order:

1. Deterministic Doctor v1.
2. Build-plan generator that creates phases and tasks.
3. Credit quote before task execution.
4. Budget cap per session.
5. Receipt/proof report after task/phase.
6. Agent handoff timeline UI.
7. Background run progress UI.
8. GitHub PR-based repair proposal.
9. Railway deploy/env verification.
10. Paid-agent escalation only after approval.

## 8. Current deployment pass rule

Do not ask Manus to build this during the current deployment pass.

Manus' current job remains:

```txt
set up Stripe prices
set up Railway env vars
run typecheck/build
fix build/deploy blockers only
verify safe mode
verify billing
report results
```

Complex-build collaboration pipeline implementation comes after the deployment and billing foundation are stable.
