# VIBA Brain Screen Notes

Branch: `feature/viba-brain-screen`

## Built

The existing `tool-console` page has been redesigned into a VIBA Brain screen.

Changed file:

`artifacts/bridge-ai/src/pages/tool-console.tsx`

The page now gives users a more engaging command surface:

- brain-style visual centre
- workflow rail for repair, design, upgrade and deploy work
- capability truth board
- recent activity lane
- provider and tool counters
- intervention panel where the user can type steering notes

## Honest status

This is a UI build, connected to existing API reads where available.

The page shows a warning if the capability route is not mounted yet. It does not pretend missing backend data is live.

## Still required in Replit

Replit should:

1. Run frontend typecheck and build.
2. Verify the page at `/tool-console`.
3. Wire the capability routes if not already mounted.
4. Wire the intervention text box to the current session message API.
5. Wire the pause button to the current session stop API.
6. Rename the navbar item from `Tool Console` to `VIBA Brain`.
7. Keep the page honest: do not describe it as fully autonomous until live adapters and proof checks pass.

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
