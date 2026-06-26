# Deployment checkpoint

Latest GitHub state is ready for Render, but the Render deploy log showed the service still using an old dashboard-level build command:

```bash
corepack enable && corepack prepare pnpm@11.9.0 --activate ...
```

That command fails in Render Corepack with a signature/keyid error.

Use this service Build Command in Render dashboard:

```bash
npm install -g pnpm@10.24.0 && pnpm install --no-frozen-lockfile && pnpm run build:render
```

Use this Start Command:

```bash
node --enable-source-maps artifacts/api-server/dist/index.mjs
```

After changing the dashboard setting, run:

```txt
Manual Deploy -> Clear build cache & deploy
```

Date: 2026-06-27
