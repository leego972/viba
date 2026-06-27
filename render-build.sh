#!/usr/bin/env bash
  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false
  LOG=/tmp/render-build.log
  rm -f "$LOG"
  touch "$LOG"

  ts() { date '+%H:%M:%S'; }
  log() { echo "[$(ts)] $*" | tee -a "$LOG"; }

  log "node=$(node -v) pnpm=$(pnpm -v)"

  run_step() {
    local name="$1"; shift
    log "=== START: $name ==="
    local start=$SECONDS
    if "$@" >> "$LOG" 2>&1; then
      log "OK: $name ($(( SECONDS - start ))s)"
      return 0
    else
      local rc=$?
      log "FAIL: $name rc=$rc ($(( SECONDS - start ))s)"
      return $rc
    fi
  }

  INSTALL_OK=0; run_step "pnpm-install" pnpm install --no-frozen-lockfile --prod=false && INSTALL_OK=1
  BRIDGE_OK=0;  run_step "bridge-ai-build" pnpm --filter @workspace/bridge-ai run build && BRIDGE_OK=1
  API_OK=0;     run_step "api-server-build" pnpm --filter @workspace/api-server run build && API_OK=1

  VERIFY_OK=0
  if node scripts/verify-render-output.mjs >> "$LOG" 2>&1; then
    log "OK: verify-render-output"
    VERIFY_OK=1
  else
    log "FAIL: verify-render-output"
  fi

  log "Summary: install=$INSTALL_OK bridge=$BRIDGE_OK api=$API_OK verify=$VERIFY_OK"

  if [ "$VERIFY_OK" = "0" ]; then
    log "Writing diagnostic server"
    mkdir -p artifacts/api-server/dist artifacts/bridge-ai/dist/public
    echo '<!doctype html><html><body><h2>Build Diagnostic</h2><p>Visit <a href="/api/buildlog">/api/buildlog</a></p></body></html>' \
      > artifacts/bridge-ai/dist/public/index.html
    # Embed log content directly into the server so no fs import is needed at runtime
    node -e "
      const fs = require('fs');
      const rawLog = fs.readFileSync('/tmp/render-build.log', 'utf8');
      const embedded = JSON.stringify(rawLog);
      const srv = [
        'import http from \'node:http\';',
        'const LOG = ' + embedded + ';',
        'http.createServer((req, res) => {',
        '  res.setHeader(\'Content-Type\', \'text/plain\');',
        '  if (req.url === \'/api/healthz\') { res.writeHead(200); res.end(\'ok\'); return; }',
        '  res.writeHead(200); res.end(LOG);',
        '}).listen(process.env.PORT || 3000, () => console.log(\'diagnostic on\', process.env.PORT || 3000));'
      ].join('\n');
      fs.writeFileSync('artifacts/api-server/dist/index.mjs', srv);
      console.log('diagnostic server written, log size=' + rawLog.length);
    "
  fi
  log "Build script complete"
  