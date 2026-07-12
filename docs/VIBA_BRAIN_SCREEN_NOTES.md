# VIBA Brain Screen Notes

Branch: `feature/viba-brain-screen`

## Built

The existing `/tool-console` page has been redesigned into a VIBA Brain / Mission Control screen.

Changed files:

```txt
artifacts/bridge-ai/src/pages/tool-console.tsx
artifacts/bridge-ai/src/components/layout/Navbar.tsx
```

The page gives users a more engaging command surface:

- Mission Control visual centre
- relevant agent nodes: Director, Builder, Designer, QA
- workflow rail for repair, design, upgrade and deploy work
- mission route theatre
- capability truth board
- recent activity trail
- provider and tool counters
- proof discipline meter
- real navigation actions to start a mission, view sessions, and open the agent console

## Removed unfinished controls

The earlier UI had visual controls for adding notes and pausing work. Those were removed because they were not wired to live session APIs.

The Brain screen now avoids fake controls. Live steering belongs in the active session workspace, where the user can work with VIBA in context.

## Honest status

This is a real UI build connected to existing API reads where available.

The page shows a warning if the capability route is not mounted yet. It does not pretend missing backend data is live.

## Still required in Replit

Replit should:

1. Run frontend typecheck and build.
2. Verify the page at `/tool-console`.
3. Verify the navbar shows `VIBA Brain` under Command.
4. Verify capability data loads from `/api/tools/capabilities` if the backend route is mounted.
5. Keep the page honest: do not describe it as fully autonomous until live adapters and proof checks pass.

## Required checks

Run:

```bash
pnpm --filter @workspace/bridge-ai run typecheck
pnpm --filter @workspace/bridge-ai run build
pnpm --filter @workspace/api-server run typecheck
pnpm test
bash render-build.sh
```

Current safe-to-advertise status: PARTIAL.

Safe to advertise as:

> VIBA Brain is a visual command surface for watching agent routes, capability status, tool activity, proof discipline and mission state.

Not safe to advertise yet as:

> Fully autonomous build, repair and deployment execution.

That requires verified live adapters, passing build checks and evidence reports from real runs.
