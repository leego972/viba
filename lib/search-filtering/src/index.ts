// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export type FilterFieldType = "exact" | "range" | "array";

export type SearchSchema = {
  /** The tenant-scoping column; always required in generated WHERE clauses. */
  tenantColumn: string;
  /** The primary key column, used as a deterministic pagination tiebreaker. */
  idColumn: string;
  /** Columns combined into the full-text search vector, in priority order. */
  searchableFields: string[];
  /** Columns available for exact/range/array filtering, and their kind. */
  filterableFields: Record<string, FilterFieldType>;
  /** Columns callers may sort by. Anything not listed here is rejected. */
  sortableFields: string[];
  /** Columns callers may request facet counts for. Anything else is rejected. */
  facetFields: string[];
};

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

export type RangeFilter = { gte?: number | string; lte?: number | string; gt?: number | string; lt?: number | string };

export type SearchFilters = {
  exact?: Record<string, string | number | boolean>;
  range?: Record<string, RangeFilter>;
  array?: Record<string, Array<string | number>>;
};

export type SortClause = { field: string; direction: "asc" | "desc" };

export type SearchRequest = {
  organizationId: string;
  query?: string;
  filters?: SearchFilters;
  sort?: SortClause[];
  facets?: string[];
  limit?: number;
  cursor?: string;
};

export type ParameterizedQuery = {
  text: string;
  values: unknown[];
};

export type FacetCount = { field: string; value: string; count: number };

export type SuggestionResult = { field: string; value: string };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

export class UnknownFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownFieldError";
  }
}

export class QueryComplexityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryComplexityError";
  }
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 200;
export const MAX_QUERY_LENGTH = 200;
export const MAX_FILTER_COUNT = 20;
export const MAX_SORT_FIELDS = 5;
export const MAX_ARRAY_FILTER_VALUES = 100;

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function quoteIdentifier(name: string): string {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new UnknownFieldError(`"${name}" is not a valid identifier`);
  }
  return `"${name}"`;
}

function requireKnownField(field: string, allowed: readonly string[] | ReadonlyArray<string>, kind: string): void {
  if (!allowed.includes(field)) {
    throw new UnknownFieldError(`unknown ${kind} field "${field}"`);
  }
}

function assertValidTable(table: string): string {
  return quoteIdentifier(table);
}

// ---------------------------------------------------------------------------
// Shared validation used by both the SQL builder and the in-memory engine,
// so both implementations reject the same malformed or unsafe requests.
// ---------------------------------------------------------------------------

function validateRequest(schema: SearchSchema, request: SearchRequest): void {
  if (!request.organizationId) {
    throw new TenantScopeError("organizationId is required for every search");
  }
  if (request.query && request.query.length > MAX_QUERY_LENGTH) {
    throw new QueryComplexityError(`query text exceeds ${MAX_QUERY_LENGTH} characters`);
  }

  const exact = Object.keys(request.filters?.exact ?? {});
  const range = Object.keys(request.filters?.range ?? {});
  const array = Object.keys(request.filters?.array ?? {});
  const totalFilters = exact.length + range.length + array.length;
  if (totalFilters > MAX_FILTER_COUNT) {
    throw new QueryComplexityError(`too many filters: ${totalFilters} exceeds limit of ${MAX_FILTER_COUNT}`);
  }
  for (const field of exact) {
    requireKnownField(field, Object.keys(schema.filterableFields), "exact filter");
    if (schema.filterableFields[field] !== "exact") {
      throw new UnknownFieldError(`field "${field}" is not configured as an exact-match filter`);
    }
  }
  for (const field of range) {
    requireKnownField(field, Object.keys(schema.filterableFields), "range filter");
    if (schema.filterableFields[field] !== "range") {
      throw new UnknownFieldError(`field "${field}" is not configured as a range filter`);
    }
  }
  for (const field of array) {
    requireKnownField(field, Object.keys(schema.filterableFields), "array filter");
    if (schema.filterableFields[field] !== "array") {
      throw new UnknownFieldError(`field "${field}" is not configured as an array filter`);
    }
    const values = request.filters?.array?.[field] ?? [];
    if (values.length > MAX_ARRAY_FILTER_VALUES) {
      throw new QueryComplexityError(`array filter "${field}" exceeds ${MAX_ARRAY_FILTER_VALUES} values`);
    }
  }

  const sort = request.sort ?? [];
  if (sort.length > MAX_SORT_FIELDS) {
    throw new QueryComplexityError(`too many sort fields: ${sort.length} exceeds limit of ${MAX_SORT_FIELDS}`);
  }
  for (const clause of sort) {
    requireKnownField(clause.field, schema.sortableFields, "sort");
  }

  for (const facet of request.facets ?? []) {
    requireKnownField(facet, schema.facetFields, "facet");
  }

  if (request.limit !== undefined && (request.limit < 1 || request.limit > MAX_LIMIT)) {
    throw new QueryComplexityError(`limit must be between 1 and ${MAX_LIMIT}`);
  }
}

