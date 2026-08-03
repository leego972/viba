CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id text PRIMARY KEY,
  url text NOT NULL CHECK (url LIKE 'https://%'),
  secret_ciphertext text NOT NULL,
  previous_secret_ciphertext text,
  subscribed_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id text PRIMARY KEY,
  endpoint_id text NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  event_type text NOT NULL,
  event_version text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','delivering','succeeded','retry','dead_letter')),
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_delivery_attempts (
  id bigserial PRIMARY KEY,
  delivery_id text NOT NULL REFERENCES webhook_deliveries(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  status_code integer,
  error text,
  UNIQUE (delivery_id, attempt)
);

CREATE TABLE IF NOT EXISTS webhook_inbound_events (
  event_id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_retry_idx
  ON webhook_deliveries (status, next_attempt_at)
  WHERE status = 'retry';
