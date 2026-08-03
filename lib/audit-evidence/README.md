# Viba Audit and Evidence Timeline

Reusable, tenant-scoped, append-only audit event log with an integrity hash
chain and evidence bundle export. Ships as a store-interface library — bring
your own PostgreSQL-backed `AuditEvidenceStore` implementation for production
use, or use the in-memory reference implementation for tests.

## Package

- name: `@viba/audit-evidence`
- version: `1.0.0`
- supported runtime: Node.js >= 22
- supported database: PostgreSQL >= 15
- license: MIT

## Guarantees

- events are append-only; the store interface has no update or delete method,
  and the reference PostgreSQL migration adds triggers that reject `UPDATE`
  and `DELETE` on `audit_events` at the database level;
- every event is scoped to an `organizationId`; all read APIs require a tenant
  id and reject cross-tenant access outright rather than silently filtering;
- every event carries actor type/id, category, action, target, structured
  metadata, optional before/after snapshots, request/correlation/IP context,
  and safe evidence-attachment references;
- attempting to record a metadata field that looks like a password, token,
  API key or other secret throws instead of being stored;
- evidence attachments must be external storage references (an object key,
  URN, or similar) — inline `data:` URIs are rejected;
- events form a SHA-256 hash chain (Node's `node:crypto`, no custom crypto)
  over a canonicalized (key-sorted) representation of each event plus the
  previous event's hash, so any tampering is detectable via `verifyChain`;
- listing is deterministically ordered by an append-time sequence number and
  supports cursor-based pagination;
- metadata fields can be redacted on read/export via configuration without
  altering the underlying hashed data.

## Installation

This package is part of the `leego972/viba` pnpm workspace and is not
published to a public registry. Within the workspace:

```bash
pnpm --filter @viba/audit-evidence build
pnpm --filter @viba/audit-evidence test
```

## Migration instructions

Apply `migrations/001_audit_evidence.sql` against a PostgreSQL >= 15 database.
It creates the `audit_events` table, its indexes, and two `BEFORE UPDATE` /
`BEFORE DELETE` triggers that raise an exception on any attempted mutation.

## Rollback instructions

```sql
DROP TRIGGER IF EXISTS audit_events_no_delete ON audit_events;
DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
DROP FUNCTION IF EXISTS reject_audit_event_mutation();
DROP TABLE IF EXISTS audit_events;
```

Because the table is append-only by design, a "rollback" of recorded events
is intentionally not supported — only schema rollback is.

## API example

```ts
import { AuditEvidenceService, MemoryAuditEvidenceStore } from "@viba/audit-evidence";
import { randomUUID } from "node:crypto";

const store = new MemoryAuditEvidenceStore(); // swap for a PostgreSQL-backed store in production
const service = new AuditEvidenceService(store, () => randomUUID(), {
  redactedMetadataPaths: ["customer.ssn"],
});

const event = await service.recordEvent({
  organizationId: "org_123",
  actorType: "user",
  actorId: "user_456",
  category: "billing",
  action: "invoice.created",
  targetType: "invoice",
  targetId: "inv_789",
  metadata: { amountCents: 4200 },
  context: { requestId: "req_1", correlationId: "corr_1", ipAddress: "203.0.113.5" },
});

const page = await service.listEvents({ organizationId: "org_123" }, { limit: 50 });
const verification = await service.verifyChain("org_123");
const bundle = await service.exportEvidenceBundle({ organizationId: "org_123" });
```

## Security assumptions

- the caller is responsible for authenticating the actor and passing a
  correct, already-verified `organizationId` — this library enforces
  isolation between tenants but does not itself authenticate callers;
- the caller must not pass raw secret values as attachment content; the
  library validates the *shape* of attachment references, not their contents
  on the far end of the reference;
- a production store implementation must preserve append-only semantics
  (no `UPDATE`/`DELETE` paths) or the hash-chain and immutability guarantees
  no longer hold.

## Known limitations

- the in-memory reference store is for tests and local development only and
  is not durable or safe for concurrent processes;
- `verifyChain` and `exportEvidenceBundle` read the full per-tenant event
  history into memory; very large tenants should paginate exports upstream
  of very large single-bundle requests;
- redaction operates on metadata only; it does not redact `before`/`after`
  snapshot fields, which callers should keep free of sensitive data or
  redact before calling `recordEvent`.
