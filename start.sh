#!/bin/sh
GW_PORT="${PORT:-8080}"
APP_PORT="$((GW_PORT + 1))"
echo "[start] Gateway=:$GW_PORT  App=:$APP_PORT"

echo "[start] Running DB push..."
pnpm --filter @workspace/db run push 2>&1
if [ $? -ne 0 ]; then
  echo "[start] DB push failed — aborting"
  exit 1
fi
echo "[start] DB push complete"

PORT="$APP_PORT" node artifacts/api-server/dist/index.mjs > /tmp/app.log 2>&1 &
echo "[start] Express started on :$APP_PORT"

PORT="$GW_PORT" exec node gateway.mjs