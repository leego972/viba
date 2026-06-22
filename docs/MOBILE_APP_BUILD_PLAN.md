# VIBA Mobile App Build Plan — Android + iOS

This repo remains one codebase. The mobile app is produced by wrapping the existing React/Vite frontend with Capacitor, then pointing it at the production API.

## Goal

Create one VIBA app that can ship to Android, iOS, and mobile web/PWA.

## Current repo basis

- Frontend: `artifacts/bridge-ai`
- Backend: `artifacts/api-server`
- Frontend build output: `artifacts/bridge-ai/dist/public`
- Mobile wrapper config: `artifacts/bridge-ai/capacitor.config.ts`

## Mobile architecture

```txt
React/Vite frontend
        ↓ pnpm build
static bundle in dist/public
        ↓ pnpm mobile:sync
Capacitor native shells
        ↓
android/ and ios/ native projects
```

The backend should stay hosted on Railway or another HTTPS host. Do not put server-only values inside the mobile app.

## Required mobile design rules

1. One app codebase only.
2. Android and iOS must use the same React UI.
3. API calls must use HTTPS production origin.
4. Mobile UI must respect safe areas, keyboard resizing, tap targets, and narrow screens.
5. Admin/self-repair controls must stay gated server-side.
6. Native projects must be generated after package install; do not hand-edit generated native files unless required for store release.

## Setup commands

Run from repo root:

```bash
pnpm install
pnpm --filter @workspace/bridge-ai run mobile:prepare
```

Create native projects once:

```bash
pnpm --filter @workspace/bridge-ai exec cap add android
pnpm --filter @workspace/bridge-ai exec cap add ios
```

After any frontend change:

```bash
pnpm --filter @workspace/bridge-ai run mobile:sync
```

Open native projects:

```bash
pnpm --filter @workspace/bridge-ai run mobile:open:android
pnpm --filter @workspace/bridge-ai run mobile:open:ios
```

## Environment

Set the production domain before building mobile:

```bash
VIBA_MOBILE_API_URL=https://viba.guru
PUBLIC_ORIGIN=https://viba.guru
VITE_VIBA_ADMIN_EMAILS=leego972@gmail.com
```

## Store-readiness checklist

### App shell

- [ ] Android project created with `cap add android`
- [ ] iOS project created with `cap add ios`
- [ ] App opens on Android emulator
- [ ] App opens on iOS simulator
- [ ] Splash screen does not hang
- [ ] Status bar is readable
- [ ] Keyboard does not cover chat composer
- [ ] Back gesture/navigation works

### Core screens

- [ ] Landing page usable on iPhone viewport
- [ ] Login usable on iPhone viewport
- [ ] Signup usable on iPhone viewport
- [ ] Dashboard usable on narrow Android viewport
- [ ] New session form usable
- [ ] Session workspace stable and not jumpy
- [ ] Chat composer remains visible while typing
- [ ] Settings usable
- [ ] Billing opens safely
- [ ] Terms and user instructions readable

### Backend/security

- [ ] API origin is HTTPS only
- [ ] No server-only credentials bundled into frontend files
- [ ] Admin pages still reject non-admin users
- [ ] User cannot access another user's sessions
- [ ] Source-repo/self-repair routes remain admin/internal only

### Release assets

- [ ] Replace placeholder icon mapping with dedicated 1024x1024 app icon
- [ ] Add iOS privacy manifest if native plugins require it
- [ ] Add Google Play data safety answers
- [ ] Add App Store privacy answers
- [ ] Add support URL, privacy URL, terms URL
- [ ] Create screenshots for 6.7-inch iPhone and common Android phone sizes

## Builder instruction

```txt
Work only on branch mobile-capacitor-redesign. Convert VIBA into a mobile-ready Capacitor app while preserving the existing React/Vite frontend and Express backend. Do not rewrite the backend. Do not expose server-only values in the client. Generate Android and iOS native projects only after pnpm install and frontend build pass. Keep signing credentials outside the repo. Validate pnpm run typecheck, pnpm --filter @workspace/bridge-ai run build, pnpm --filter @workspace/bridge-ai run mobile:sync, Android emulator launch, and iOS simulator launch. Commit changes in small checkpoints and report exact commands/results.
```
