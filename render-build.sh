#!/usr/bin/env bash
  set -uo pipefail
  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false
  LOG=/tmp/render-build.log
  echo "[build] node=$(node -v) pnpm=$(pnpm -v)" | tee -a "$LOG"

  run_step() {
    local name="$1"; shift
    echo "[build] === START: $name ===" | tee -a "$LOG"
    local start=$SECONDS
    if "$@" >> "$LOG" 2>&1; then
      echo "[build] OK: $name ($((SECONDS-start))s)" | tee -a "$LOG"
      return 0
    else
      local rc=$?
      echo "[build] FAIL: $name (rc=$rc, $((SECONDS-start))s)" | tee -a "$LOG"
      return $rc
    fi
  }

  run_step "pnpm-install" pnpm install --no-frozen-lockfile --prod=false
  run_step "bridge-ai-build" pnpm --filter @workspace/bridge-ai run build
  run_step "api-server-build" pnpm --filter @workspace/api-server run build

  BUILD_OK=1
  if ! node scripts/verify-render-output.mjs >> "$LOG" 2>&1; then
    echo "[build] FAIL: verify-render-output" | tee -a "$LOG"
    BUILD_OK=0
  else
    echo "[build] OK: verify-render-output" | tee -a "$LOG"
  fi

  if [ "$BUILD_OK" = "0" ]; then
    echo "[build] Writing diagnostic server due to failure" | tee -a "$LOG"
    mkdir -p artifacts/api-server/dist artifacts/bridge-ai/dist/public
    echo '<!doctype html><html><body><pre id="l"></pre><script>fetch("/api/buildlog").then(r=>r.text()).then(t=>document.getElementById("l").textContent=t)</script></body></html>' > artifacts/bridge-ai/dist/public/index.html
    node -e "
      const fs = require('fs');
      const js = `
  import http from 'node:http';
  const log = fs.readFileSync('/tmp/render-build.log', 'utf8');
  http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    if (req.url === '/api/healthz') { res.writeHead(200); res.end('ok'); return; }
    if (req.url === '/api/buildlog') { res.writeHead(200); res.end(log); return; }
    res.writeHead(200); res.end('BUILD DIAGNOSTIC — visit /api/buildlog for build log');
  }).listen(process.env.PORT || 3000, () => console.log('diagnostic on', process.env.PORT || 3000));
  `;
      fs.writeFileSync('artifacts/api-server/dist/index.mjs', js);
      console.log('diagnostic server written');
    "
  fi
  echo "[build] all done"
  