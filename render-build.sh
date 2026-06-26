#!/usr/bin/env bash
  set -euo pipefail

  # Disable corepack interception — Node 22 enables corepack by default,
  # which intercepts the 'pnpm' command and causes the keyid integrity error.
  export COREPACK_ENABLE_AUTO=0
  export COREPACK_INTEGRITY_KEYS=0

  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false

  echo "[render-build] Node: $(node -v) | npm: $(npm -v)"

  # Install pnpm 10.24.0 directly via npm (corepack is disabled above)
  npm install -g pnpm@10.24.0

  # Put npm's global bin first on PATH so the freshly installed pnpm is used,
  # not any corepack shim or .tool-versions version
  export PATH="$(npm config get prefix)/bin:${PATH}"

  echo "[render-build] pnpm: $(pnpm -v)"

  # Install all workspace dependencies
  pnpm install --no-frozen-lockfile --prod=false

  # Build frontend + API server
  pnpm --filter @workspace/bridge-ai run build
  pnpm --filter @workspace/api-server run build

  # Verify required outputs exist
  node scripts/verify-render-output.mjs

  echo "[render-build] Build complete."
  