#!/usr/bin/env bash
  set -euo pipefail

  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false
  export COREPACK_INTEGRITY_KEYS=0
  export COREPACK_ENABLE_AUTO=0

  echo "[build] node=$(node -v) npm=$(npm -v)"
  echo "[build] PATH=$PATH"
  echo "[build] which node: $(which node)"
  echo "[build] which npm: $(which npm)"
  echo "[build] RENDER=$(echo ${RENDER:-notset})"

  # Check if pnpm already available (Render may pre-install it via PNPM_VERSION env var)
  if command -v pnpm &>/dev/null; then
    echo "[build] pnpm already available: $(pnpm -v) at $(which pnpm)"
  else
    echo "[build] pnpm not found, installing via npm..."
    # Disable corepack to prevent interception
    corepack disable 2>/dev/null || true
    npm install -g pnpm@10.24.0
    NPM_BIN="$(npm config get prefix)/bin"
    export PATH="${NPM_BIN}:${PATH}"
    echo "[build] pnpm installed: $(pnpm -v)"
  fi

  # Step 3: Install all workspace dependencies
  echo "[build] === INSTALL ==="
  pnpm install --no-frozen-lockfile --prod=false
  echo "[build] install done"

  # Step 4: Build
  echo "[build] === BUILD BRIDGE-AI ==="
  pnpm --filter @workspace/bridge-ai run build
  echo "[build] bridge-ai built"

  echo "[build] === BUILD API-SERVER ==="
  pnpm --filter @workspace/api-server run build
  echo "[build] api-server built"

  # Step 5: Verify
  node scripts/verify-render-output.mjs
  echo "[build] all outputs verified"
  