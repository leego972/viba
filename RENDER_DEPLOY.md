# VIBA Render deployment runbook

## Correct Render service settings

Use these exact commands on the Render web service:

```bash
npm install -g pnpm@10.24.0 && pnpm install --frozen-lockfile && pnpm run build:render
```

```bash
node --enable-source-maps artifacts/api-server/dist/index.mjs
```

Health check path:

```txt
/api/healthz
```

## What the Render build does

`build:render` builds only the production runtime bundles needed by Render:

```txt
artifacts/bridge-ai/dist/public/index.html
artifacts/api-server/dist/index.mjs
```

The full strict TypeScript check remains available separately:

```bash
pnpm run typecheck:full
```

Do not use full typecheck as the Render deployment gate until the production runtime is live and the remaining non-runtime type issues have been cleaned.

## Required environment variables

Render sets `PORT` automatically. Add the following manually in Render.

```txt
NODE_ENV=production
NODE_VERSION=22.13.0
PNPM_VERSION=10.24.0
DATABASE_URL=<Render PostgreSQL external/internal connection string>
SESSION_SECRET=<long random secret if not using render.yaml generateValue>
PUBLIC_ORIGIN=https://viba.onrender.com
VIBA_PUBLIC_URL=https://viba.onrender.com
CORS_ALLOWED_ORIGINS=https://viba.onrender.com,https://viba.guru,https://www.viba.guru
GITHUB_REPOSITORY=leego972/viba
VIBA_SELF_REPO=leego972/viba
VIBA_SELF_BRANCH=main
VIBA_WEEKLY_MAINTENANCE_ENABLED=false
VIBA_MAINTENANCE_EMAILS_ENABLED=false
VIBA_MAINTENANCE_EMAIL_THROTTLE_MINUTES=360
```

Optional admin bootstrap:

```txt
ADMIN_BOOTSTRAP_EMAIL=<owner email>
ADMIN_BOOTSTRAP_PASSWORD=<strong temporary password>
VIBA_ADMIN_EMAIL=<owner email>
VIBA_ADMIN_EMAILS=<owner email>
```

Optional provider keys:

```txt
GITHUB_TOKEN=<fine-grained repo token>
OPENAI_API_KEY=<key>
ANTHROPIC_API_KEY=<key>
GEMINI_API_KEY=<key>
GROQ_API_KEY=<key>
```

## Common failure this patch addresses

If Render uses Corepack and the log shows `verifySignature`, Corepack is failing before pnpm runs. The deploy command now bypasses Corepack and installs pnpm through npm.

If Render runs plain `npm install`, the repo intentionally fails with `Use pnpm instead`. This repo is a pnpm workspace.

The root package pins the package manager, the Node version is pinned, `render.yaml` contains a full Blueprint configuration, and the Render build now avoids blocking deployment on workspace-wide typecheck noise.

## After deployment

1. Open `/api/healthz` and confirm it returns `{ "status": "ok" }`.
2. Open `/` and confirm the frontend loads.
3. Register or log in.
4. Confirm admin access only after admin variables are set.
5. Keep weekly maintenance disabled until the first clean production deploy is verified.
