# VIBA Stage 2 Gap Fixes

Date: 2026-06-28
Branch: viba-gap-fixes-stage-2

## Objective

Close the largest product and trust gaps without destabilising the build.

This pass focuses on clear implementation direction that Replit can apply and verify safely.

## Gap fixes covered

1. Launch status truth file.
2. Repository identity cleanup.
3. Value Router design.
4. Adaptive workflow planner design.
5. Approval gate acceptance rules.
6. Proof report acceptance rules.
7. Dashboard command-center cleanup.
8. Replit validation checklist.

## Product rule

AI collaboration stays central. VIBA should be positioned as controlled AI collaboration for serious project work.

Collaboration is the engine. Control, budget discipline, approvals, diagnostics, and proof are the commercial differentiators.

## Build safety rule

Replit must run typecheck and build before merging any code change.

Avoid changing package files, database shape, billing flow, auth flow, and deployment settings unless a specific gap requires it and a build check is available.
