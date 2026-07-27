# VIBA Orchestrator and Toolset Audit — 2026-07-27

## Objective

Reduce unnecessary model calls, route work to the smallest capable team, minimise user interruption, and make execution progress understandable in real time.

## Orchestrator changes implemented

- Simple instructions now use a single-agent path.
- A separate final synthesis task is created only when multiple specialist outputs must be merged.
- Duplicate task types are removed before persistence.
- Instructions receive a simple, standard, or complex classification.
- Tool requirements are inferred before agent assignment.
- The delegation message exposes execution mode, estimated agent calls, phases, assigned agents, and providers.
- Agent instructions explicitly reuse session context and avoid duplicate research or unnecessary alternate outputs.

## Existing toolset strengths

The repository already contains a broad brokered tool architecture with:

- GitHub repository and pull-request operations.
- Render deployment support and deployment-provider abstractions.
- Railway support retained for projects that use Railway.
- Browser operations and supervised high-risk browser actions.
- Stripe product, price, webhook, and credit-ledger functions.
- DNS read/write planning.
- SMTP testing and communication tooling.
- Safe-build, testing, project analysis, repair, upgrade, reporting, storage, security, vault, AI, network, inference, and developer-tool categories.
- Central risk policy, dry-run handling, approval gates, credential checks, redaction, and invocation auditing.

## Highest-value missing or incomplete capabilities

These are the priority additions for completing work with minimal user interference.

### P0 — required for autonomous project completion

1. **Cloudflare control-plane tools**
   - R2 bucket/object lifecycle operations.
   - Cloudflare DNS records using authenticated API access.
   - Cache purge and zone-status checks.
   - Pages/Workers deployment status where used.
   - Read operations should not require approval; writes require dry-run; destructive actions require approval.

2. **Render service operations through the central broker**
   - Read service/deploy status, logs, environment-variable names, custom domains, and health.
   - Trigger deploy, rollback, and environment writes behind approval gates.
   - VIBA itself is Render-hosted, so Render must be treated as a first-class provider rather than routing its own deployment through Railway assumptions.

3. **Repository workspace execution**
   - Clone or checkout an authorised repository into an isolated workspace.
   - Install dependencies with lockfile enforcement.
   - Run typecheck, lint, tests, build, and targeted commands.
   - Return structured logs and changed-file summaries.
   - Apply resource limits, network policy, timeouts, malware scanning, and secret redaction.

4. **Patch and pull-request workflow**
   - Create branch, apply patch, update files, commit, open PR, inspect CI, respond to review, and merge after approval.
   - The orchestrator should continue through all safe read/write stages without repeatedly asking the user.

5. **Current-web evidence tool**
   - Search, fetch, parse, cite, and timestamp public sources.
   - Cache identical searches within the session.
   - Enforce source-quality and freshness requirements.

### P1 — major reduction in user interruption

6. **Email and contact workflow**
   - Search/read relevant email threads, create drafts, send after policy checks, resolve recipients from contacts, and track replies.
   - Sending external mail should require user approval unless a pre-approved automation policy exists.

7. **Calendar workflow**
   - Read availability, locate existing events, create/update meetings, and attach project context.
   - Avoid asking the user for times already available from calendar data.

8. **Document and file understanding**
   - Parse PDF, DOCX, spreadsheets, slides, images, archives, and source trees.
   - Extract text, tables, metadata, and file relationships.
   - Generate user-facing reports and export files without storing binaries in the database.

9. **Scheduled jobs and condition watches**
   - Deployment monitoring, expiry cleanup, health checks, CI monitoring, domain/DNS validation, and recurring reports.
   - Notify only when a meaningful state change or failure occurs.

10. **Notification routing**
    - In-app notification, email, webhook, and optional Slack/Discord delivery.
    - Deduplicate repeated alerts and apply severity thresholds.

### P2 — quality, efficiency, and product differentiation

11. **Semantic task-result cache**
    - Cache stable research, repository maps, package inventories, and generated analyses.
    - Key by project, branch/commit, tool inputs, and freshness window.
    - Never cache secrets or approval tokens.

12. **Model price and capability catalogue**
    - Store provider/model input cost, output cost, context, tool support, latency class, and reliability score.
    - Refresh pricing independently of application releases.
    - Route by minimum expected cost subject to capability and quality thresholds.

13. **Token and context budgeter**
    - Summarise older context once, retrieve only relevant memory, cap peer-agent transcripts, and prevent full-session replay on every task.

14. **Parallel task scheduler**
    - Run only dependency-independent tasks in parallel.
    - Apply provider concurrency limits and a session cost ceiling.
    - Cancel redundant work when another task already produced a sufficient result.

15. **Result verifier**
    - Validate claims against tool output, test results, file diffs, and deployment status.
    - Prevent agents from claiming completion when no mutation or check actually occurred.

## Recommended orchestration policy

1. Inspect session memory, connected tools, credentials, and project state.
2. Resolve discoverable values automatically.
3. Create the minimum viable task graph.
4. Reuse cached evidence and repository analysis.
5. Route each task to the cheapest agent meeting capability, quality, tool, and context requirements.
6. Execute independent tasks concurrently within cost and rate limits.
7. Ask the user only for:
   - a genuinely missing required value;
   - external communication approval;
   - financial or destructive action approval;
   - a material product decision with no safe default.
8. Verify outputs using tools rather than agent self-report.
9. Return one consolidated result with completed actions, evidence, cost, and unresolved blockers.

## Live orchestration experience

The UI should render broker and audit events as a real execution graph:

- **Discovering** — VIBA is inspecting context, tools, credentials, and project state.
- **Planning** — task nodes appear with dependencies and estimated calls.
- **Delegating** — an animated connection moves from the VIBA brain to the selected agent.
- **Working** — each node shows tool calls, elapsed time, and concrete progress rather than generic typing animation.
- **Verifying** — tests, source checks, diffs, and deployment checks appear as evidence badges.
- **Complete** — outputs converge into the VIBA brain and one final result is presented.

Animations must be driven by real server events. Do not fabricate agent conversations or progress.

## Immediate next implementation sequence

1. Add a model capability/cost catalogue and cost-aware router tie-breaking.
2. Add context budgeting and session-level semantic caching.
3. Add dependency-aware parallel scheduling.
4. Complete first-class Render and Cloudflare broker execution.
5. Add repository workspace execution and verified PR workflow.
6. Connect audit events to the live orchestration graph.
7. Add email, contacts, calendar, scheduled monitoring, and notification connectors.
