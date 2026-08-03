import assert from "node:assert/strict";
import test from "node:test";
import {
  MemorySearchIndex,
  QueryComplexityError,
  TenantScopeError,
  UnknownFieldError,
  buildFacetQuery,
  buildSearchQuery,
  buildSuggestionQuery,
} from "../dist/index.js";

const schema = {
  tenantColumn: "organization_id",
  idColumn: "id",
  searchableFields: ["title", "body"],
  filterableFields: {
    status: "exact",
    priceCents: "range",
    tags: "array",
  },
  sortableFields: ["createdAt", "priceCents"],
  facetFields: ["status"],
};

const docs = [
  { id: "1", organization_id: "org-1", title: "Blue Widget", body: "A sturdy widget", status: "active", priceCents: 500, tags: ["hardware"], createdAt: "2026-01-01" },
  { id: "2", organization_id: "org-1", title: "Red Widget", body: "A colorful widget", status: "active", priceCents: 700, tags: ["hardware", "sale"], createdAt: "2026-01-02" },
  { id: "3", organization_id: "org-1", title: "Green Gadget", body: "Unrelated item", status: "archived", priceCents: 300, tags: ["misc"], createdAt: "2026-01-03" },
  { id: "4", organization_id: "org-2", title: "Blue Widget", body: "Different tenant", status: "active", priceCents: 500, tags: ["hardware"], createdAt: "2026-01-01" },
];

test("builds a parameterized full-text query with no string concatenation of user input", () => {
  const q = buildSearchQuery(schema, "documents", { organizationId: "org-1", query: "widget" });
  assert.match(q.text, /\$1/);
  assert.match(q.text, /websearch_to_tsquery/);
  assert.match(q.text, /ts_rank/);
  assert.ok(!q.text.includes("widget"), "raw query text must not be inlined into SQL");
  assert.deepEqual(q.values[0], "org-1");
  assert.ok(q.values.includes("widget"));
});

test("rejects unknown filter, sort and facet fields", () => {
  assert.throws(
    () => buildSearchQuery(schema, "documents", { organizationId: "org-1", filters: { exact: { "id; DROP TABLE documents;--": "x" } } }),
    UnknownFieldError,
  );
  assert.throws(
    () => buildSearchQuery(schema, "documents", { organizationId: "org-1", sort: [{ field: "not_a_field", direction: "asc" }] }),
    UnknownFieldError,
  );
  assert.throws(() => buildFacetQuery(schema, "documents", { organizationId: "org-1" }, "priceCents"), UnknownFieldError);
});

test("rejects unsafe table/column identifiers even if they slip past the allowlist shape", () => {
  assert.throws(() => buildSearchQuery(schema, "documents; DROP TABLE users;--", { organizationId: "org-1" }), UnknownFieldError);
});

test("requires organizationId and rejects cross-tenant-shaped requests outright", () => {
  assert.throws(() => buildSearchQuery(schema, "documents", { organizationId: "" }), TenantScopeError);
  const q = buildSearchQuery(schema, "documents", { organizationId: "org-1" });
  assert.equal(q.values[0], "org-1");
});

test("enforces query length, filter count, sort count and limit complexity bounds", () => {
  assert.throws(
    () => buildSearchQuery(schema, "documents", { organizationId: "org-1", query: "x".repeat(500) }),
    QueryComplexityError,
  );
  assert.throws(
    () => buildSearchQuery(schema, "documents", { organizationId: "org-1", limit: 100000 }),
    QueryComplexityError,
  );
  const manySort = Array.from({ length: 10 }, () => ({ field: "createdAt", direction: "asc" }));
  assert.throws(() => buildSearchQuery(schema, "documents", { organizationId: "org-1", sort: manySort }), QueryComplexityError);
});

test("builds range and array filter clauses with parameterized values", () => {
  const q = buildSearchQuery(schema, "documents", {
    organizationId: "org-1",
    filters: { range: { priceCents: { gte: 100, lte: 900 } }, array: { tags: ["hardware", "sale"] } },
  });
  assert.match(q.text, />=/);
  assert.match(q.text, /<=/);
  assert.match(q.text, /&&/);
  assert.ok(q.values.some((v) => Array.isArray(v) && v.includes("hardware")));
});

test("builds a suggestion query scoped to the tenant with a prefix parameter", () => {
  const q = buildSuggestionQuery(schema, "documents", "org-1", "Blu");
  assert.match(q.text, /ILIKE/);
  assert.deepEqual(q.values, ["org-1", "Blu%"]);
});

// ---------------------------------------------------------------------------
// In-memory reference engine: exercises real ranked/highlighted/faceted
// search behavior deterministically.
// ---------------------------------------------------------------------------

test("in-memory engine returns tenant-scoped, ranked, highlighted results", () => {
  const index = new MemorySearchIndex(schema, docs);
  const { results } = index.search({ organizationId: "org-1", query: "widget" });
  assert.ok(results.length >= 2);
  assert.ok(results.every((r) => r.document.organization_id === "org-1"));
  assert.ok(results[0].rank >= results[results.length - 1].rank);
  assert.match(results[0].highlight, /<mark>/i);
});

test("in-memory engine enforces the same tenant isolation as the query builder", () => {
  const index = new MemorySearchIndex(schema, docs);
  const org1 = index.search({ organizationId: "org-1" }).results.map((r) => r.document.id);
  const org2 = index.search({ organizationId: "org-2" }).results.map((r) => r.document.id);
  assert.deepEqual(org1.sort(), ["1", "2", "3"]);
  assert.deepEqual(org2, ["4"]);
});

test("in-memory engine paginates deterministically via cursor", () => {
  const index = new MemorySearchIndex(schema, docs);
  const first = index.search({ organizationId: "org-1", sort: [{ field: "createdAt", direction: "asc" }], limit: 2 });
  assert.equal(first.results.length, 2);
  assert.ok(first.nextCursor);
  const second = index.search({
    organizationId: "org-1",
    sort: [{ field: "createdAt", direction: "asc" }],
    limit: 2,
    cursor: first.nextCursor,
  });
  assert.equal(second.results.length, 1);
  assert.notEqual(second.results[0].document.id, first.results[0].document.id);
  assert.equal(second.nextCursor, null);
});

test("in-memory engine computes facet counts within the tenant and current filters", () => {
  const index = new MemorySearchIndex(schema, docs);
  const facets = index.facets({ organizationId: "org-1" }, "status");
  const active = facets.find((f) => f.value === "active");
  const archived = facets.find((f) => f.value === "archived");
  assert.equal(active.count, 2);
  assert.equal(archived.count, 1);
});

test("in-memory engine returns tenant-scoped prefix suggestions", () => {
  const index = new MemorySearchIndex(schema, docs);
  const suggestions = index.suggest("org-1", "Blue");
  assert.ok(suggestions.some((s) => s.value === "Blue Widget"));
  const crossTenant = index.suggest("org-2", "Green");
  assert.equal(crossTenant.length, 0);
});

test("in-memory engine applies exact, range and array filters together", () => {
  const index = new MemorySearchIndex(schema, docs);
  const { results } = index.search({
    organizationId: "org-1",
    filters: { exact: { status: "active" }, range: { priceCents: { gte: 600 } }, array: { tags: ["sale"] } },
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].document.id, "2");
});

test("in-memory engine rejects the same malformed requests the query builder rejects", () => {
  const index = new MemorySearchIndex(schema, docs);
  assert.throws(() => index.search({ organizationId: "org-1", filters: { exact: { nope: "x" } } }), UnknownFieldError);
  assert.throws(() => index.search({ organizationId: "" }), TenantScopeError);
});
