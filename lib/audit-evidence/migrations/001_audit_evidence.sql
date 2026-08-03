CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  sequence bigint NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  category text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_snapshot jsonb,
  after_snapshot jsonb,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  request_id text,
  correlation_id text,
  ip_address text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  prev_hash text NOT NULL,
  hash text NOT NULL,
  UNIQUE (organization_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_audit_events_org_seq ON audit_events(organization_id, sequence);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_actor ON audit_events(organization_id, actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_action ON audit_events(organization_id, action);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_target ON audit_events(organization_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_time ON audit_events(organization_id, occurred_at);

-- Append-only enforcement: no application role may UPDATE or DELETE rows in
-- this table. Reject both at the database level regardless of caller intent.
CREATE OR REPLACE FUNCTION reject_audit_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

DROP TRIGGER IF EXISTS audit_events_no_delete ON audit_events;
CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
