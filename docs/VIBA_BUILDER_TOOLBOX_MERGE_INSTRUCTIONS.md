# Replit Merge Instructions — VIBA Builder Toolbox

You are working on branch:

```txt
feature/viba-builder-toolbox
```

Goal:
Finish validation of the Builder Toolbox and merge only if it does not break the Render build.

## Scope already implemented

The branch adds builder/design/repair/upgrade planning tools to the existing Tool Action Broker.

Do not expand scope into production repository mutation or automated deploy execution in this PR. This PR is for safe structured builder outputs that agents can use before invoking existing guarded tools.

## Validate changed files

Check these files:

```txt
artifacts/api-server/src/lib/builderToolbox.ts
artifacts/api-server/src/lib/builderToolbox.test.ts
artifacts/api-server/src/lib/toolActionBroker.ts
artifacts/api-server/src/routes/toolBroker.ts
docs/VIBA_BUILDER_TOOLBOX_PR_REPORT.md
```

Confirm:

- `GET /api/tools` includes the new builder tools.
- `GET /api/tools/builder.repair.diagnose` returns the tool definition.
- `POST /api/tools/plan` works for a builder tool.
- `POST /api/tools/execute` returns structured output for a builder tool.
- No raw credential values are returned.
- Existing non-builder tools still plan/dry-run/execute as before.

## Required commands

Run:

```bash
pnpm install --no-frozen-lockfile --prod=false
pnpm --filter @workspace/api-server test -- builderToolbox
pnpm --filter @workspace/api-server run typecheck
pnpm test
bash render-build.sh
```

If any command fails because of Replit limitations, record the exact command and exact error. Do not mark it passed.

## Render no-break rule

This branch must not modify:

```txt
render.yaml
render-build.sh
package.json
artifacts/api-server/package.json
artifacts/bridge-ai/package.json
scripts/verify-render-output.mjs
```

If any of those files are changed, stop and explain why before merging.

## Smoke test examples

Use authenticated session/API access as required by VIBA.

### List tools

```bash
curl -s "$VIBA_BASE_URL/api/tools" | grep builder.repair.diagnose
```

### Inspect one tool

```bash
curl -s "$VIBA_BASE_URL/api/tools/builder.repair.diagnose"
```

### Execute repair diagnosis

```bash
curl -s -X POST "$VIBA_BASE_URL/api/tools/execute" \
  -H 'Content-Type: application/json' \
  -d '{
    "toolId":"builder.repair.diagnose",
    "action":"diagnose",
    "payload":{
      "projectName":"VIBA",
      "goal":"Fix Render build",
      "knownErrors":["health check failed"]
    }
  }'
```

Expected response properties:

```txt
status=executed
rawValuesReturned=false
result.mutationPerformed=false
result.output exists
```

## Merge decision

Merge only if:

- typecheck passes,
- tests pass,
- render build passes,
- smoke test confirms builder tools appear in `/api/tools`,
- no Render build/start files were changed.

If checks pass, squash merge with:

```txt
feat(toolbox): add builder design repair upgrade tools
```
