CREATE TABLE affiliate_accounts (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('active','paused','blocked')),
  payout_method text CHECK (payout_method IN ('manual','stripe_connect','credits')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE affiliate_campaigns (
  id text PRIMARY KEY,
  name text NOT NULL,
  attribution_model text NOT NULL CHECK (attribution_model IN ('first_touch','last_touch')),
  cookie_days integer NOT NULL CHECK (cookie_days > 0),
  commission_type text NOT NULL CHECK (commission_type IN ('fixed','percentage')),
  commission_value bigint NOT NULL CHECK (commission_value >= 0),
  recurring_months integer NOT NULL DEFAULT 1 CHECK (recurring_months > 0),
  minimum_order_amount bigint NOT NULL DEFAULT 0 CHECK (minimum_order_amount >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE affiliate_clicks (
  id text PRIMARY KEY,
  affiliate_id text NOT NULL REFERENCES affiliate_accounts(id),
  campaign_id text NOT NULL REFERENCES affiliate_campaigns(id),
  visitor_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX affiliate_clicks_attribution_idx ON affiliate_clicks(visitor_id, campaign_id, occurred_at);

CREATE TABLE affiliate_commissions (
  id text PRIMARY KEY,
  affiliate_id text NOT NULL REFERENCES affiliate_accounts(id),
  campaign_id text NOT NULL REFERENCES affiliate_campaigns(id),
  conversion_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  amount bigint NOT NULL CHECK (amount >= 0),
  status text NOT NULL CHECK (status IN ('pending','approved','payable','paid','reversed','held')),
  reversal_of text REFERENCES affiliate_commissions(id),
  reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX affiliate_commissions_payout_idx ON affiliate_commissions(affiliate_id, status);

CREATE TABLE affiliate_payout_batches (
  id text PRIMARY KEY,
  affiliate_id text NOT NULL REFERENCES affiliate_accounts(id),
  total_amount bigint NOT NULL CHECK (total_amount > 0),
  status text NOT NULL CHECK (status IN ('created','exported','paid','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE affiliate_payout_items (
  payout_batch_id text NOT NULL REFERENCES affiliate_payout_batches(id),
  commission_id text NOT NULL UNIQUE REFERENCES affiliate_commissions(id),
  PRIMARY KEY (payout_batch_id, commission_id)
);
