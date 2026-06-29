#!/usr/bin/env bash
  set -e

  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false

  # Ensure pnpm is available — Render may need corepack activated explicitly
  if ! command -v pnpm &>/dev/null; then
    echo "[build] pnpm not in PATH — enabling via corepack..."
    corepack enable pnpm || npm install -g pnpm@10.24.0
  fi

  echo "[build] node=$(node -v)"
  echo "[build] pnpm=$(pnpm --version 2>/dev/null || echo 'unknown')"

  echo "[build] installing dependencies..."
  pnpm install --no-frozen-lockfile --prod=false
  echo "[build] install done"

  echo "[build] pushing DB schema (non-fatal)..."
  pnpm --filter @workspace/db run push 2>&1 || echo "[build] db push exited non-zero — continuing"
  echo "[build] db push done"

  echo "[build] building bridge-ai..."
  pnpm --filter @workspace/bridge-ai run build
  echo "[build] bridge-ai done"

  echo "[build] building api-server..."
  pnpm --filter @workspace/api-server run build
  echo "[build] api-server done"

  echo "[build] verifying output..."
  node scripts/verify-render-output.mjs
  echo "[build] all done!"
  