# Provenance

This module is an audited extraction from existing Viba code rather than a greenfield rewrite.

## Reviewed source

- `artifacts/api-server/src/lib/emailNotify.ts`

## Reused concepts

- HTML escaping before interpolating values into email markup.
- Provider-independent message construction.
- Explicit delivery result reporting.
- Graceful handling of unavailable delivery providers.

## Removed project-specific assumptions

- Spike-alert-specific payloads and copy.
- Direct `nodemailer` construction inside domain logic.
- Reads from process environment and database settings.
- Viba API-server logger coupling.
- Hard-coded sender addresses and product text.
- Error swallowing after failed delivery.

## Result

The reusable package exposes generic notification messages, provider contracts, safe template rendering and tenant-scoped routing. SMTP, SMS, push and in-app implementations are adapters supplied by the consuming application.
