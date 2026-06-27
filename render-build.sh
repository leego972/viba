#!/usr/bin/env bash
  set -euo pipefail
  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false
  echo "[build] node=$(node -v) pnpm=$(pnpm -v)"
  pnpm install --no-frozen-lockfile --prod=false
  echo "[build] install done"
  echo "[build] pushing DB schema..."
  pnpm --filter @workspace/db run push 2>&1 || true
  echo "[build] db schema push complete"
  pnpm --filter @workspace/bridge-ai run build
  echo "[build] bridge-ai done"
  pnpm --filter @workspace/api-server run build
  echo "[build] api-server done"
  node scripts/verify-render-output.mjs
  echo "[build] all done"
  