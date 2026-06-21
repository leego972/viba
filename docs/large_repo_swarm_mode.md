# VIBA Large Repo Swarm Mode

## Purpose

When a system build is complex or a large repo must be reviewed quickly, VIBA should switch from single-agent mode into multi-agent repo swarm mode.

## Trigger conditions

Use swarm mode when one or more conditions are true:

- The repo has many files or multiple apps/packages.
- The task affects auth, billing, database, deployment, or security.
- The user asks for quick review across a large codebase.
- The job needs frontend, backend, database, testing and deployment review at the same time.
- A first pass finds many critical or high-severity issues.
- The user explicitly enables multiple agents.

## Default cost rule

Do not call every AI by default.

Use the cheapest adequate route first.

Escalate only when speed, complexity, confidence, or risk justifies it.

## Swarm roles

- Repo mapper: builds the file tree, package map, route map and dependency map.
- Frontend agent: reviews UI, state, forms, responsive layout and client errors.
- Backend agent: reviews API routes, auth, permissions, validation and server errors.
- Database agent: reviews schema, migrations, indexes and data integrity risks.
- Security agent: reviews secrets, access gates, token handling and dangerous actions.
- Build agent: checks install, typecheck, build, start commands and deployment config.
- Testing agent: creates smoke, regression and critical-flow test plans.
- Reviewer agent: merges findings, removes duplicates, ranks severity and produces the final plan.

## Workflow

1. Map repo structure.
2. Split files by domain.
3. Assign domains to agents.
4. Run agents in parallel.
5. Each agent reports findings with file paths, severity, evidence and recommended fix.
6. Reviewer agent merges duplicates and conflicts.
7. VIBA creates one ranked fix plan.
8. User approves fixes.
9. Build agent applies or prepares changes.
10. Testing agent retests affected flows.
11. VIBA logs every scan, issue, fix, build and deployment event.

## Parallel scan domains

- public pages
- app shell and navigation
- auth/session logic
- billing/subscription logic
- API routes
- database schema and migrations
- integrations and connectors
- deployment and environment variables
- tests and build scripts
- security and privacy

## Output format

Each agent must return:

- summary
- files reviewed
- bugs found
- severity
- evidence
- recommended fix
- risk of fixing
- retest steps
- confidence score

The final merged report must include:

- executive summary
- critical issues
- high issues
- medium issues
- low issues
- duplicate findings removed
- fix order
- build/test checklist
- deployment checklist
- final confidence score

## Approval gates

VIBA must request explicit approval before:

- deleting files
- changing auth
- changing billing
- changing database migrations
- changing production env vars
- deploying
- merging pull requests
- running destructive scripts

## Log requirement

Every swarm job must write to `viba_activity_logs`:

- swarm_started
- repo_mapped
- agent_assigned
- agent_completed
- issue_found
- fix_plan_created
- approval_requested
- fix_applied
- build_started
- build_failed
- build_passed
- deploy_started
- deploy_failed
- deploy_passed
- swarm_completed
