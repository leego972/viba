# VIBA Focused Value Features + Whole-Repo QA Pass

Branch: `viba-full-product-completion`
PR: #4

This file defines additional value features that are directly related to VIBA's core product promise:

> diagnose projects, coordinate specialist agents, control spend, repair safely, and prove the work.

Do not add random features. Do not dilute the product into generic project management, social, accounting, CRM, or content tooling.

## Product spine

Every feature must support at least one of these:

1. **Diagnose** — find repo, deployment, UX, security, provider, billing, or readiness issues.
2. **Coordinate** — help specialist AI agents ask, answer, route, and complete work.
3. **Control** — cap credits, prevent surprise provider charges, require approvals, and fail closed.
4. **Repair** — create safe proposals and approved PRs instead of silently mutating production.
5. **Prove** — produce evidence, proof reports, share links, audit trails, and client-safe deliverables.
6. **Launch** — help owner deploy, smoke test, and control release readiness.

---

# A. Additional high-value features to add if quick and safe

These are ordered by value-to-effort. Build only if they can be completed cleanly without destabilising existing work.

## 1. Preflight Run Card

**Why it matters:** Before a session starts, the user should know cost, risk, missing connectors, approval requirements, and whether paid providers are off.

### Add

Frontend:
- On new session / crew start flow, show a preflight card.

Backend:
- `POST /api/sessions/preflight`

### Output

- estimatedCredits
- requiredConnectors
- missingConnectors
- paidProvidersEnabled: false/true
- approvalRequired
- safeModeDefault
- canStart
- blockers[]
- warnings[]

### Acceptance

- No paid provider call.
- No session mutation unless user starts session.
- Clean JSON.
- User sees why a run is blocked before spending credits.

---

## 2. Run Quality Score

**Why it matters:** VIBA needs a simple quality score per session so users can trust whether the output is complete.

### Add

Backend:
- `GET /api/sessions/:id/quality-score`

Frontend:
- Show score on proof report and session workspace.

### Score factors

- tasks completed
- approvals resolved
- blockers unresolved
- proof report generated
- budget cap hit
- provider failures
- Doctor findings tied to session if available

### Output

- score 0-100
- grade: excellent / good / needs-review / blocked
- reasons[]
- recommendedNextAction

### Acceptance

- Deterministic.
- Uses stored DB records only.
- No paid provider call.

---

## 3. Client Evidence Pack Export

**Why it matters:** Agencies and consultants can hand clients a professional deliverable.

### Add

Backend:
- `GET /api/sessions/:id/evidence-pack`

Frontend:
- Button on proof report: `Download Client Evidence Pack`

### Pack contains

- session summary
- completed tasks
- approvals
- credit receipts summary
- Doctor findings if linked
- files changed if available
- final risks
- next recommended action
- redaction enabled by default

### Formats

- JSON
- Markdown
- print-friendly page

### Acceptance

- Client-safe by default.
- No secrets.
- No internal provider keys or raw stack traces.

---

## 4. Blocker Resolution Queue

**Why it matters:** If VIBA pauses, the user needs one page telling them exactly what to fix.

### Add

Frontend:
- Enhance `/recovery`

Backend:
- Enhance `GET /api/recovery`

### Include

- paused sessions
- blocked tasks
- missing connector blockers
- budget cap blockers
- provider config blockers
- Doctor manual findings

### Each item must show

- blocker type
- source
- severity
- exact owner action
- link to fix page

### Acceptance

- No vague text like “something went wrong”.
- Always gives a next action.

---

## 5. Provider Safe-Mode Test Harness

**Why it matters:** User needs confidence provider keys/config are safe without accidentally spending money.

### Add

Backend:
- `POST /api/providers/:provider/safe-test`

### Behaviour

For cloud paid providers:
- Do not make paid inference call.
- Check only config presence and model selection.
- Return: configured / missing / disabled / requires manual live test.

For local/custom endpoints:
- Health check endpoint only.
- Timeout after 5 seconds.

### Acceptance

- No paid API call automatically.
- Never returns key values.

---

## 6. Post-Repair Verification Checklist

**Why it matters:** After VIBA creates a repair PR, it needs a clear verification gate.

### Add

Frontend:
- On Doctor proposal/repair result page, show post-repair verification checklist.

### Checklist

- branch created
- PR opened
- changed files listed
- no secrets changed
- no deployment triggered
- CI status
- manual env items skipped
- owner merge required

