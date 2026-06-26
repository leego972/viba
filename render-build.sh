#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV=production
export NPM_CONFIG_PRODUCTION=false
export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
export PATH="$PNPM_HOME:$PATH"

npm install -g pnpm@10.24.0
pnpm install --no-frozen-lockfile --prod=false
pnpm --filter @workspace/bridge-ai run build
pnpm --filter @workspace/api-server run build
node scripts/verify-render-output.mjs
