# VIBA Full Autonomy Blockers and Next Patches

Branch: `feature/viba-builder-toolbox`

## Current state

This branch successfully adds the Builder Toolbox planning/spec/diagnosis layer. Agents can now produce structured outputs for build, design, repair, upgrade, tests, release gates, coding-agent prompts, and acceptance criteria.

## What still needs live-execution adapters

To let VIBA agents operate more like an assistant plus Replit, the next missing adapters are:

1. Build Runner Adapter
2. GitHub Repository Adapter

These must be implemented and tested inside Replit/VPS where the repository runtime, pnpm, and environment variables are available.

## Build Runner Adapter requirements

Add a server-side adapter that runs only allowlisted commands. It must not provide arbitrary shell access.

Allowed commands:

```txt
pnpm install --no-frozen-lockfile --prod=false
pnpm run typecheck
pnpm test
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/api-server run typecheck
bash render-build.sh
```

Required toolbox IDs:

```txt
build.commands.list
build.command.run
build.safe_build.run
build.typecheck.run
build.test.run
build.render_build.run
```

Required behaviour:

- use a strict command allowlist
- no arbitrary command strings
- fixed working directory at repo root
- timeout each command
- capture stdout/stderr
- redact secrets before storage/return
- store command results in `viba_tool_invocations`
- return `rawValuesReturned: false`
- expose pass/fail status to the release gate
- disable in production unless `VIBA_BUILD_RUNNER_ENABLED=true`

## GitHub Repository Adapter requirements

Add server-side adapter for existing toolbox IDs:

```txt
github.repo.read
github.repo.write
github.pr.create
```

Required behaviour:

- use server-side `GITHUB_TOKEN` or vault credential
- read repository files safely
- create feature branches only
- block direct writes to `main`, `master`, `prod`, and `production`
- block `.github/workflows/` writes unless the token has workflow scope and owner explicitly approves
- create/update files on feature branch
- open draft PRs
- never return raw token values
- redact file output where needed
- return `rawValuesReturned: false`

## Safe workflow after these adapters exist

```txt
builder.project.blueprint
builder.feature.plan / builder.repair.diagnose
builder.patch.plan
github.repo.write on feature branch
github.pr.create as draft PR
build.safe_build.run
builder.release.gate
deployment trigger only after checks pass
report.evidence.generate
```

## Merge rule

Do not claim full autonomy until:

- Build Runner Adapter exists and passes tests.
- GitHub Repository Adapter exists and passes tests.
- `/api/tools` lists the tools.
- `/api/tools/execute` runs the real adapter, not a generic stub.
- `pnpm run typecheck` passes.
- `pnpm test` passes.
- `bash render-build.sh` passes.
- A sample branch/write/PR flow is tested on a non-production branch.

## Current branch value

This branch is still useful and safe to merge after checks because it gives agents the structured reasoning/tools they need before live mutation. But it is not the final full-autonomy layer until the two adapters above are implemented.
