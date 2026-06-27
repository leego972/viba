#!/usr/bin/env bash
  set -euo pipefail
  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false
  echo "[build] node=$(node -v) pnpm=$(pnpm -v)"
  pnpm install --no-frozen-lockfile --prod=false
  echo "[build] install done"
  pnpm --filter @workspace/api-server run build
  echo "[build] api-server done"
  ls -la artifacts/api-server/dist/index.mjs && echo "[build] verified"
  