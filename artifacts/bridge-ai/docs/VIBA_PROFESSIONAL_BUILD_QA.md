# VIBA Professional Build QA

This checklist is for the final Manus/build pass. It exists to keep VIBA professional, visually clean, and commercially credible.

## Product promise to preserve

> VIBA is the AI Business Asset Passport for researching, designing, building, verifying, scoring, improving, and monetising the systems a business depends on.

## Visual quality checks

Check these pages manually after build:

```text
/
/bridge
/workbench
/sessions/new
/dashboard
/settings
```

For each page confirm:

- No cramped cards.
- No overlapping text.
- No broken icon imports.
- No excessive vertical clutter above the fold.
- Mobile layout is readable at iPhone width.
- Primary CTA is obvious.
- Secondary CTAs are not visually louder than the main action.
- Card spacing is consistent.
- Empty states look intentional.
- Dark/light mode remains readable if the app supports both.

## Button truth test

Every button must pass one of these:

```text
Opens a real route
Starts a real workflow
Copies/exports real text
Triggers a real backend/client action
```

Remove or hide any button that fails this test.

## Current connected buttons to verify

### Landing

- `Dashboard` → `/dashboard`
- `Start Orchestrating` → `/dashboard`
- `Growth Engine` → `/bridge`
- `User Instructions` → `/user-instructions`
- `Open Growth Engine` → `/bridge`

### Growth Engine

- `Start agent session` → `/sessions/new`
- `Copy command prompt` → clipboard
- `Copy campaign assets` → clipboard

### Workbench

- `Run Guarded Analysis` → existing workbench analyze mutation
- `Packet` → clipboard review packet
- `Copy` → clipboard recommended answer
- `Mark as used` → local history state
- `Load` → local history result
- `Clear all` → local history clear

### New Session

- Template cards → fill goal, autonomy, agents
- `Save team` → localStorage saved team
- `Load` team → applies saved team
- `Auto-assign` → resets default roles
- `Start Session` → existing create session mutation

## Professional copy checks

Avoid:

- Guaranteed revenue claims.
- Public shame-board language.
- Fake verification claims.
- Over-promising autonomous build success.
- Saying an asset is verified when proof gates are incomplete.

Prefer:

- `proof-led`
- `readiness`
- `verified workflow`
- `next best action`
- `business asset`
- `private diagnostics`
- `revenue path`

## Build checks

Run from `artifacts/bridge-ai`:

```bash
pnpm install
pnpm typecheck
pnpm build
```

If the build fails, inspect these first:

1. `src/pages/workbench.tsx` result type casts.
2. `src/pages/new-session.tsx` role string values in `ROLES` and `SESSION_TEMPLATES`.
3. `src/pages/home.tsx` icon imports and Tailwind classes.
4. `src/pages/bridge.tsx` strict type unions around `CommandStatus` and `ProofGate`.

## Acceptance standard

The build is not production-ready until all of these are true:

- App builds without TypeScript errors.
- Landing page looks premium on desktop and mobile.
- `/bridge` has no dead actions.
- `/workbench` can run or fail gracefully.
- `/sessions/new` can create a session with the Asset Passport template.
- No fake persistence is shown before the backend asset ledger exists.
