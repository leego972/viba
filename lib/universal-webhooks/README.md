# Universal Webhook Framework

Provider-neutral webhook primitives for Viba modules and customer applications.

## Included

- HMAC-SHA256 signing over `timestamp.body`.
- Constant-time signature comparison.
- Configurable timestamp tolerance and replay rejection.
- Current and previous secrets for rotation windows.
- Event subscriptions with wildcard support.
- Idempotent inbound event acceptance.
- Exponential delivery retry scheduling.
- Dead-letter state and explicit replay.
- PostgreSQL endpoint, delivery, attempt, and inbound-event schema.

## Integration requirements

Production adapters must encrypt endpoint secrets before persistence, send only to HTTPS endpoints, cap response-body logging, apply request timeouts, and execute deliveries from a background worker. The package deliberately does not perform network requests itself; callers inject their HTTP transport and persist state through `WebhookStore`.

## Verification

```sh
pnpm --filter @viba/universal-webhooks typecheck
pnpm --filter @viba/universal-webhooks build
pnpm --filter @viba/universal-webhooks test
```

The tests import `dist/index.js`, so they exercise the JavaScript shipped in the bucket package rather than a TypeScript-only path.
