import { pool } from "@workspace/db";

export type WebhookReservationStatus =
  | "reserved"
  | "duplicate_processing"
  | "duplicate_succeeded"
  | "duplicate_failed";

let tableReady = false;

async function ensureStripeWebhookEventsTable(): Promise<void> {
  if (tableReady) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      error TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status_updated
    ON stripe_webhook_events (status, updated_at DESC)
  `);

  tableReady = true;
}

export async function reserveStripeWebhookEvent(
  eventId: string,
  eventType: string,
): Promise<WebhookReservationStatus> {
  await ensureStripeWebhookEventsTable();

  const inserted = await pool.query(
    `INSERT INTO stripe_webhook_events (event_id, event_type, status)
     VALUES ($1, $2, 'processing')
     ON CONFLICT (event_id) DO NOTHING
     RETURNING status`,
    [eventId, eventType],
  );

  if ((inserted.rowCount ?? 0) > 0) {
    return "reserved";
  }

  const existing = await pool.query(
    `SELECT status FROM stripe_webhook_events WHERE event_id = $1`,
    [eventId],
  );
  const row = existing.rows[0] as { status?: string } | undefined;

  if (row?.status === "succeeded") {
    return "duplicate_succeeded";
  }

  if (row?.status === "failed") {
    return "duplicate_failed";
  }

  return "duplicate_processing";
}

export async function markStripeWebhookEventSucceeded(eventId: string): Promise<void> {
  await ensureStripeWebhookEventsTable();
  await pool.query(
    `UPDATE stripe_webhook_events
       SET status = 'succeeded', processed_at = NOW(), error = NULL, updated_at = NOW()
     WHERE event_id = $1`,
    [eventId],
  );
}

export async function markStripeWebhookEventFailed(eventId: string, error: unknown): Promise<void> {
  await ensureStripeWebhookEventsTable();
  const message = error instanceof Error ? error.message : String(error);
  await pool.query(
    `UPDATE stripe_webhook_events
       SET status = 'failed', error = $2, updated_at = NOW()
     WHERE event_id = $1`,
    [eventId, message.slice(0, 1000)],
  );
}
