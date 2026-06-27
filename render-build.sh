#!/usr/bin/env bash
  set -euo pipefail

  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false

  echo "[build] node=$(node -v)"
  echo "[build] pnpm=$(pnpm -v 2>/dev/null || echo NOT_FOUND)"
  echo "[build] starting install..."
  date

  pnpm install --no-frozen-lockfile --prod=false

  echo "[build] install done"
  date
  echo "[build] SUCCESS_INSTALL"

  # Intentionally exit before build so we know install succeeded
  exit 0
  