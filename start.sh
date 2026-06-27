#!/bin/sh
  GW_PORT="${PORT:-8080}"
  APP_PORT="$((GW_PORT + 1))"
  echo "[start] Gateway=:$GW_PORT  App=:$APP_PORT"

  echo "[start] Running DB push (non-fatal)..."
  pnpm --filter @workspace/db run push 2>&1 || echo "[start] DB push exited non-zero — continuing (schema managed by startup migrations)"
  echo "[start] DB push step complete"

  PORT="$APP_PORT" node artifacts/api-server/dist/index.mjs > /tmp/app.log 2>&1 &
  echo "[start] Express started on :$APP_PORT"

  PORT="$GW_PORT" exec node gateway.mjs
  