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

# DIAGNOSTIC: skip bridge-ai build, use a stub index.html
# This isolates whether api-server or bridge-ai is the failing step.
echo "[diag] skipping bridge-ai build — using stub"
mkdir -p artifacts/bridge-ai/dist/public
printf '<!DOCTYPE html><html><body>diagnostic</body></html>' \
  > artifacts/bridge-ai/dist/public/index.html

echo "[build] building api-server..."
pnpm --filter @workspace/api-server run build
echo "[build] api-server done"

echo "[build] verifying output..."
node scripts/verify-render-output.mjs
echo "[build] all done!"
