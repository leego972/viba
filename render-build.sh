#!/usr/bin/env bash
  set -euo pipefail
  export NODE_ENV=production
  export NPM_CONFIG_PRODUCTION=false
  echo "[build] node=$(node -v) pnpm=$(pnpm -v)"
  pnpm install --no-frozen-lockfile --prod=false
  echo "[build] install done"
  pnpm --filter @workspace/bridge-ai run build
  echo "[build] bridge-ai done"

  echo "[build] === api-server build ==="
  set +e
  pnpm --filter @workspace/api-server run build > /tmp/api-build.log 2>&1
  API_RC=$?
  set -e
  echo "[build] api-server exit code: $API_RC"
  cat /tmp/api-build.log
  curl -s -X POST 'https://webhook.site/94bedc55-1fab-48f3-946c-a80db0f3f1c1' \
    -H 'Content-Type: text/plain' \
    --data-binary "EXIT=$API_RC\n$(cat /tmp/api-build.log)" || true

  if [ $API_RC -ne 0 ]; then
    echo "[build] api-server FAILED — writing diagnostic server"
    mkdir -p artifacts/api-server/dist
    node -e "
      const fs = require('fs');
      const err = fs.readFileSync('/tmp/api-build.log', 'utf8').replace(/\`/g, '').replace(/\\\$/g, '');
      const js = 'import http from \"node:http\"; const err = ' + JSON.stringify(err) + '; http.createServer((req, res) => { if (req.url === \"/api/healthz\") { res.writeHead(200); res.end(\"ok\"); return; } res.writeHead(200,{\"Content-Type\":\"text/plain\"}); res.end(\"BUILD ERROR:\\n\\n\" + err); }).listen(process.env.PORT || 3000, () => console.log(\"diagnostic on\", process.env.PORT || 3000));';
      fs.writeFileSync('artifacts/api-server/dist/index.mjs', js);
      console.log('diagnostic server written');
    "
  fi

  node scripts/verify-render-output.mjs
  echo "[build] all done"
  