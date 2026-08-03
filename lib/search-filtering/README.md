# Viba Search and Filtering

A safe, tenant-scoped PostgreSQL full-text search query builder, plus an
in-memory reference engine with the same validation and semantics for
testing without a database.

## Package

- name: `@viba/search-filtering`
- version: `1.0.0`
- supported runtime: Node.js >= 22
- supported database: PostgreSQL >= 15
- license: MIT

## What this is (and isn't)

This module builds parameterized SQL (`{ text, values }`) for full-text
search, exact/range/array filtering, allowlisted sorting, facet counts and
prefix suggestions against a caller-owned table — it does not ship its own
table, ORM, or database connection, and it does not execute queries itself.
The in-memory `MemorySearchIndex` implements identical validation and
matching/ranking/highlighting/facet/suggestion behavior over plain objects so
the package is fully testable in CI without provisioning PostgreSQL.

## Guarantees

- every value in a generated query is passed as a `$1, $2, ...` placeholder —
  user input (search text, filter values, cursors) is never concatenated
  into SQL text;
- every identifier (table name, column name) is validated against a strict
  `^[a-zA-Z_][a-zA-Z0-9_]*$` pattern and, for filters/sort/facets, against
  the caller-supplied schema allowlist before being written into SQL;
- unknown filter fields, sort fields, and facet fields are rejected with a
  typed error rather than silently ignored;
- every search requires an `organizationId`, scoped via a configurable
  tenant column;
- query length, filter count, sort-field count, array-filter size, and page
  size are all bounded, with typed errors when a request exceeds them;
- pagination is cursor-based and deterministic (rank + id, or sort key + id,
  as a tiebreaker);
- an optional `VectorSearchAdapter` interface is exported for callers who
  want to plug in a provider-specific vector search implementation; none is
  bundled.

## Installation

Part of the `leego972/viba` pnpm workspace:

```bash
pnpm --filter @viba/search-filtering build
pnpm --filter @viba/search-filtering test
```

## Migration instructions

`migrations/001_search_filtering_helpers.sql` does not create a table for
this module — it documents (and installs a version-marker function for) the
recommended pattern: a generated `tsvector` column plus a GIN index on the
table you are searching, and a `(tenant_column, id)` index for pagination.
Apply that pattern to your own table(s) using your own column names.

## Rollback instructions

```sql
DROP FUNCTION IF EXISTS viba_search_filtering_helper_version();
-- and, if applied to your table:
DROP INDEX IF EXISTS idx_documents_search_vector;
DROP INDEX IF EXISTS idx_documents_org_id;
ALTER TABLE documents DROP COLUMN IF EXISTS search_vector;
```

## API examples

```ts
import { buildSearchQuery, buildFacetQuery, buildSuggestionQuery } from "@viba/search-filtering";

const schema = {
  tenantColumn: "organization_id",
  idColumn: "id",
  searchableFields: ["title", "body"],
  filterableFields: { status: "exact", priceCents: "range", tags: "array" },
  sortableFields: ["createdAt", "priceCents"],
  facetFields: ["status"],
};

const { text, values } = buildSearchQuery(schema, "documents", {
  organizationId: "org_123",
  query: "blue widget",
  filters: { exact: { status: "active" }, range: { priceCents: { gte: 100 } } },
  limit: 20,
});
// run `text` with `values` through your own PostgreSQL client (pg, postgres.js, etc.)

const facetQuery = buildFacetQuery(schema, "documents", { organizationId: "org_123" }, "status");
const suggestQuery = buildSuggestionQuery(schema, "documents", "org_123", "Blu");
```

In-memory engine, for tests or small in-process datasets:

```ts
import { MemorySearchIndex } from "@viba/search-filtering";

const index = new MemorySearchIndex(schema, documents);
const { results, nextCursor } = index.search({ organizationId: "org_123", query: "widget", limit: 10 });
const facets = index.facets({ organizationId: "org_123" }, "status");
const suggestions = index.suggest("org_123", "Blu");
```

## Security assumptions

- the caller passes an already-authenticated, correct `organizationId`; this
  library enforces that every generated query is scoped to it, but does not
  itself authenticate the caller;
- the schema (`searchableFields`, `filterableFields`, `sortableFields`,
  `facetFields`) is defined by trusted application code, not derived from
  user input — it is the allowlist against which user-supplied field names
  are checked;
- the caller is responsible for executing the generated parameterized query
  through a standard PostgreSQL client that itself respects placeholders
  (this library does not execute SQL).

## Known limitations

- keyset pagination uses a single sort key (or rank) plus the id column as a
  tiebreaker; multi-column keyset pagination beyond that is not implemented;
- the in-memory engine's ranking is a simple term-frequency score and its
  highlighting is a plain substring wrap — useful for tests and small
  datasets, not a substitute for PostgreSQL's `ts_rank`/`ts_headline`, which
  the SQL builder uses directly;
- no vector-search implementation is included, only the `VectorSearchAdapter`
  interface;
- this module does not create or own a database table; applying the
  suggested `tsvector`/GIN index pattern to the caller's table is a
  prerequisite for good performance in production.
