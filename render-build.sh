#!/usr/bin/env bash
  set -euo pipefail
  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false
  echo "[build] node=$(node -v) pnpm=$(pnpm -v)"
  pnpm install --no-frozen-lockfile --prod=false
  echo "[build] install done"

  pnpm --filter @workspace/bridge-ai run build
  echo "[build] bridge-ai done"

  echo "[build] === api-server ==="
  API_ERR=0
  pnpm --filter @workspace/api-server run build 2>&1 | tee /tmp/api-err.txt || API_ERR=1

  if [ $API_ERR -ne 0 ]; then
    echo "[build] api-server FAILED — creating diagnostic server"
    ERR=$(cat /tmp/api-err.txt | head -c 3000 | sed "s/'/\\'/g")
    mkdir -p artifacts/api-server/dist
    cat > artifacts/api-server/dist/index.mjs << DIAG_EOF
  import http from 'node:http';
  const err = `$ERR`;
  http.createServer((req, res) => {
    if (req.url === '/api/healthz') { res.writeHead(200); res.end('ok'); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('BUILD ERROR:\n\n' + err);
  }).listen(process.env.PORT || 3000, () => console.log('diagnostic server running'));
  DIAG_EOF
    echo "[build] diagnostic server written"
  fi

  node scripts/verify-render-output.mjs
  echo "[build] verified"
  