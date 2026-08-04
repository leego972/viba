import type { Pool } from "pg";

/**
 * Installs the governance persistence and execution invariants before the DB
 * package is exposed to application callers. The SQL is intentionally
 * idempotent so every process may run it safely during startup.
 */
export async function ensureGovernanceDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_contracts (
        id serial PRIMARY KEY,
        session_id integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        version integer NOT NULL DEFAULT 1,
        status text NOT NULL DEFAULT 'active',
        objective text NOT NULL,
        assigned_agent_id integer REFERENCES agents(id) ON DELETE SET NULL,
        allowed_paths text[] NOT NULL DEFAULT ARRAY[]::text[],
        forbidden_paths text[] NOT NULL DEFAULT ARRAY[]::text[],
        owned_interfaces text[] NOT NULL DEFAULT ARRAY[]::text[],
        dependency_task_ids integer[] NOT NULL DEFAULT ARRAY[]::integer[],
        required_checks text[] NOT NULL DEFAULT ARRAY[]::text[],
        architecture_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
        acceptance_criteria text[] NOT NULL DEFAULT ARRAY[]::text[],
        max_estimated_cost double precision,
        expires_at timestamptz,
        requires_proposal_approval boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT task_contracts_task_version_uq UNIQUE(task_id, version)
      );

      CREATE TABLE IF NOT EXISTS governance_reservations (
        id serial PRIMARY KEY,
        session_id integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        contract_id integer NOT NULL REFERENCES task_contracts(id) ON DELETE CASCADE,
        agent_id integer REFERENCES agents(id) ON DELETE SET NULL,
        resource_type text NOT NULL,
        resource_key text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now(),
        released_at timestamptz
      );

      CREATE TABLE IF NOT EXISTS operator_proposals (
        id serial PRIMARY KEY,
        session_id integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        contract_id integer NOT NULL REFERENCES task_contracts(id) ON DELETE CASCADE,
        agent_id integer REFERENCES agents(id) ON DELETE SET NULL,
        proposal_type text NOT NULL,
        summary text NOT NULL,
        rationale text NOT NULL,
        affected_paths text[] NOT NULL DEFAULT ARRAY[]::text[],
        affected_interfaces text[] NOT NULL DEFAULT ARRAY[]::text[],
        requested_dependencies text[] NOT NULL DEFAULT ARRAY[]::text[],
        expected_benefits text[] NOT NULL DEFAULT ARRAY[]::text[],
        estimated_cost jsonb NOT NULL DEFAULT '{}'::jsonb,
        risk text NOT NULL DEFAULT 'medium',
        status text NOT NULL DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now(),
        decided_at timestamptz
      );

      CREATE TABLE IF NOT EXISTS proposal_decisions (
        id serial PRIMARY KEY,
        proposal_id integer NOT NULL REFERENCES operator_proposals(id) ON DELETE CASCADE,
        decision text NOT NULL,
        reason text NOT NULL,
        conditions text[] NOT NULL DEFAULT ARRAY[]::text[],
        conflict_report jsonb NOT NULL DEFAULT '{}'::jsonb,
        contract_version_created integer,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS governance_reservations_active_resource_idx
        ON governance_reservations(session_id, resource_type, resource_key)
        WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS task_contracts_active_task_idx
        ON task_contracts(task_id, version DESC)
        WHERE status = 'active';
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION viba_default_allowed_paths(task_type text)
      RETURNS text[]
      LANGUAGE sql
      IMMUTABLE
      AS $$
        SELECT CASE task_type
          WHEN 'planning' THEN ARRAY['docs']::text[]
          WHEN 'research' THEN ARRAY['docs']::text[]
          WHEN 'creative_direction' THEN ARRAY['docs', 'artifacts/bridge-ai']::text[]
          WHEN 'copywriting' THEN ARRAY['docs', 'artifacts/bridge-ai']::text[]
          WHEN 'build' THEN ARRAY['artifacts', 'lib']::text[]
          WHEN 'code_review' THEN ARRAY['artifacts', 'lib', 'docs']::text[]
          WHEN 'ux_review' THEN ARRAY['artifacts/bridge-ai', 'docs']::text[]
          WHEN 'deployment_approval' THEN ARRAY['docs', '.github']::text[]
          WHEN 'final_qa' THEN ARRAY['artifacts', 'lib', 'docs', '.github']::text[]
          ELSE ARRAY['artifacts', 'lib', 'docs']::text[]
        END;
      $$;

      CREATE OR REPLACE FUNCTION viba_issue_default_task_contract()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        INSERT INTO task_contracts (
          session_id,
          task_id,
          version,
          status,
          objective,
          allowed_paths,
          forbidden_paths,
          architecture_rules,
          acceptance_criteria,
          required_checks
        ) VALUES (
          NEW.session_id,
          NEW.id,
          1,
          'active',
          COALESCE(NULLIF(NEW.description, ''), NEW.title),
          viba_default_allowed_paths(NEW.type),
          ARRAY['.env', '.git', 'secrets', 'node_modules']::text[],
          jsonb_build_object(
            'tenantIsolation', true,
            'preservePublicContracts', true,
            'proposalRequiredForScopeExpansion', true
          ),
          ARRAY[
            'Stay within the active task contract',
            'Preserve existing public contracts',
            'Pass required CI checks'
          ]::text[],
          ARRAY['typecheck', 'tests', 'scope-validation']::text[]
        )
        ON CONFLICT (task_id, version) DO NOTHING;
        RETURN NEW;
      END;
      $$;

      DROP TRIGGER IF EXISTS tasks_issue_governance_contract ON tasks;
      CREATE TRIGGER tasks_issue_governance_contract
        AFTER INSERT ON tasks
        FOR EACH ROW
        EXECUTE FUNCTION viba_issue_default_task_contract();
    `);

    await client.query(`
      INSERT INTO task_contracts (
        session_id,
        task_id,
        version,
        status,
        objective,
        allowed_paths,
        forbidden_paths,
        architecture_rules,
        acceptance_criteria,
        required_checks
      )
      SELECT
        t.session_id,
        t.id,
        1,
        'active',
        COALESCE(NULLIF(t.description, ''), t.title),
        viba_default_allowed_paths(t.type),
        ARRAY['.env', '.git', 'secrets', 'node_modules']::text[],
        jsonb_build_object(
          'tenantIsolation', true,
          'preservePublicContracts', true,
          'proposalRequiredForScopeExpansion', true
        ),
        ARRAY[
          'Stay within the active task contract',
          'Preserve existing public contracts',
          'Pass required CI checks'
        ]::text[],
        ARRAY['typecheck', 'tests', 'scope-validation']::text[]
      FROM tasks t
      WHERE NOT EXISTS (
        SELECT 1 FROM task_contracts c WHERE c.task_id = t.id
      )
      ON CONFLICT (task_id, version) DO NOTHING;
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION viba_resources_overlap(left_key text, right_key text)
      RETURNS boolean
      LANGUAGE sql
      IMMUTABLE
      AS $$
        SELECT
          left_key = right_key OR
          left_key LIKE right_key || '/%' OR
          right_key LIKE left_key || '/%';
      $$;

      CREATE OR REPLACE FUNCTION viba_enforce_task_execution_contract()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        active_contract task_contracts%ROWTYPE;
        requested_path text;
        requested_interface text;
        conflicting_task integer;
      BEGIN
        IF NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress' THEN
          SELECT * INTO active_contract
          FROM task_contracts
          WHERE task_id = NEW.id
            AND status = 'active'
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY version DESC
          LIMIT 1;

          IF active_contract.id IS NULL THEN
            RAISE EXCEPTION 'Governance denied task %: no active task contract', NEW.id;
          END IF;

          IF active_contract.assigned_agent_id IS NOT NULL
             AND NEW.assigned_agent_id IS DISTINCT FROM active_contract.assigned_agent_id THEN
            RAISE EXCEPTION 'Governance denied task %: assigned operator does not match contract', NEW.id;
          END IF;

          FOREACH requested_path IN ARRAY active_contract.allowed_paths LOOP
            SELECT r.task_id INTO conflicting_task
            FROM governance_reservations r
            WHERE r.session_id = NEW.session_id
              AND r.task_id <> NEW.id
              AND r.status = 'active'
              AND r.resource_type = 'path'
              AND viba_resources_overlap(requested_path, r.resource_key)
            LIMIT 1;

            IF conflicting_task IS NOT NULL THEN
              RAISE EXCEPTION 'Governance denied task %: path % reserved by task %', NEW.id, requested_path, conflicting_task;
            END IF;
          END LOOP;

          FOREACH requested_interface IN ARRAY active_contract.owned_interfaces LOOP
            SELECT r.task_id INTO conflicting_task
            FROM governance_reservations r
            WHERE r.session_id = NEW.session_id
              AND r.task_id <> NEW.id
              AND r.status = 'active'
              AND r.resource_type = 'interface'
              AND r.resource_key = requested_interface
            LIMIT 1;

            IF conflicting_task IS NOT NULL THEN
              RAISE EXCEPTION 'Governance denied task %: interface % reserved by task %', NEW.id, requested_interface, conflicting_task;
            END IF;
          END LOOP;

          UPDATE task_contracts
          SET assigned_agent_id = COALESCE(assigned_agent_id, NEW.assigned_agent_id)
          WHERE id = active_contract.id;

          INSERT INTO governance_reservations (
            session_id, task_id, contract_id, agent_id, resource_type, resource_key, status
          )
          SELECT NEW.session_id, NEW.id, active_contract.id, NEW.assigned_agent_id, 'path', path, 'active'
          FROM unnest(active_contract.allowed_paths) AS path
          WHERE NOT EXISTS (
            SELECT 1 FROM governance_reservations r
            WHERE r.contract_id = active_contract.id
              AND r.resource_type = 'path'
              AND r.resource_key = path
              AND r.status = 'active'
          );

          INSERT INTO governance_reservations (
            session_id, task_id, contract_id, agent_id, resource_type, resource_key, status
          )
          SELECT NEW.session_id, NEW.id, active_contract.id, NEW.assigned_agent_id, 'interface', interface_key, 'active'
          FROM unnest(active_contract.owned_interfaces) AS interface_key
          WHERE NOT EXISTS (
            SELECT 1 FROM governance_reservations r
            WHERE r.contract_id = active_contract.id
              AND r.resource_type = 'interface'
              AND r.resource_key = interface_key
              AND r.status = 'active'
          );
        END IF;

        IF OLD.status = 'in_progress' AND NEW.status IS DISTINCT FROM 'in_progress' THEN
          UPDATE governance_reservations
          SET status = 'released', released_at = now()
          WHERE task_id = NEW.id AND status = 'active';
        END IF;

        RETURN NEW;
      END;
      $$;

      DROP TRIGGER IF EXISTS tasks_enforce_governance_contract ON tasks;
      CREATE TRIGGER tasks_enforce_governance_contract
        BEFORE UPDATE OF status, assigned_agent_id ON tasks
        FOR EACH ROW
        EXECUTE FUNCTION viba_enforce_task_execution_contract();
    `);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
