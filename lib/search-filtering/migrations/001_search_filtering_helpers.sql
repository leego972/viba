-- @viba/search-filtering ships as a query builder over caller-owned tables,
-- not an owned table of its own. This migration provides optional helper
-- functions and index guidance for applying it to an existing table.
--
-- Usage: for a table `documents` with tenant column `organization_id` and
-- searchable columns `title`, `body`, create a generated tsvector column and
-- a GIN index so `buildSearchQuery`'s WHERE/ORDER BY clauses can use it
-- efficiently:
--
--   ALTER TABLE documents
--     ADD COLUMN search_vector tsvector
--     GENERATED ALWAYS AS (
--       to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
--     ) STORED;
--
--   CREATE INDEX IF NOT EXISTS idx_documents_search_vector
--     ON documents USING GIN (search_vector);
--
--   CREATE INDEX IF NOT EXISTS idx_documents_org_id
--     ON documents (organization_id, id);
--
-- Apply the same pattern (generated tsvector column + GIN index, plus a
-- (tenant_column, id) btree index for keyset pagination) to any table this
-- module searches. Column and table names are illustrative; substitute the
-- caller's actual schema.

CREATE OR REPLACE FUNCTION viba_search_filtering_helper_version() RETURNS text AS $$
  SELECT '1.0.0'::text;
$$ LANGUAGE sql IMMUTABLE;
