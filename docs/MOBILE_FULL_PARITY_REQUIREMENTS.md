# VIBA Hybrid App Full-Parity Requirements

The Android/iOS app must be a full-parity hybrid version of the web app, not a reduced companion app.

## Product requirement

The mobile app must expose the same authenticated product surface as the web app, using the same React frontend and the same hosted backend/API.

## Required parity matrix

| Web feature | Mobile requirement |
|---|---|
| Landing page | Same product positioning and navigation, adapted to mobile viewport |
| Signup/login/logout | Same auth flow and same server-side checks |
| Dashboard | Same sessions, stats, provider warnings, repo links, and command links |
| New session | Same project/session creation flow |
| Session workspace | Same agent conversation, progress, approvals, stop/reopen/export behavior where implemented |
| Upload/context attachment | Same accepted file/context path as web; mobile file picker must be tested |
| GitHub/repo context | Same connected repo listing/session start path |
| Settings | Same provider settings, account controls, and connection status |
| Billing/pricing | Same billing access, with App Store / Play Store policy review before public release |
| User instructions | Same page, mobile-readable |
| Terms | Same page, mobile-readable |
| Admin maintenance | Same admin-only visibility and backend protection |

## Design requirement

Mobile may add safe-area padding, a mobile top app bar, bottom navigation, keyboard handling, responsive layout rules, and app-store shell configuration.

Mobile must not remove routes, auth gates, admin gates, billing flow, session actions, upload support, provider controls, or existing backend validation.

## Technical requirement

The correct implementation is:

```txt
Existing React/Vite app + existing Express API
                 ↓
Capacitor hybrid shell for Android/iOS
```

Do not fork the product into a separate React Native rewrite unless there is a later explicit decision to rebuild.

## Validation commands

Run from repo root:

```bash
pnpm install
pnpm run typecheck
pnpm --filter @workspace/bridge-ai run build
pnpm --filter @workspace/bridge-ai run mobile:sync
```

Then validate native launch:

```bash
pnpm --filter @workspace/bridge-ai run mobile:open:android
pnpm --filter @workspace/bridge-ai run mobile:open:ios
```

## Manual parity test

Use the same account on web and mobile and verify:

1. Login works on both.
2. Dashboard shows the same sessions.
3. Starting a new session creates the same server-side session.
4. Session workspace shows the same messages/progress.
5. Uploading a file works from mobile file picker.
6. Settings reflect the same connected providers.
7. Billing opens safely.
8. Admin maintenance is visible only to admin account.
9. A normal account cannot access admin routes.
10. Terms and instructions are readable.

## Store policy warning

If the mobile app sells digital credits, subscriptions, or in-app digital functionality, Apple/Google payment policy must be reviewed before public store submission. The code can keep billing parity, but release approval may require platform-compliant payment handling.
