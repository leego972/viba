#!/usr/bin/env bash
set -e

npm install -g pnpm@10.24.0
pnpm install --no-frozen-lockfile
pnpm run build:render
