#!/usr/bin/env bash
  set -euo pipefail

  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false
  export COREPACK_INTEGRITY_KEYS=0
  export COREPACK_ENABLE_AUTO=0

  echo "[build] ===== ENVIRONMENT ====="
  echo "[build] node=$(node -v) npm=$(npm -v)"
  echo "[build] uname=$(uname -a)"
  echo "[build] HOME=$HOME"
  echo "[build] PATH=$PATH"
  which pnpm 2>/dev/null && echo "[build] pnpm(system)=$(pnpm -v)" || echo "[build] pnpm not in PATH yet"

  # Step 1: Disable corepack shims
  corepack disable 2>/dev/null || true
  echo "[build] corepack shims disabled"

  # Step 2: Install pnpm 10.24.0 via npm
  npm install -g pnpm@10.24.0
  NPM_BIN="$(npm config get prefix)/bin"
  export PATH="${NPM_BIN}:${PATH}"
  echo "[build] pnpm=$(pnpm -v) at $(which pnpm)"

  # Step 3: Install all workspace dependencies
  echo "[build] ===== INSTALL ====="
  pnpm install --no-frozen-lockfile --prod=false 2>&1
  echo "[build] install exit code: $?"
  echo "[build] install done"

  # Step 4: Build frontend
  echo "[build] ===== BUILD BRIDGE-AI ====="
  pnpm --filter @workspace/bridge-ai run build 2>&1
  echo "[build] bridge-ai exit code: $?"

  # Step 5: Build API server
  echo "[build] ===== BUILD API-SERVER ====="
  pnpm --filter @workspace/api-server run build 2>&1
  echo "[build] api-server exit code: $?"

  # Step 6: Verify outputs
  node scripts/verify-render-output.mjs
  echo "[build] all outputs verified"
  