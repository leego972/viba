# VIBA — Bridge AI Multi-Agent Orchestration Platform

## Current status

VIBA is a multi-agent AI orchestration web application. The product goal is to let a user submit a complex task, attach project context, and have multiple AI agents coordinate work in one structured session. Agents should be able to communicate with the user and with each other, divide work by strengths, ask clarifying questions, produce visible progress, and help the user complete software, research, planning, repair, audit, or build workflows.

This repository has been actively patched for backend safety, admin-only self-maintenance, UI presentation, legal pages, and deployment-readiness. The app is not yet verified as production-ready because the final Railway/Replit build, typecheck, auth flow, billing flow, and full browser run still need to be tested in the real deployment environment.

Do not claim production readiness until the verification checklist near the bottom of this README is completed.

---

## Product summary

VIBA is intended to be a professional AI control room.

Users should be able to:

- create a project session with a clear goal;
- upload files, logs, screenshots, documents, zip files, or project notes;
- connect project repository context;
- watch agents communicate and produce step-by-step work;
- run the next workflow step or a full workflow;
- approve or reject sensitive actions;
- export session transcripts;
- fork or continue sessions;
- manage settings, billing, and connected AI/provider credentials.

Administrators should be able to:

- access the maintenance dashboard;
- trigger VIBA self-maintenance manually;
- review maintenance events;
- review pull requests/checkpoints created by self-repair;
- merge only after sandbox verification and admin confirmation;
- keep VIBA source-repository controls separate from normal user project controls.

---

## High-level architecture

```txt
repository root
├── artifacts/
│   ├── api-server/          Express API server, auth, sessions, AI orchestration, maintenance routes
│   └── bridge-ai/           React/Vite frontend
├── lib/
│   ├── api-spec/            API spec source
│   ├── api-client-react/    generated frontend hooks
│   ├── api-zod/             generated validation schemas
│   └── db/                  database schema and migrations
├── scripts/                 utility scripts
├── pnpm-workspace.yaml      workspace configuration
└── README.md                this handoff file
```

The main runtime pieces are:

- `@workspace/api-server`: backend API, session orchestration, auth, maintenance, billing, and server-side production hosting.
- `@workspace/bridge-ai`: frontend application.
- `@workspace/db`: database schema and connection layer.
- `@workspace/api-client-react`: generated React Query client hooks.

---

## What was built or patched in this ChatGPT pass

### 1. Admin-only VIBA source-repo protection

A self-repo guard was added so VIBA source-repair/self-audit operations are restricted to the configured VIBA repository.

Relevant concepts:

```txt
VIBA_SELF_REPO
GITHUB_REPOSITORY
fallback: leego972/bridge-ai
```

Normal users should not be able to tell VIBA to modify, repair, checkpoint, create PRs for, or merge changes into the VIBA source repo.

Normal users should only control their own sessions, uploads, project sandbox, and connected project repositories.

### 2. Self-repair and self-audit middleware hardening

Backend middleware was patched so:

- `/api/self-repair/*` requires admin access or the internal maintenance token;
- `/api/self-audit/*` requires admin access;
- self-repo operations are restricted to the configured VIBA source repo;
- scheduled maintenance can call self-repair only through the internal maintenance token.

### 3. Weekly maintenance scheduler hardening

Maintenance scheduler changes:

- added scheduled-run idempotency guard for the same Sunday window;
- added `PORT` fallback to avoid `127.0.0.1:undefined` self-calls;
- records notification status when email is disabled, throttled, or failed;
- preserves manual/scheduled distinction.

Important environment toggle:

```txt
VIBA_WEEKLY_MAINTENANCE_ENABLED=false
```

Keep this disabled until build and self-repair are verified.

### 4. Maintenance email throttling

Maintenance notification sending was changed so emails are not sent unless explicitly enabled.

Important environment variables:

```txt
VIBA_MAINTENANCE_EMAILS_ENABLED=false
VIBA_MAINTENANCE_EMAIL_THROTTLE_MINUTES=360
```

Default behavior: maintenance email notifications are disabled unless `VIBA_MAINTENANCE_EMAILS_ENABLED=true`.

This does not affect Railway platform emails. Railway failed-deploy emails are controlled by Railway deploy settings, not VIBA code.

### 5. Admin maintenance UI

The admin maintenance dashboard was redesigned as a proper control panel.

Main intent:

- show current update status;
- show safety gates;
- show PR/checkpoint/repair state;
- allow admin to run maintenance manually;
- allow admin merge only when merge-ready;
- make source-repo control visually distinct from user project sandbox control.

