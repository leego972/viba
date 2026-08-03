BEGIN;

CREATE SCHEMA IF NOT EXISTS viba_foundation;

CREATE TABLE IF NOT EXISTS viba_foundation.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  checksum text NOT NULL,
  execution_ms integer NOT NULL CHECK (execution_ms >= 0)
);

CREATE OR REPLACE FUNCTION viba_foundation.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION viba_foundation.reject_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'hard delete is disabled for %', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

COMMENT ON SCHEMA viba_foundation IS
  'Shared migration metadata and trigger helpers for @viba/postgres-foundation.';

COMMIT;

-- Rollback:
-- DROP FUNCTION IF EXISTS viba_foundation.reject_hard_delete();
-- DROP FUNCTION IF EXISTS viba_foundation.set_updated_at();
-- DROP TABLE IF EXISTS viba_foundation.schema_migrations;
-- DROP SCHEMA IF EXISTS viba_foundation;
