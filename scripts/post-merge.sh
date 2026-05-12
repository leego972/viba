#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Sync the latest commit to the leego972/bridge-ai GitHub repository.
# Uses the Replit GitHub connector (repo scope) — no additional secrets needed.
# A sync failure is logged but does not abort the post-merge setup.
echo "[post-merge] Syncing workspace changes to GitHub..."
pnpm --filter @workspace/scripts run sync-github || true

# Show sync result from sync-status.json written by sync-github.ts
STATUS_FILE="$(git rev-parse --show-toplevel)/sync-status.json"
if [ -f "$STATUS_FILE" ]; then
  STATUS=$(node -e "const s=require('$STATUS_FILE'); process.stdout.write(s.status)")
  if [ "$STATUS" = "failed" ]; then
    ERROR=$(node -e "const s=require('$STATUS_FILE'); process.stdout.write(s.error||'')")
    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  POST-MERGE: GitHub sync FAILED — see issue on repo ║"
    echo "╚══════════════════════════════════════════════════════╝"
    echo "  Error: $ERROR"
    echo "  Repo:  https://github.com/leego972/bridge-ai"
    echo ""
  else
    echo "[post-merge] GitHub sync succeeded."
  fi
fi