Relevant page:

```txt
artifacts/bridge-ai/src/pages/admin-maintenance.tsx
```

### 6. Landing page cleanup

The landing page was simplified to a clean, off-white, clinical/professional style.

Current landing page includes:

- VIBA logo from `/viba-logo.png`;
- clear headline;
- Start Orchestrating button;
- User Instructions button;
- simple feature explanation;
- black footer strip through global/footer component.

Relevant file:

```txt
artifacts/bridge-ai/src/pages/home.tsx
```

### 7. User Instructions page

A new user instructions page was added.

Route:

```txt
/user-instructions
```

Purpose:

- explain how users should create a session;
- explain uploading context;
- explain project sandbox use;
- explain agent collaboration;
- explain approval/rejection;
- explain export/fork behavior.

Relevant file:

```txt
artifacts/bridge-ai/src/pages/user-instructions.tsx
```

### 8. Terms and Conditions page

A VIBA-specific terms page was added.

Route:

```txt
/terms
```

Purpose:

- describe platform purpose;
- clarify AI-output responsibility;
- clarify user content ownership and processing rights;
- clarify project sandbox authority;
- clarify admin-only VIBA source controls;
- cover billing, third-party services, availability, disclaimers, liability, indemnity, updates, and contact.

Relevant file:

```txt
artifacts/bridge-ai/src/pages/terms.tsx
```

Important: the terms are a strong starting point but should still be legally reviewed before launch.

### 9. Black Leego footer strip

A black footer strip was added.

Footer includes:

- `/leego-logo.png`;
- Powered by Leego text;
- company email area;
- Terms and Conditions link;
- User Instructions link;
- copyright.

Relevant files:

```txt
artifacts/bridge-ai/src/components/VibaFooterFinal.tsx
artifacts/bridge-ai/src/components/VibaFooter.tsx
```

`VibaFooter.tsx` now re-exports the final footer component so older imports stay safe.

Current footer email is built as:

```ts
const companyEmail = ["support", "viba.guru"].join("@");
```

If this is not the final company email, replace it in:

```txt
artifacts/bridge-ai/src/components/VibaFooterFinal.tsx
```

### 10. Session workspace build-risk rollback

A new clinical session workspace was attempted, but it was removed from the build path because it introduced unnecessary TypeScript/build risk before Railway was stable.

Current route uses the earlier stable page:

```txt
artifacts/bridge-ai/src/pages/session-workspace.tsx
```

The removed risky file was:

```txt
artifacts/bridge-ai/src/pages/session-workspace-clinical.tsx
```

This was intentionally removed to reduce Railway build failures.

### 11. Chat composer upgrade

A cleaner attachment/chat composer was added.

Relevant file:

```txt
artifacts/bridge-ai/src/components/session/AttachmentComposer.tsx
```

It supports:

- upload button;
- file chips;
- text input;
- send button;
- stop button when running;
- Enter to send and Shift+Enter for new line.

Important: confirm this component is actually used by the stable session workspace. If the stable session page does not import it, it is available for future integration but not active.

---

## What still needs to be built or improved

### 1. Build verification

This is the highest priority.

