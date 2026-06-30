#!/usr/bin/env bash
set -e

export NODE_ENV=production
export NPM_CONFIG_PRODUCTION=false

echo "[build] ensuring pnpm@10.26.1 is active..."
corepack enable 2>/dev/null || true
corepack prepare pnpm@10.26.1 --activate 2>/dev/null || npm install -g pnpm@10.26.1 --quiet

echo "[build] node=$(node -v)"
echo "[build] pnpm=$(pnpm --version 2>/dev/null || echo 'unknown')"

echo "[build] installing dependencies..."
pnpm install --frozen-lockfile --prod=false
echo "[build] install done"

echo "[build] skipping DB schema push — tables are created by server startup migrations"

echo "[build] building bridge-ai..."
pnpm --filter @workspace/bridge-ai run build
echo "[build] bridge-ai done"

echo "[build] building api-server..."
pnpm --filter @workspace/api-server run build
echo "[build] api-server done"

echo "[build] verifying output..."
node scripts/verify-render-output.mjs
echo "[build] all done!"
