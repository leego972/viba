# VIBA Builder Toolbox PR Report

Branch: `feature/viba-builder-toolbox`

## Purpose

Add practical tools to the VIBA toolbox so agents can support build, design, repair, upgrade, testing, release-gate and coding-agent workflows through the Tool Action Broker.

This is not a direct production mutation system. It gives agents structured planning/spec/report outputs that can be combined with existing guarded mutation tools such as repository writes, pull requests, deploy triggers and release gates.

## Files changed

- `artifacts/api-server/src/lib/builderToolbox.ts`
  - Adds Builder Toolbox definitions and pure execution handlers.
- `artifacts/api-server/src/lib/toolActionBroker.ts`
  - Adds builder tools to the broker listing.
  - Resolves builder tools in plan/dry-run/execute flows.
  - Returns structured builder outputs instead of generic stubs for builder tools.
  - Adds provider env checks for Render, DigitalOcean, Vercel and Sevall credential presence.
- `artifacts/api-server/src/routes/toolBroker.ts`
  - Allows `GET /api/tools/:toolId` to resolve builder tools.
- `artifacts/api-server/src/lib/builderToolbox.test.ts`
  - Adds tests for registration and structured outputs.

## New toolbox tools

| Tool ID | Purpose |
|---|---|
| `builder.project.blueprint` | Convert a user goal into a software blueprint. |
| `builder.feature.plan` | Create implementation plan for a feature. |
| `builder.patch.plan` | Plan file-by-file code changes before repo write. |
| `builder.design.review` | Review UI/UX for layout, mobile, clarity and conversion. |
| `builder.ui.spec.generate` | Generate UI implementation spec. |
| `builder.repair.diagnose` | Diagnose build/runtime/API/UI/deploy failures. |
| `builder.repair.plan` | Create ranked repair plan and verification steps. |
| `builder.upgrade.plan` | Plan professional architecture/reliability/UX/testing/deploy upgrades. |
| `builder.test.plan` | Generate unit/API/browser/mobile/deploy regression test plan. |
| `builder.release.gate` | Generate pre-merge/pre-deploy release checklist. |
| `builder.coding_agent.prompt` | Generate Replit/coding-agent implementation prompt. |
| `builder.acceptance.criteria` | Generate acceptance criteria and proof requirements. |

## Agent workflow enabled

Agents can now use:

1. `GET /api/tools` to see the builder tools.
2. `GET /api/tools/:toolId` to inspect a specific builder tool.
3. `POST /api/tools/plan` to check whether the tool can run.
4. `POST /api/tools/execute` to generate a structured builder output.
5. Existing guarded tools for repository write / PR / deploy after approval and checks.

Example:

```json
{
  "toolId": "builder.repair.diagnose",
  "action": "diagnose",
  "payload": {
    "projectName": "VIBA",
    "goal": "Fix Render build",
    "knownErrors": ["health check failed"]
  }
}
```

## Render safety

This branch does not change:

- `render.yaml`
- `render-build.sh`
- root `package.json`
- frontend build config
- API start command
- database schema
- production deploy settings

## Required checks before merge

Run:

```bash
pnpm --filter @workspace/api-server test -- builderToolbox
pnpm --filter @workspace/api-server run typecheck
pnpm test
bash render-build.sh
```

If Replit cannot run one of these, write the exact failure into the PR before merge. Do not claim green checks without output.

## Known limitation

These builder tools currently generate structured planning/specification outputs. They do not directly mutate a repository or deploy production. That is intentional: mutation should continue through existing guarded tools such as GitHub write/PR/deploy after approval and safe checks.
