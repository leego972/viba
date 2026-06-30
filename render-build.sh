#!/usr/bin/env bash
# DIAGNOSTIC MODE: capture all step outputs, always exit 0, serve diagnostics

export NODE_ENV=production
export NPM_CONFIG_PRODUCTION=false

if ! command -v pnpm &>/dev/null; then
  echo "[build] pnpm not in PATH — installing via npm..."
  npm install -g pnpm@10.26.1 --quiet
fi

NODE_VER="$(node -v)"
PNPM_VER="$(pnpm --version 2>/dev/null || echo 'unknown')"
PLATFORM="$(node -e 'process.stdout.write(process.platform+"-"+process.arch)')"
echo "[build] node=$NODE_VER pnpm=$PNPM_VER platform=$PLATFORM"

echo "[build] installing dependencies..."
INSTALL_EXIT=0
pnpm install --no-frozen-lockfile --prod=false 2>&1 | tee /tmp/install.log || INSTALL_EXIT=$?
echo "[diag] install exit=$INSTALL_EXIT"

echo "[build] building bridge-ai..."
BRIDGE_EXIT=0
NODE_OPTIONS='--max-old-space-size=512' pnpm --filter @workspace/bridge-ai run build \
  2>&1 | tee /tmp/bridge.log || BRIDGE_EXIT=$?
echo "[diag] bridge-ai exit=$BRIDGE_EXIT"

echo "[build] building api-server..."
API_EXIT=0
pnpm --filter @workspace/api-server run build 2>&1 | tee /tmp/api.log || API_EXIT=$?
echo "[diag] api-server exit=$API_EXIT"

# Write diagnostic JSON so the server can expose it
mkdir -p artifacts/api-server/dist
INSTALL_TAIL="$(tail -30 /tmp/install.log 2>/dev/null | base64 -w0 || true)"
BRIDGE_TAIL="$(tail -30 /tmp/bridge.log 2>/dev/null | base64 -w0 || true)"
API_TAIL="$(tail -30 /tmp/api.log 2>/dev/null | base64 -w0 || true)"

cat > artifacts/api-server/dist/diag.json << DIAGEOF
{
  "node": "$NODE_VER",
  "pnpm": "$PNPM_VER",
  "platform": "$PLATFORM",
  "install_exit": $INSTALL_EXIT,
  "bridge_exit": $BRIDGE_EXIT,
  "api_exit": $API_EXIT,
  "install_tail_b64": "$INSTALL_TAIL",
  "bridge_tail_b64": "$BRIDGE_TAIL",
  "api_tail_b64": "$API_TAIL"
}
DIAGEOF

# If real server wasn't built, create a minimal diagnostic HTTP server
if [ ! -f "artifacts/api-server/dist/index.mjs" ]; then
  echo "[diag] real api-server build failed — creating diagnostic server"
  cat > artifacts/api-server/dist/index.mjs << 'ENDSERVER'
import http from 'node:http';
import { readFileSync } from 'node:fs';

const port = process.env.PORT ?? '5000';
const diag = JSON.parse(readFileSync(new URL('./diag.json', import.meta.url)));

const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify({
    diagnostic: true,
    ...diag,
    install_tail: Buffer.from(diag.install_tail_b64 ?? '', 'base64').toString(),
    bridge_tail: Buffer.from(diag.bridge_tail_b64 ?? '', 'base64').toString(),
    api_tail: Buffer.from(diag.api_tail_b64 ?? '', 'base64').toString(),
  }, null, 2));
});
server.listen(Number(port), () =>
  console.log(`[diagnostic] server on port ${port}`)
);
ENDSERVER
fi

echo "[build] done (diagnostic mode — always exit 0)"
exit 0
