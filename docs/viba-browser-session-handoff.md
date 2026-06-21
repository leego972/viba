# VIBA Browser Session Handoff

## Purpose

Some services are easier to connect by opening a temporary browser window and letting the user log in manually.

This design lets VIBA support that workflow without silently collecting passwords or bypassing platform security.

## Rule

API tokens and OAuth/device flows are preferred.

Browser session handoff is a fallback for user-owned accounts only.

VIBA must not bypass MFA, CAPTCHA, anti-bot checks, platform access controls, or account security protections.

## Supported use cases

- User opens GitHub or Railway in a temporary VIBA-controlled browser profile.
- User logs in manually.
- VIBA detects that the user is authenticated.
- User explicitly clicks `Connect this session to VIBA`.
- VIBA stores a reusable encrypted browser profile reference or approved session state.
- VIBA uses the browser profile for future supervised actions.

## What VIBA should not do

- Do not scrape or display passwords.
- Do not log raw cookies.
- Do not export session cookies into reports.
- Do not bypass MFA.
- Do not bypass CAPTCHA.
- Do not run destructive actions without approval.
- Do not use browser access for accounts the user does not own or manage.

## Recommended architecture

```txt
1. User clicks Connect with Browser.
2. VIBA creates a short-lived browser handoff record.
3. Desktop/local worker opens a temporary browser profile to the target URL.
4. User logs in manually.
5. Worker checks for an authenticated state using non-secret page indicators.
6. VIBA asks the user for explicit consent to save the browser profile for future use.
7. VIBA stores only an encrypted profile reference/session bundle with expiry metadata.
8. All future actions are logged in viba_activity_logs.
9. User can revoke the browser session from credentials/settings.
```

## Suggested routes

```txt
POST /api/browser-sessions/start
GET  /api/browser-sessions/:id/status
POST /api/browser-sessions/:id/confirm
POST /api/browser-sessions/:id/revoke
GET  /api/browser-sessions
```

## Handoff record fields

```txt
id
user_id
provider
start_url
status
profile_ref
authenticated_at
expires_at
revoked_at
last_used_at
created_at
updated_at
```

## Status values

```txt
created
browser_opened
waiting_for_login
authenticated
confirmed
expired
revoked
failed
```

## Providers

```txt
github
railway
custom
```

## Security requirements

- Store profile/session material encrypted with CREDENTIAL_ENCRYPTION_KEY or MASTER_ENCRYPTION_KEY.
- Never include cookies, tokens, passwords or session headers in logs.
- Use short expiry by default.
- Require explicit user confirmation before saving a browser session.
- Require re-authentication for sensitive actions when the provider asks for it.
- Prefer GitHub/Railway API tokens for non-visual automation.
- Log every action taken through a browser session.

## UX copy

```txt
VIBA will open a temporary browser window.

Log in manually using your own account.

VIBA will not ask for your password, bypass MFA, or store raw login details.

After login, you can approve whether VIBA should remember this browser session for future supervised actions.
```

## Implementation note

For a web-only deployment, this should be implemented by a local desktop worker or signed desktop app because server-side cloud browsers cannot access the user's local logged-in state safely.

For Railway-only cloud deployment, prefer API tokens/OAuth first.
