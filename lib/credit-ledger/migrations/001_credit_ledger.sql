CREATE TABLE IF NOT EXISTS credit_ledger_entries (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN (
    'grant','purchase','debit','refund','adjustment','reservation',
    'reservation_capture','reservation_release','expiry'
  )),
  amount bigint NOT NULL CHECK (amount > 0),
  available_delta bigint NOT NULL,
  reserved_delta bigint NOT NULL,
  reference text,
  idempotency_key text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (available_delta <> 0 OR reserved_delta <> 0)
);

CREATE INDEX IF NOT EXISTS credit_ledger_entries_account_created_idx
  ON credit_ledger_entries (account_id, created_at, id);

CREATE TABLE IF NOT EXISTS credit_reservations (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  captured bigint NOT NULL DEFAULT 0 CHECK (captured >= 0),
  released bigint NOT NULL DEFAULT 0 CHECK (released >= 0),
  status text NOT NULL CHECK (status IN ('open','captured','released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (captured + released <= amount)
);

CREATE INDEX IF NOT EXISTS credit_reservations_account_status_idx
  ON credit_reservations (account_id, status);
