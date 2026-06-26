# Deployment checkpoint

Render must deploy the latest `main` commit, not an old failed deploy.

Correct Build Command:

```bash
bash render-build.sh
```

Safe Start Command:

```bash
npm start
```

The old command below is obsolete and must not appear in new Render logs:

```bash
corepack enable && corepack prepare pnpm@11.9.0 --activate
```

Latest deployment marker: 2026-06-27T17:45:00+10:00
