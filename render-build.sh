#!/usr/bin/env bash
set -e

export NODE_ENV=production
export NPM_CONFIG_PRODUCTION=false

# Render sets up pnpm via PNPM_VERSION env var before this script runs.
# Only install manually if pnpm is somehow missing.
if ! command -v pnpm &>/dev/null; then
  echo "[build] pnpm not in PATH — installing via npm..."
  npm install -g pnpm@10.26.1 --quiet
fi

echo "[build] node=$(node -v)"
echo "[build] pnpm=$(pnpm --version 2>/dev/null || echo 'unknown')"
echo "[build] platform=$(node -e 'console.log(process.platform+"-"+process.arch)')"

echo "[build] installing dependencies..."
# --no-frozen-lockfile: lets pnpm pick the correct platform-specific native
# binaries (lightningcss, esbuild, @tailwindcss/oxide) for whatever ABI
# Render's build container uses (glibc vs musl, x64 vs arm64).
pnpm install --no-frozen-lockfile --prod=false
echo "[build] install done"

echo "[build] building bridge-ai..."
# NODE_OPTIONS cap: prevents OOM on memory-constrained build instances.
NODE_OPTIONS='--max-old-space-size=512' pnpm --filter @workspace/bridge-ai run build
echo "[build] bridge-ai done"

echo "[build] building api-server..."
pnpm --filter @workspace/api-server run build
echo "[build] api-server done"

echo "[build] verifying output..."
node scripts/verify-render-output.mjs
echo "[build] all done!"
