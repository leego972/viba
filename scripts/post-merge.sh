#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Sync the latest commit to the leego972/bridge-ai GitHub repository.
# Uses the Replit GitHub connector (repo scope) — no additional secrets needed.
# A sync failure is logged but does not abort the post-merge setup.
echo "[post-merge] Syncing workspace changes to GitHub..."
pnpm --filter @workspace/scripts run sync-github || true
