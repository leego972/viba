#!/usr/bin/env bash
  set -euo pipefail
  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false
  echo "[build] node=$(node -v) pnpm=$(pnpm -v)"
  pnpm install --no-frozen-lockfile --prod=false
  echo "[build] install done"

  # Push DB schema (non-blocking)
  echo "[build] pushing DB schema..."
  timeout 60 pnpm --filter @workspace/db run push 2>&1 | tee /tmp/db-push.log || true
  echo "[build] db push done (see log above)"

  pnpm --filter @workspace/bridge-ai run build
  echo "[build] bridge-ai done"
  pnpm --filter @workspace/api-server run build
  echo "[build] api-server done"

  # Test-run the real server for 15s to capture startup errors
  echo "[build] === testing server startup ==="
  STARTUP_LOG=/tmp/server-startup.log
  PORT=19876 timeout 15 node --enable-source-maps artifacts/api-server/dist/index.mjs > "$STARTUP_LOG" 2>&1 || true
  echo "[build] startup test exit (showing output):"
  cat "$STARTUP_LOG"

  # Check if server responded to healthz
  if curl -sf --max-time 5 http://localhost:19876/api/healthz > /dev/null 2>&1; then
    echo "[build] SERVER STARTED SUCCESSFULLY"
    STARTUP_OK=1
  else
    echo "[build] SERVER DID NOT START"
    STARTUP_OK=0
  fi

  node scripts/verify-render-output.mjs

  # Embed diagnostics into the deployed server
  if [ "$STARTUP_OK" = "0" ]; then
    echo "[build] Writing diagnostic server (startup failed)"
    mkdir -p artifacts/bridge-ai/dist/public
    echo '<html><body><h2>Startup Diagnostic</h2><p>Visit <a href="/api/buildlog">/api/buildlog</a></p></body></html>' \
      > artifacts/bridge-ai/dist/public/index.html
    node -e "
      const fs = require('fs');
      const dbLog = fs.existsSync('/tmp/db-push.log') ? fs.readFileSync('/tmp/db-push.log','utf8') : 'n/a';
      const startupLog = fs.existsSync('/tmp/server-startup.log') ? fs.readFileSync('/tmp/server-startup.log','utf8') : 'n/a';
      const out = JSON.stringify('=== DB PUSH ===\n' + dbLog + '\n\n=== SERVER STARTUP ===\n' + startupLog);
      const js = [
        'import http from \'node:http\';',
        'const D = ' + out + ';',
        'http.createServer((req,res) => {',
        '  res.setHeader(\'Content-Type\', \'text/plain\');',
        '  if (req.url === \'/api/healthz\') { res.writeHead(200); res.end(\'ok\'); return; }',
        '  res.writeHead(200); res.end(D);',
        '}).listen(process.env.PORT||3000, ()=>console.log(\'diag on\', process.env.PORT||3000));'
      ].join('\n');
      fs.writeFileSync('artifacts/api-server/dist/index.mjs', js);
      console.log('diagnostic server written');
    "
  fi
  echo "[build] all done"
  