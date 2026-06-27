#!/usr/bin/env bash
  set -euo pipefail
  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false

  echo "[build] node=$(node -v) pnpm=$(pnpm -v)"
  echo "[build] === bridge-ai ==="
  pnpm --filter @workspace/bridge-ai run build
  echo "[build] bridge-ai done"

  echo "[build] === api-server ==="
  pnpm --filter @workspace/api-server run build
  echo "[build] api-server done"

  echo "[build] === verify ==="
  node scripts/verify-render-output.mjs
  echo "[build] all done"
  