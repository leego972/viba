# Viba PostgreSQL Foundation

Reusable, driver-neutral PostgreSQL primitives for Viba modules and services.

## Package

- Name: `@viba/postgres-foundation`
- Version: `1.0.0`
- Runtime: Node.js 22 or newer
- Database: PostgreSQL 15 or newer
- Licence: MIT

## Capabilities

- transaction wrapper with commit, rollback and guaranteed client release;
- advisory-lock helper for migrations and singleton operations;
- opaque cursor encoding and validation;
- bounded keyset-pagination predicates;
- safe SQL identifier validation;
- soft-delete query construction;
- reusable migration metadata and trigger helpers.

The package exposes contracts rather than owning a connection pool. Applications inject a compatible pool/client implementation.

## Installation

```bash
pnpm --filter @viba/postgres-foundation build
pnpm --filter @viba/postgres-foundation test
```

## Example

```ts
import {
  withTransaction,
  encodeCursor,
  decodeCursor,
  buildKeysetPredicate,
} from "@viba/postgres-foundation";

const result = await withTransaction(pool, async (client) => {
  const page = await client.query(
    `select id, created_at from jobs
     where tenant_id = $1
       and ${buildKeysetPredicate("created_at", "id", 2).text}
     order by created_at desc, id desc
     limit $4`,
    [tenantId, cursor.createdAt, cursor.id, 50],
  );
  return page.rows;
});
```

## Migration

Apply `migrations/001_postgres_foundation.sql` through the application's normal migration runner. The migration is transactional and uses `IF NOT EXISTS` where PostgreSQL supports it.

## Rollback

Execute the rollback statements at the bottom of the migration after confirming no dependent database objects use the helper functions or schema-migration table.

## Security assumptions

- database credentials and authorization remain the application's responsibility;
- callers must still parameterize values; this package validates identifiers but cannot make arbitrary SQL safe;
- tenant predicates must be supplied by the caller for tenant-owned tables;
- advisory locks coordinate cooperating sessions and are not an authorization mechanism;
- cursors are opaque encodings, not encrypted secrets or authorization tokens.

## Transactional assumptions

- the injected pool returns a client supporting `query()` and `release()`;
- PostgreSQL transaction semantics determine isolation and locking behavior;
- callback errors trigger rollback and are rethrown;
- release is attempted after either commit or rollback.

## Compatibility

The module is compiled as NodeNext ESM with strict TypeScript declarations. It has no runtime dependency on a specific PostgreSQL driver.

## Known limitations

- no connection pooling, ORM, migration CLI or schema-diff engine is included;
- no live PostgreSQL service is provisioned by the module test suite;
- cursor encoding is integrity-checked structurally but is not cryptographically signed;
- keyset helpers cover deterministic two-column pagination rather than arbitrary query planners.
