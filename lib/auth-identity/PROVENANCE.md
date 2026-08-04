# Extraction provenance

## Audited source

- Repository: `leego972/viba`
- File: `artifacts/api-server/src/routes/auth.ts`
- Source revision inspected: `397072b1ede3fa82e2e5af18268d73342f04a1bb`

## Retained concepts

- session regeneration after authentication to prevent session fixation;
- generic credential failures that do not disclose whether an account exists;
- email normalization and verified-email gating;
- OAuth state nonce generation and verification;
- bounded, local-only return paths to prevent open redirects;
- timing-safe comparison for security tokens.

## Removed or replaced

- Express request/response coupling;
- direct PostgreSQL queries and application user schema;
- bcrypt implementation choice;
- Google and GitHub provider HTTP calls;
- environment-variable reads;
- billing and welcome-email side effects;
- product-specific cookie names and messages;
- fire-and-forget error suppression.

The module exposes provider-neutral primitives. Applications must inject password hashing, persistence, OAuth provider clients, delivery services and authorization policy.
