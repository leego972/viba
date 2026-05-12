FROM node:22-slim AS builder
WORKDIR /app

RUN npm install -g pnpm@9 --silent

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY lib/ ./lib/
COPY artifacts/bridge-ai/package.json ./artifacts/bridge-ai/
COPY artifacts/api-server/package.json ./artifacts/api-server/

RUN pnpm install --no-frozen-lockfile

COPY . .

RUN NODE_ENV=production BASE_PATH=/ PORT=8080 pnpm --filter @workspace/bridge-ai run build
RUN pnpm --filter @workspace/api-server run build

FROM node:22-slim
WORKDIR /app

RUN npm install -g pnpm@9 --silent

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY lib/ ./lib/
COPY artifacts/api-server/package.json ./artifacts/api-server/

RUN pnpm install --no-frozen-lockfile --prod

COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /app/artifacts/bridge-ai/dist ./artifacts/bridge-ai/dist

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "artifacts/api-server/dist/index.mjs"]