Run:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
```

Do not continue feature work until these pass.

### 2. Railway deploy verification

Railway should be paused or auto-deploy disabled while fixing build failures. Re-enable only after local/Replit build passes.

Verify:

- correct root directory;
- correct build command;
- correct start command;
- correct Node/pnpm versions;
- required env vars exist;
- frontend dist is served correctly by API server in production.

### 3. Session ownership middleware

Still needs verification and possibly patching.

These routes must only work for the session owner or admin:

```txt
POST /api/sessions/:id/reopen
POST /api/sessions/:id/reject-approval
POST /api/sessions/:id/safety-vote
```

Expected behavior:

- owner can act on own session;
- admin can act when appropriate;
- other users receive `403`;
- unauthenticated users receive `401`.

### 4. User project sandbox boundary

Need end-to-end verification that normal users can only control:

- their own session;
- their own uploads;
- their own connected project repository;
- their own sandbox operations.

Normal users must not be able to control:

- VIBA source repo;
- maintenance routes;
- self-repair routes;
- self-audit routes;
- checkpoint/merge routes;
- admin dashboard.

### 5. Old self-audit merge route audit

Search for any older route such as:

```txt
self-audit/request-merge
request-merge
merge-current-update
checkpoint
```

Only one merge path should be allowed:

- admin-only;
- confirmation required;
- sandbox verification immediately before merge;
- checkpoint before merge;
- no merge if verification fails.

### 6. Dashboard cleanup

The dashboard should still be cleaned into a simple command center.

Recommended visible items:

- Start New Session;
- Resume Recent Session;
- User Instructions;
- Billing;
- Settings;
- Workspace/project context;
- Admin Maintenance only if logged-in user is admin.

Avoid clutter.

### 7. Settings cleanup

Settings should clearly show:

- connected AI provider keys;
- Groq default status;
- GitHub connection;
- Railway connection if supported;
- billing status;
- account/security controls.

### 8. Mobile verification

Must test on iPhone/Safari-style viewport:

- landing page;
- dashboard;
- session workspace;
- chatbox;
- footer;
- terms page;
- user instructions page;
- login/signup flow.

### 9. Legal review

Terms and Conditions were drafted for product fit but are not lawyer-reviewed.

Before launch:

- confirm company name/entity;
- confirm support/legal email;
- confirm jurisdiction;
- confirm privacy policy;
- confirm refund policy;
- confirm billing/subscription rules;
- confirm acceptable-use policy.

### 10. Billing verification

Stripe or billing implementation must be verified through test mode.

Test:

- subscribe;
- payment success;
- failed payment;
- billing portal;
- credit or usage accounting;
- cancellation;
- expired subscription behavior;
- access-control after cancellation.

### 11. Email verification

Separate two kinds of email:

1. Railway platform deploy-failure emails.
2. VIBA application emails.

Railway emails are controlled in Railway.

VIBA maintenance emails are controlled by:

```txt
VIBA_MAINTENANCE_EMAILS_ENABLED
VIBA_MAINTENANCE_EMAIL_THROTTLE_MINUTES
VIBA_EMAIL_HOST
VIBA_EMAIL_PORT
VIBA_EMAIL_SECURE
VIBA_EMAIL_USER
VIBA_EMAIL_PASSWORD
VIBA_EMAIL_FROM
```

Keep maintenance emails disabled until the maintenance flow is verified.

### 12. Leego logo asset verification

Footer expects:

```txt
artifacts/bridge-ai/public/leego-logo.png
```

If this file does not exist, copy it from the Virelle project public assets or add the correct Leego logo file.

---

## Environment variables

### Required

```txt
NODE_ENV=production
DATABASE_URL=<postgres connection string>
SESSION_SECRET=<long random secret>
```

### Public origin and CORS

Use the final production domain.

If the final domain is `https://www.viba.guru`, use:

```txt
PUBLIC_ORIGIN=https://www.viba.guru
VIBA_PUBLIC_URL=https://www.viba.guru
CORS_ALLOWED_ORIGINS=https://www.viba.guru,https://viba.guru
```

If the final domain is root-only, use:

```txt
PUBLIC_ORIGIN=https://viba.guru
VIBA_PUBLIC_URL=https://viba.guru
CORS_ALLOWED_ORIGINS=https://viba.guru
```

### Admin access

```txt
VIBA_ADMIN_EMAIL=<admin email>
VIBA_ADMIN_EMAILS=<comma separated admin emails>
```

### VIBA source repo controls

```txt
GITHUB_REPOSITORY=leego972/bridge-ai
VIBA_SELF_REPO=leego972/bridge-ai
VIBA_SELF_BRANCH=main
GITHUB_TOKEN=<fine-grained token with required repo permissions>
```

### Maintenance controls

Keep these disabled until verified:

```txt
VIBA_WEEKLY_MAINTENANCE_ENABLED=false
VIBA_MAINTENANCE_EMAILS_ENABLED=false
```

When verified:

```txt
VIBA_WEEKLY_MAINTENANCE_ENABLED=true
VIBA_INTERNAL_MAINTENANCE_TOKEN=<long random token>
VIBA_MAINTENANCE_EMAILS_ENABLED=true
VIBA_MAINTENANCE_EMAIL_THROTTLE_MINUTES=360
```

### Email transport

Only set these if VIBA app emails are required:

```txt
VIBA_EMAIL_HOST=smtp.gmail.com
VIBA_EMAIL_PORT=587
VIBA_EMAIL_SECURE=false
VIBA_EMAIL_USER=<mailbox email>
VIBA_EMAIL_PASSWORD=<app password or SMTP password>
VIBA_EMAIL_FROM=VIBA Maintenance <mailbox email>
```

### AI providers