### Acceptance

- Repair PR cannot be presented as complete until verification checklist is visible.

---

## 7. Release Notes Generator

**Why it matters:** After a PR like #4, owner needs simple release notes for controlled users.

### Add

Backend:
- `GET /api/release-notes/latest`

Frontend:
- Add to `/market-readiness`

### Output

- new features
- changed routes
- known limitations
- manual setup needed
- controlled launch notes

### Acceptance

- Deterministic from PR/commit metadata if available.
- No paid provider calls.
- Copy/download Markdown.

---

## 8. Owner Action Checklist

**Why it matters:** Replit/Manus/GitHub/Railway split creates confusion. Owner needs one checklist inside app.

### Add

Frontend:
- `/owner-actions`

### Groups

- GitHub: PR ready/merged/main CI
- Railway: env vars/domain/deploy/health
- Stripe: products/prices/webhook/test checkout
- Email: SMTP/verification/reset
- Launch: demo/smoke/mobile/controlled users

### Acceptance

- Browser-local state is acceptable.
- Must include exact next action, not generic reminders.

---

# B. Features to avoid for now

Do not build these in this pass:

- generic CRM
- generic accounting
- social posting automation
- unrelated affiliate systems
- marketplace monetisation
- unrelated AI image/video features
- broad admin dashboards not tied to VIBA workflows
- live autonomous production mutation
- automatic Stripe live activation
- automatic provider calls without approval

---

# C. Whole-repo quality pass

After code changes, run a repo-wide quality pass.

## 1. Route registry safety

Confirm no existing router was removed from `artifacts/api-server/src/routes/index.ts`.

Required old routers must remain:

- authRouter
- healthRouter
- sessionAccessRouter
- coreDefaultsRouter
- backgroundSessionsRouter
- sessionsRouter
- attachmentsRouter
- selfRepairAutoRouter
- selfAuditMergeSafetyRouter
- selfAuditRouter
- settingsRouter
- statsRouter
- circuitStatusRouter
- workbenchRouter
- stripeRouter
- annualBillingRouter
- billingRouter
- githubRouter
- connectionsRouter
- vibaKeysRouter
- webResearchRouter
- pricingResearchRouter

Required new routers:

- providersRouter
- doctorRouter
- marketCompletionRouter

## 2. Agent collaboration safety

Confirm `processPendingQuestions` does not filter by current task ID.

Correct behaviour:

- delivery by session + recipient + unanswered question
- storage/task threading remains task-scoped
- cross-task delivery test passes

## 3. Secret safety

Search for hardcoded secrets:

```bash
grep -R "sk_live\|sk_test\|pk_live\|pk_test\|BEGIN PRIVATE KEY\|OPENAI_API_KEY=\|ANTHROPIC_API_KEY=\|GROQ_API_KEY=\|GEMINI_API_KEY=" -n . --exclude-dir=node_modules --exclude-dir=.git
```

No real secrets should appear.

## 4. Paid-provider safety

Search for automatic provider calls on page load or boot.

No paid provider should run unless:

- user configured provider
- user approved run
- budget cap exists
- receipt/audit trail is created

## 5. Stripe safety

Confirm:

- no live Stripe keys in repo
- no hardcoded price IDs unless intentional public config
- webhook route validates signature
- checkout uses configured price IDs
- test/live mode is not confused

## 6. Railway deployment safety

Confirm:

- health endpoint exists
- production env var names are documented
- missing env vars fail clearly
- app does not crash on optional Stripe/provider keys being absent

## 7. UI quality

Check:

- no blank screens
- no page says “planned Q3/Q4” for launch-critical features
- mobile nav not overcrowded
- empty states exist
- error states are readable
- buttons have clear actions

## 8. Build/test commands

Run:

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/bridge-ai run build
pnpm test
```

If a command is unsupported, report exact reason.

---

# D. Final report required from Replit

Replit final report must include:

- latest commit SHA
- features added from this file
- features skipped and why
- typecheck result
- API build result
- frontend build result
- test result
- secret scan result
- paid-provider safety result
- Stripe safety result
- route registry result
- agent collaboration test result
- frontend route check result
- whether PR #4 is ready for owner review

Final line must be one of:

`PR #4 READY FOR OWNER REVIEW`

or

`PR #4 BLOCKED — <exact blocker>`
