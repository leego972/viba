# VIBA Final Replit Merge Checklist

Date: 2026-06-28

## Branches involved

- `viba-landing-positioning-cleanup`
- `viba-gap-fixes-stage-2`
- Replit implementation branch: `viba-critical-gap-fixes`

## Merge order

1. Merge the landing positioning branch only after the landing page loads and the wording is correct.
2. Merge the stage 2 docs branch after Replit confirms the docs are present and build still passes.
3. Merge the critical implementation branch only after all validation below passes.

## Before merging implementation work

Replit must confirm:

- repo identity references are corrected to `leego972/viba` where current setup requires it
- landing page copy is precise and does not overclaim readiness
- Value Router is implemented as a tested pure module first
- adaptive planner is implemented as a tested pure module first
- approval checks cover sensitive workflow steps
- proof report baseline exists and hides secrets
- dashboard is clearer and not more cluttered
- Project Doctor diagnostic mode is read-only

## Required commands

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/bridge-ai run build
pnpm --filter @workspace/api-server run build
```

## Manual checks

- landing page loads
- dashboard loads
- login works
- signup works
- logout works
- pricing page loads
- billing page loads
- session creation works
- run next step works
- run full workflow works
- stop session works
- reopen session works
- approval and rejection flow works
- Project Doctor page loads
- proof report page or demo loads
- mobile viewport is usable

## Do not merge if

- typecheck fails
- build fails
- route loading breaks
- auth breaks
- billing breaks
- session workflow breaks
- admin-only routes appear for normal users
- Project Doctor performs unintended write actions in diagnostic mode
- any secret or API key is exposed

## Owner approval rule

After Replit passes validation, send the PR summary to the owner and wait for owner approval before merge.
