#!/usr/bin/env bash
  set -euo pipefail

  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false

  echo "[build] node=$(node -v) pnpm=$(pnpm -v)"

  pnpm install --no-frozen-lockfile --prod=false
  echo "[build] install done"

  pnpm --filter @workspace/bridge-ai run build
  echo "[build] bridge-ai done"

  # Skip api-server for this test
  # pnpm --filter @workspace/api-server run build

  # Verify bridge-ai output only
  ls -la artifacts/bridge-ai/dist/public/index.html && echo "[build] output verified"
  