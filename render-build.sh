#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV=production
export NPM_CONFIG_PRODUCTION=false
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export PLAYWRIGHT_BROWSERS_PATH=/dev/null
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=384}"

trap 'echo "[build-error] Script failed at line $LINENO (exit $?)"' ERR

if ! command -v pnpm &>/dev/null; then
  echo "[build] pnpm not in PATH — enabling via corepack..."
  corepack enable pnpm || npm install -g pnpm@10.26.1
fi

echo "[build] node=$(node -v)"
echo "[build] pnpm=$(pnpm --version 2>/dev/null || echo 'unknown')"
echo "[build] commit=${RENDER_GIT_COMMIT:-unknown}"

node -e "
const v = process.version.slice(1).split('.').map(Number);
const [maj, min] = v;
const ok = (maj === 20 && min >= 19) || (maj >= 22 && !(maj === 22 && min < 12)) || maj >= 24;
if (!ok) { console.error('[build-error] Node ' + process.version + ' too old for Vite 7 (need ^20.19.0 || >=22.12.0)'); process.exit(1); }
console.log('[build] node version OK for Vite 7: ' + process.version);
"

echo "[build] installing dependencies..."
pnpm install --no-frozen-lockfile --prod=false 2>&1
echo "[build] install done"

# Always rebuild the production frontend from current source. The previous script
# skipped this step and served the stale pre-committed dist directory, so React
# source changes never reached viba.guru even after successful Render deploys.
echo "[build] removing stale bridge-ai output..."
rm -rf artifacts/bridge-ai/dist

echo "[build] building current bridge-ai frontend..."
pnpm --filter @workspace/bridge-ai run build 2>&1
echo "[build] bridge-ai frontend done"

echo "[build] building api-server..."
pnpm --filter @workspace/api-server run build 2>&1
echo "[build] api-server done"

echo "[build] verifying output..."
node scripts/verify-render-output.mjs 2>&1

grep -R "Know what is broken" artifacts/bridge-ai/dist/public >/dev/null || {
  echo "[build-error] Current concise homepage was not found in production assets"
  exit 1
}

test -f artifacts/bridge-ai/dist/public/deploy-version.txt || {
  echo "[build-error] Deployment fingerprint missing from production assets"
  exit 1
}

echo "[build] all done!"