Provider keys may be stored by settings/vault depending on the existing code path. Confirm current behavior before launch.

Possible keys:

```txt
OPENAI_API_KEY
ANTHROPIC_API_KEY
GEMINI_API_KEY
PERPLEXITY_API_KEY
REPLIT_API_KEY
MANUS_API_KEY
GROQ_API_KEY
GROQ_MODEL=llama-3.3-70b-versatile
```

---

## Railway deployment guidance

While build is failing:

1. Pause Railway auto-deploy.
2. Stop pushing feature commits.
3. Run typecheck and build in Replit/local.
4. Fix the first real error first.
5. Only re-enable Railway auto-deploy after build passes.

Recommended commands:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/api-server run start
```

If Railway keeps emailing failed deploys, that is a Railway notification setting or repeated failed auto-deploy loop. It is not fixed by VIBA maintenance-email throttling.

---

## Verification checklist before launch

### Build

- [ ] `pnpm install --frozen-lockfile` passes
- [ ] `pnpm run typecheck` passes
- [ ] `pnpm run build` passes
- [ ] API server starts in production mode
- [ ] Frontend static files are served correctly

### Auth

- [ ] signup works
- [ ] login works
- [ ] logout works
- [ ] password reset works if enabled
- [ ] non-admin cannot access `/admin`
- [ ] admin can access `/admin/maintenance`

### Session workflow

- [ ] create session
- [ ] send message
- [ ] upload file
- [ ] run next step
- [ ] run full workflow
- [ ] stop session
- [ ] reopen session
- [ ] answer agent question
- [ ] approve action
- [ ] reject action
- [ ] export transcript

### Security boundaries

- [ ] user cannot access another user's session
- [ ] user cannot operate VIBA self-repair
- [ ] user cannot operate VIBA self-audit
- [ ] user cannot create VIBA source PRs
- [ ] user cannot checkpoint or merge VIBA source repo
- [ ] admin-only routes reject normal users

### Maintenance

- [ ] weekly maintenance disabled during testing
- [ ] manual maintenance requires admin
- [ ] internal token works only for scheduled/internal call
- [ ] self-repair creates PR only
- [ ] merge requires admin confirmation
- [ ] sandbox verification runs before merge
- [ ] checkpoint is created before merge
- [ ] no auto-merge occurs

### UI

- [ ] landing page loads
- [ ] VIBA logo loads
- [ ] Leego logo loads
- [ ] User Instructions page loads
- [ ] Terms page loads
- [ ] footer appears correctly
- [ ] no duplicate footer on `/terms`
- [ ] mobile layout is usable
- [ ] dashboard is not cluttered
- [ ] session workspace is stable and not jumpy

### Billing

- [ ] pricing page works
- [ ] checkout starts
- [ ] payment success route works
- [ ] subscription state updates
- [ ] billing page works
- [ ] cancelled subscription loses paid access if required

### Deployment

- [ ] Railway build passes
- [ ] Railway start command works
- [ ] custom domain works
- [ ] CORS origin is correct
- [ ] HTTPS works
- [ ] environment variables are set
- [ ] no secrets are committed

---

## Known risks and notes

1. The previous clinical session workspace was removed to protect build stability. Rebuild it later after the current app builds cleanly.
2. The old stable session workspace is still active. It may not yet match the final desired clean ChatGPT-grade UI.
3. The new `AttachmentComposer` may not be wired into the active session workspace yet. Confirm before relying on it.
4. The footer email currently uses `support@viba.guru`. Replace it if the final company email is different.
5. Terms page currently imports the legacy footer path, which now re-exports the final footer. Check for duplicate footer display because the app also renders a global footer.
6. Railway failed-deploy emails will continue until Railway auto-deploy is paused or build passes.
7. Maintenance emails are disabled by default after the latest patch, but Railway emails are outside application control.

---

## Recommended next build order

1. Pause Railway auto-deploy.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm run typecheck`.
4. Fix first real TypeScript error.
5. Run `pnpm run build`.
6. Fix first real build error.
7. Verify API server starts.
8. Re-enable Railway deployment.
9. Verify landing, login, dashboard, session, terms, instructions, admin.
10. Only then continue UI redesign.

---

## Handoff summary

The project now has stronger admin/source-repo safety, maintenance throttling, a cleaner landing page, user instructions, terms, and footer/legal groundwork. The safest active session workspace is restored to the previous stable file to reduce build risk. The next engineer or Replit agent should focus on build verification and security-boundary verification before adding any new features.
