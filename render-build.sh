#!/usr/bin/env bash
set -e

export NODE_ENV=production
export NPM_CONFIG_PRODUCTION=false

if ! command -v pnpm &>/dev/null; then
  echo "[build] pnpm not in PATH — installing via npm..."
  npm install -g pnpm@10.26.1 --quiet
fi

echo "[build] node=$(node -v)"
echo "[build] pnpm=$(pnpm --version 2>/dev/null || echo 'unknown')"
echo "[build] platform=$(node -e 'console.log(process.platform+"-"+process.arch)')"

echo "[build] installing dependencies..."
pnpm install --no-frozen-lockfile --prod=false
echo "[build] install done"

echo "[build] building bridge-ai..."
NODE_OPTIONS='--max-old-space-size=512' pnpm --filter @workspace/bridge-ai run build
echo "[build] bridge-ai done"

echo "[build] building api-server..."
pnpm --filter @workspace/api-server run build
echo "[build] api-server done"

echo "[build] listing outputs..."
ls artifacts/bridge-ai/dist/public/ 2>/dev/null | head -5 || echo "MISSING: bridge-ai dist/public"
ls artifacts/api-server/dist/ 2>/dev/null | head -5 || echo "MISSING: api-server dist"

echo "[build] all done!"
