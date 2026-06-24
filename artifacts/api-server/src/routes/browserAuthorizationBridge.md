# VIBA Browser Authorization Bridge

This document defines the upgraded browser authorization subsystem for Assisted Browser Operator jobs.

## Core rule

The browser job should pause only when a user authorization event is required. Normal navigation, retryable errors, slow pages, missing selectors, API errors, and dashboard search should be handled by retries or fallback logic instead of pausing the job.

## Credit semantics

- `running`: credits are consumed.
- `resuming`: credits are consumed.
- `waiting_*`: credits are paused.
- `completed`, `failed`, `cancelled`, `authorization_expired`: credits are stopped.

## Authorization wait states

- `waiting_for_oauth`
- `waiting_for_2fa`
- `waiting_for_passkey`
- `waiting_for_email_link`
- `waiting_for_captcha`
- `waiting_for_manual_approval`
- `waiting_for_payment_approval`

## Valid pause reasons

- OAuth approval
- 2FA code
- passkey / WebAuthn approval
- email verification link
- human CAPTCHA
- manual approval before destructive action
- payment or billing confirmation
- terms/consent confirmation

## Invalid pause reasons

- normal page load
- navigation uncertainty
- slow network
- missing selector
- retryable browser error
- ordinary dashboard search
- ordinary API retry

## Security rules

- Do not store user passwords.
- Do not expose raw sensitive values in logs or responses.
- Store durable provider credentials only through the encrypted Secure Vault.
- Browser screenshots and evidence must be redacted before storage.
- Destructive actions require explicit user approval.

## Job checkpoint

Each job checkpoint should record:

- provider
- templateId
- current URL
- current step
- last successful action
- next intended action
- completed outputs
- pending outputs
- authorization wait state
- expiry timestamp

## Resume algorithm

1. User authorizes in-app or through the live browser panel.
2. Job moves from `waiting_*` to `resuming`.
3. Browser worker checks session is still alive.
4. Browser worker checks target dashboard is authenticated.
5. Worker resumes from checkpoint.
6. If session expired, job returns to an authorization wait state.

## Timeout defaults

- 2FA: 10 minutes
- OAuth: 15 minutes
- Passkey: 10 minutes
- Email link: 20 minutes
- CAPTCHA: 15 minutes
- Manual approval: 24 hours
- Payment approval: 24 hours