// ---------------------------------------------------------------------------
// Cursor encoding — opaque, tamper-evident only in the sense that it is not
// meant to be hand-constructed; a malformed cursor throws rather than being
// silently accepted.
// ---------------------------------------------------------------------------

type Cursor = { rank: number | null; id: string };

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (typeof parsed.id !== "string") throw new Error("invalid");
    return parsed;
  } catch {
    throw new QueryComplexityError("invalid pagination cursor");
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL full-text search query builder — produces parameterized SQL.
// Every value is passed as a placeholder ($1, $2, ...); every identifier
// (table/column name) is validated against the schema allowlist and a strict
// identifier pattern before being written into the SQL text. No user-supplied
// string is ever concatenated directly into the query text.
// ---------------------------------------------------------------------------

export function buildSearchQuery(schema: SearchSchema, table: string, request: SearchRequest): ParameterizedQuery {
  validateRequest(schema, request);

  const quotedTable = assertValidTable(table);
  const tenantCol = quoteIdentifier(schema.tenantColumn);
  const idCol = quoteIdentifier(schema.idColumn);
  const values: unknown[] = [];
  const conditions: string[] = [];
  let paramIndex = 0;
  const nextParam = (value: unknown): string => {
    values.push(value);
    paramIndex += 1;
    return `$${paramIndex}`;
  };

  conditions.push(`${tenantCol} = ${nextParam(request.organizationId)}`);

  const hasQuery = Boolean(request.query && request.query.trim().length > 0);
  let tsQueryParam = "";
  let selectRank = "";
  let selectHighlight = "";
  if (hasQuery) {
    const vectorExpr = schema.searchableFields
      .map((field) => `coalesce(${quoteIdentifier(field)}, '')`)
      .join(" || ' ' || ");
    tsQueryParam = nextParam(request.query);
    conditions.push(`to_tsvector('english', ${vectorExpr}) @@ websearch_to_tsquery('english', ${tsQueryParam})`);
    selectRank = `, ts_rank(to_tsvector('english', ${vectorExpr}), websearch_to_tsquery('english', ${tsQueryParam})) AS rank`;
    if (schema.searchableFields[0]) {
      selectHighlight = `, ts_headline('english', ${quoteIdentifier(schema.searchableFields[0])}, websearch_to_tsquery('english', ${tsQueryParam})) AS highlight`;
    }
  }

  for (const [field, value] of Object.entries(request.filters?.exact ?? {})) {
    conditions.push(`${quoteIdentifier(field)} = ${nextParam(value)}`);
  }
  for (const [field, range] of Object.entries(request.filters?.range ?? {})) {
    const col = quoteIdentifier(field);
    if (range.gte !== undefined) conditions.push(`${col} >= ${nextParam(range.gte)}`);
    if (range.lte !== undefined) conditions.push(`${col} <= ${nextParam(range.lte)}`);
    if (range.gt !== undefined) conditions.push(`${col} > ${nextParam(range.gt)}`);
    if (range.lt !== undefined) conditions.push(`${col} < ${nextParam(range.lt)}`);
  }
  for (const [field, arr] of Object.entries(request.filters?.array ?? {})) {
    conditions.push(`${quoteIdentifier(field)} && ${nextParam(arr)}`);
  }

  const cursor = decodeCursor(request.cursor);
  const sort = request.sort ?? [];
  let orderBy: string;
  if (hasQuery && sort.length === 0) {
    orderBy = `rank DESC, ${idCol} ASC`;
    if (cursor) {
      if (cursor.rank !== null) {
        conditions.push(
          `(ts_rank(to_tsvector('english', ${schema.searchableFields
            .map((f) => `coalesce(${quoteIdentifier(f)}, '')`)
            .join(" || ' ' || ")}), websearch_to_tsquery('english', ${tsQueryParam})) < ${nextParam(cursor.rank)}` +
            ` OR (ts_rank(to_tsvector('english', ${schema.searchableFields
              .map((f) => `coalesce(${quoteIdentifier(f)}, '')`)
              .join(" || ' ' || ")}), websearch_to_tsquery('english', ${tsQueryParam})) = ${nextParam(cursor.rank)}` +
            ` AND ${idCol} > ${nextParam(cursor.id)}))`,
        );
      } else {
        conditions.push(`${idCol} > ${nextParam(cursor.id)}`);
      }
    }
  } else {
    const parts = sort.length > 0 ? sort : [{ field: schema.idColumn, direction: "asc" as const }];
    const clauseText = parts.map((s) => `${quoteIdentifier(s.field)} ${s.direction === "desc" ? "DESC" : "ASC"}`).join(", ");
    const alreadyEndsWithId = parts[parts.length - 1]!.field === schema.idColumn;
    orderBy = alreadyEndsWithId ? clauseText : `${clauseText}, ${idCol} ASC`;
    if (cursor) {
      conditions.push(`${idCol} > ${nextParam(cursor.id)}`);
    }
  }

  const limit = Math.min(request.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const limitParam = nextParam(limit + 1);

  const text =
    `SELECT *${selectRank}${selectHighlight} FROM ${quotedTable} ` +
    `WHERE ${conditions.join(" AND ")} ` +
    `ORDER BY ${orderBy} ` +
    `LIMIT ${limitParam}`;

  return { text, values };
}

export function buildFacetQuery(schema: SearchSchema, table: string, request: SearchRequest, facetField: string): ParameterizedQuery {
  requireKnownField(facetField, schema.facetFields, "facet");
  validateRequest(schema, { ...request, facets: [facetField] });

  const quotedTable = assertValidTable(table);
  const tenantCol = quoteIdentifier(schema.tenantColumn);
  const facetCol = quoteIdentifier(facetField);
  const values: unknown[] = [request.organizationId];
  const conditions = [`${tenantCol} = $1`];
  let paramIndex = 1;
  const nextParam = (value: unknown): string => {
    values.push(value);
    paramIndex += 1;
    return `$${paramIndex}`;
  };
  for (const [field, value] of Object.entries(request.filters?.exact ?? {})) {
    if (field === facetField) continue;
    conditions.push(`${quoteIdentifier(field)} = ${nextParam(value)}`);
  }

  const text =
    `SELECT ${facetCol} AS value, count(*) AS count FROM ${quotedTable} ` +
    `WHERE ${conditions.join(" AND ")} ` +
    `GROUP BY ${facetCol} ORDER BY count DESC LIMIT 50`;
  return { text, values };
}

export function buildSuggestionQuery(schema: SearchSchema, table: string, organizationId: string, prefix: string): ParameterizedQuery {
  if (!organizationId) throw new TenantScopeError("organizationId is required for suggestions");
  if (prefix.length > MAX_QUERY_LENGTH) throw new QueryComplexityError("suggestion prefix too long");
  const field = schema.searchableFields[0];
  if (!field) throw new UnknownFieldError("schema has no searchable fields to suggest from");

  const quotedTable = assertValidTable(table);
  const tenantCol = quoteIdentifier(schema.tenantColumn);
  const col = quoteIdentifier(field);
  const text =
    `SELECT DISTINCT ${col} AS value FROM ${quotedTable} ` +
    `WHERE ${tenantCol} = $1 AND ${col} ILIKE $2 ` +
    `ORDER BY ${col} LIMIT 10`;
  return { text, values: [organizationId, `${prefix}%`] };
}

// ---------------------------------------------------------------------------
// Optional vector-search adapter interface. No provider-specific
// implementation is included; consumers supply their own.
// ---------------------------------------------------------------------------

export interface VectorSearchAdapter {
  embed(text: string): Promise<number[]>;
  query(embedding: number[], options: { organizationId: string; limit: number }): Promise<Array<{ id: string; score: number }>>;
}

// ---------------------------------------------------------------------------
// In-memory reference engine — mirrors the SQL builder's validation and
// semantics over an array of plain objects, so behavior (ranking,
// highlighting, facets, suggestions, pagination) is exercisable in
// compiled-runtime tests without a running PostgreSQL instance.
// ---------------------------------------------------------------------------

export type SearchDocument = Record<string, unknown>;

export type MemorySearchResult<T extends SearchDocument> = {
  document: T;
  rank: number | null;
  highlight: string | null;
};

export type MemorySearchResponse<T extends SearchDocument> = {
  results: Array<MemorySearchResult<T>>;
  nextCursor: string | null;
};

export class MemorySearchIndex<T extends SearchDocument> {
  constructor(
    private readonly schema: SearchSchema,
    private readonly documents: T[],
  ) {}

  search(request: SearchRequest): MemorySearchResponse<T> {
    validateRequest(this.schema, request);

    const tenantField = this.schema.tenantColumn;
    const idField = this.schema.idColumn;
    let matches = this.documents.filter((doc) => doc[tenantField] === request.organizationId);

    for (const [field, value] of Object.entries(request.filters?.exact ?? {})) {
      matches = matches.filter((doc) => doc[field] === value);
    }
    for (const [field, range] of Object.entries(request.filters?.range ?? {})) {
      matches = matches.filter((doc) => {
        const v = doc[field] as number | string;
        if (range.gte !== undefined && !(v >= range.gte)) return false;
        if (range.lte !== undefined && !(v <= range.lte)) return false;
        if (range.gt !== undefined && !(v > range.gt)) return false;
        if (range.lt !== undefined && !(v < range.lt)) return false;
        return true;
      });
    }
    for (const [field, arr] of Object.entries(request.filters?.array ?? {})) {
      const allowed = new Set(arr);
      matches = matches.filter((doc) => {
        const value = doc[field];
        if (Array.isArray(value)) return value.some((item) => allowed.has(item as string | number));
        return allowed.has(value as string | number);
      });
    }

    const hasQuery = Boolean(request.query && request.query.trim().length > 0);
    const terms = hasQuery ? request.query!.toLowerCase().split(/\s+/).filter(Boolean) : [];

    let scored: Array<{ doc: T; rank: number | null; highlight: string | null }>;
    if (hasQuery) {
      scored = matches
        .map((doc) => {
          const haystack = this.schema.searchableFields
            .map((field) => String(doc[field] ?? ""))
            .join(" ")
            .toLowerCase();
          const score = terms.reduce((sum, term) => sum + (haystack.split(term).length - 1), 0);
          return { doc, rank: score, highlight: score > 0 ? this.highlight(doc, terms) : null };
        })
        .filter((entry) => entry.rank > 0);
    } else {
      scored = matches.map((doc) => ({ doc, rank: null, highlight: null }));
    }

    const sort = request.sort ?? [];
    if (hasQuery && sort.length === 0) {
      scored.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0) || this.compareIds(a.doc, b.doc));
    } else {
      const clauses = sort.length > 0 ? sort : [{ field: idField, direction: "asc" as const }];
      scored.sort((a, b) => {
        for (const clause of clauses) {
          const av = a.doc[clause.field];
          const bv = b.doc[clause.field];
          if (av === bv) continue;
          const cmp = (av as any) < (bv as any) ? -1 : 1;
          return clause.direction === "desc" ? -cmp : cmp;
        }
        return this.compareIds(a.doc, b.doc);
      });
    }

    const cursor = decodeCursor(request.cursor);
    let startIndex = 0;
    if (cursor) {
      startIndex = scored.findIndex((entry) => String(entry.doc[idField]) === cursor.id) + 1;
      if (startIndex <= 0) startIndex = 0;
    }

    const limit = Math.min(request.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const page = scored.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < scored.length;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ rank: last.rank, id: String(last.doc[idField]) }) : null;

    return {
      results: page.map((entry) => ({ document: entry.doc, rank: entry.rank, highlight: entry.highlight })),
      nextCursor,
    };
  }

  facets(request: SearchRequest, facetField: string): FacetCount[] {
    requireKnownField(facetField, this.schema.facetFields, "facet");
    const { results } = this.search({ ...request, limit: MAX_LIMIT });
    const counts = new Map<string, number>();
    for (const { document } of results) {
      const value = String(document[facetField] ?? "");
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ field: facetField, value, count }))
      .sort((a, b) => b.count - a.count);
  }

  suggest(organizationId: string, prefix: string): SuggestionResult[] {
    if (!organizationId) throw new TenantScopeError("organizationId is required for suggestions");
    const field = this.schema.searchableFields[0];
    if (!field) throw new UnknownFieldError("schema has no searchable fields to suggest from");
    const lowerPrefix = prefix.toLowerCase();
    const seen = new Set<string>();
    const results: SuggestionResult[] = [];
    for (const doc of this.documents) {
      if (doc[this.schema.tenantColumn] !== organizationId) continue;
      const value = String(doc[field] ?? "");
      if (value.toLowerCase().startsWith(lowerPrefix) && !seen.has(value)) {
        seen.add(value);
        results.push({ field, value });
      }
    }
    return results.sort((a, b) => a.value.localeCompare(b.value)).slice(0, 10);
  }

  private highlight(doc: T, terms: string[]): string {
    const field = this.schema.searchableFields[0];
    if (!field) return "";
    let text = String(doc[field] ?? "");
    for (const term of terms) {
      const pattern = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
      text = text.replace(pattern, "<mark>$1</mark>");
    }
    return text;
  }

  private compareIds(a: T, b: T): number {
    const idField = this.schema.idColumn;
    const av = String(a[idField]);
    const bv = String(b[idField]);
    return av < bv ? -1 : av > bv ? 1 : 0;
  }
}
