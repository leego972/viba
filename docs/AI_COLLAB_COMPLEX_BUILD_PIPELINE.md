# VIBA AI Collaboration Complex Build Pipeline

VIBA must be capable of handling large, complex builds without turning into a chaotic chatbot. The method is controlled AI collaboration: break the work down, route it to specialist agents, verify each stage, preserve context, enforce budgets, and produce evidence.

## 1. Core idea

A complex build should not be executed as one giant prompt.

It should run as a controlled pipeline:

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
→ Doctor checks
→ approval gates
→ PR/checkpoint creation
→ verification
→ proof report
→ credit receipt
```

The user sees a clean mission-control interface, not all raw agent chatter.

## 2. Build modes

### 2.1 Planning mode

Purpose: understand the job before spending heavy credits.

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

Planning mode should be cheap-first and can run without expensive providers where possible.

### 2.2 Doctor mode

Purpose: diagnose GitHub/Railway/build/deployment problems.

Doctor checks first:

```txt
CI status
build status
package manager mismatch
lockfile mismatch
Railway env checklist
Stripe env checklist
health endpoint
known error patterns
```

Doctor does not mutate GitHub or Railway by default.

### 2.3 Build mode

Purpose: execute planned software/product work.

Rules:

```txt
must have task breakdown
must have budget cap for long/full-run work
must quote credits before expensive execution
must use approval gates for high-risk changes
must prefer PR/checkpoint workflow over direct mutation
```

### 2.4 Repair mode

Purpose: fix failures found by Doctor or build validation.

Rules:

```txt
identify exact failure
create minimal patch
run validation
produce before/after proof
avoid broad rewrites
require approval before merge/deploy
```

## 3. Specialist agent roles

Large builds should use specialist roles, not generic agents.

Recommended agent roster:

```txt
Architect Agent       → system design, decomposition, risk map
Frontend Agent        → UI, routes, components, mobile responsiveness
Backend Agent         → APIs, database, auth, billing, queues
DevOps Agent          → GitHub Actions, Railway, env vars, deployment
Billing Agent         → Stripe, credits, receipts, finance safety
QA Agent              → tests, build verification, acceptance checks
Security Agent        → secrets, auth boundaries, unsafe actions
Doctor Agent          → GitHub/Railway diagnostics and blocker classification
Product Agent         → UX clarity, clean accounting-style interface, user flow
```

The router should assign tasks by type, capability, and provider availability.

## 4. Collaboration rules

Agents may ask each other questions, but chatter must be controlled.

Rules:

```txt
questions are task-scoped
max outbound questions per step
answers attach to the originating task
handoffs preserve partial work
fallbacks preserve partial work
agent timeline stores major events only
```

The UI should show:

```txt
Agent A asked Agent B
Agent B answered
Task handed to tool-capable agent
Provider failed, rerouted
Approval required
```

The UI should not show raw prompt noise, retry spam, token logs, or every polling event by default.

## 5. Budget and spend controls

Large builds must be financially controlled.

Required before full-run/background work:

```txt
credit quote range
session budget cap
provider safe-mode status
allowed live providers
stop behaviour at cap
approval before exceeding cap
```

If provider spend is not proven safe, use:

```env
VIBA_COST_SAFE_MODE=true
VIBA_LIVE_AGENTS_ENABLED=false
VIBA_BACKGROUND_MAX_TURNS=3
```

For controlled live testing:

```env
VIBA_COST_SAFE_MODE=false
VIBA_LIVE_AGENTS_ENABLED=true
VIBA_ALLOWED_LIVE_PROVIDERS=groq,openai
VIBA_BACKGROUND_MAX_TURNS=5
```

Never enable all live providers at once during early rollout.

## 6. Large build state machine

A complex build should move through explicit states:

```txt
intake
planning
awaiting_context
quoted
approved
running
needs_approval
paused_budget_cap
paused_out_of_credits
paused_payment_required
blocked_needs_tools
repairing
validating
completed
failed_needs_review
```

Every state change should produce an audit event.

## 7. GitHub/Railway Doctor integration

Doctor mode must plug into the same collaboration pipeline.

Correct integration:

```txt
Doctor diagnostic creates findings
findings become tasks
tasks route to specialist agents
repair proposals become PR/checkpoint work
approval gate controls merge/deploy
proof report closes the loop
```

Incorrect integration:

```txt
Doctor runs separately
Doctor dumps raw logs
Doctor calls expensive providers immediately
Doctor changes Railway env vars without approval
Doctor merges/deploys without approval
```

## 8. Proof report format

Every complex build or repair should finish with a proof report.

Required sections:

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

Evidence labels:

```txt
Green  = verified by build/test/log/tool
Yellow = inferred from available evidence
Red    = unverified or blocked
```

## 9. Clean UI for big builds

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

Advanced sections:

```txt
agent timeline
raw logs
task dependency map
credit receipts
proof report
Doctor evidence
```

## 10. Acceptance criteria

Large complex build mode is acceptable only when:

```txt
work is decomposed into tasks
specialist agents are assigned appropriately
budget cap is visible
billable actions have quotes and receipts
Doctor findings become tasks
handoffs preserve context
fallbacks preserve partial work
PR/checkpoint path exists for code changes
build/typecheck evidence is captured
final proof report is generated
UI remains clean and crisp
```
