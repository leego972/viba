#!/usr/bin/env bash
  set -euo pipefail

  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false
  export COREPACK_INTEGRITY_KEYS=0
  export COREPACK_ENABLE_AUTO=0

  echo "[build] node=$(node -v) npm=$(npm -v)"

  # Step 1: Disable corepack shims
  corepack disable 2>/dev/null || true
  echo "[build] corepack shims disabled"

  # Step 2: Install pnpm 10.24.0 via npm
  # Use --ignore-scripts to skip the preinstall guard in package.json
  # (that guard only applies to pnpm runs, not global npm installs)
  npm install -g pnpm@10.24.0 --ignore-scripts
  NPM_BIN="$(npm config get prefix)/bin"
  export PATH="${NPM_BIN}:${PATH}"
  echo "[build] pnpm=$(pnpm -v) at $(which pnpm)"

  # Step 3: Install all workspace dependencies using pnpm (preinstall guard passes for pnpm)
  pnpm install --no-frozen-lockfile --prod=false
  echo "[build] install done"

  # Step 4: Build frontend + API
  pnpm --filter @workspace/bridge-ai run build
  echo "[build] bridge-ai built"
  pnpm --filter @workspace/api-server run build
  echo "[build] api-server built"

  # Step 5: Verify required outputs
  node scripts/verify-render-output.mjs
  echo "[build] all outputs verified"
  