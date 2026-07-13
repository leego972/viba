#!/usr/bin/env bash
set -e
set -x

echo "[diag] === RENDER BUILD STARTING ==="
echo "[diag] date: $(date -u)"
echo "[diag] pwd: $(pwd)"
echo "[diag] os: $(uname -a)"
echo "[diag] node: $(node -v 2>&1)"
echo "[diag] npm:  $(npm -v 2>&1)"
echo "[diag] pnpm check: $(command -v pnpm 2>&1 || echo 'NOT FOUND')"

export NODE_ENV=production
export NPM_CONFIG_PRODUCTION=false
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export PLAYWRIGHT_BROWSERS_PATH=/dev/null

trap 'echo "[build-error] Script failed at line $LINENO (exit $?)"' ERR

if ! command -v pnpm &>/dev/null; then
  echo "[build] pnpm not in PATH — enabling via corepack..."
  corepack enable pnpm || npm install -g pnpm@10.26.1
fi

echo "[build] node=$(node -v)"
echo "[build] pnpm=$(pnpm --version 2>/dev/null || echo 'unknown')"

# Verify Node version satisfies Vite 7 (^20.19.0 || >=22.12.0)
node -e "
const v = process.version.slice(1).split('.').map(Number);
const [maj, min] = v;
const ok = (maj === 20 && min >= 19) || (maj >= 22 && !(maj === 22 && min < 12)) || maj >= 24;
if (!ok) { console.error('[build-error] Node ' + process.version + ' too old for Vite 7 (need ^20.19.0 || >=22.12.0)'); process.exit(1); }
console.log('[build] node version OK for Vite 7: ' + process.version);
"

echo "[build] installing dependencies..."
pnpm install --frozen-lockfile 2>&1
echo "[build] install done"

echo "[build] building bridge-ai..."
pnpm --filter @workspace/bridge-ai run build 2>&1
echo "[build] bridge-ai done"

echo "[build] building api-server..."
pnpm --filter @workspace/api-server run build 2>&1
echo "[build] api-server done"

echo "[build] verifying output..."
node scripts/verify-render-output.mjs 2>&1
echo "[build] all done!"
