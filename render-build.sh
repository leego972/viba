#!/usr/bin/env bash
  set -euo pipefail

  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false
  export COREPACK_INTEGRITY_KEYS=0
  export COREPACK_ENABLE_AUTO=0

  echo "[build] node=$(node -v) pnpm=$(pnpm -v 2>/dev/null || echo missing)"

  # pnpm is pre-installed by Render via PNPM_VERSION env var
  if ! command -v pnpm &>/dev/null; then
    corepack disable 2>/dev/null || true
    npm install -g pnpm@10.24.0
    export PATH="$(npm config get prefix)/bin:${PATH}"
  fi

  echo "[build] using pnpm $(pnpm -v)"

  # Install
  pnpm install --no-frozen-lockfile --prod=false
  echo "[build] install done"

  # Build (NODE_OPTIONS=--max-old-space-size=400 set via Render env var)
  pnpm --filter @workspace/bridge-ai run build
  echo "[build] bridge-ai done"

  pnpm --filter @workspace/api-server run build
  echo "[build] api-server done"

  node scripts/verify-render-output.mjs
  echo "[build] verified"
  