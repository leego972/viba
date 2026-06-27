#!/usr/bin/env bash
  set -euo pipefail

  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false

  echo "[build] === ENV ==="
  echo "[build] node=$(node -v) npm=$(npm -v)"
  echo "[build] pnpm=$(pnpm -v 2>/dev/null || echo NOT_FOUND) at $(which pnpm 2>/dev/null || echo NONE)"
  echo "[build] cwd=$(pwd)"

  # Render pre-installs pnpm when PNPM_VERSION env var is set.
  # No need to npm install -g pnpm — just verify it's available.
  if ! command -v pnpm &>/dev/null; then
    echo "[build] ERROR: pnpm not found. Install it or set PNPM_VERSION env var on Render."
    exit 1
  fi

  echo "[build] === INSTALL ==="
  pnpm install --no-frozen-lockfile --prod=false
  echo "[build] install done"

  echo "[build] === BUILD BRIDGE-AI ==="
  pnpm --filter @workspace/bridge-ai run build
  echo "[build] bridge-ai built"

  echo "[build] === BUILD API-SERVER ==="
  pnpm --filter @workspace/api-server run build
  echo "[build] api-server built"

  echo "[build] === VERIFY ==="
  node scripts/verify-render-output.mjs
  echo "[build] all outputs verified"
  