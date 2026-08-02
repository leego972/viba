import { pool } from "@workspace/db";
import { logger } from "./logger";
import { isStripeConfigured } from "./stripe/client";
import { fulfillMarketplaceCheckout } from "./marketplaceFulfillment";
import { ensureMarketplaceSchema } from "./marketplaceBootstrap";

const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
let running = false;
let timersStarted = false;

export async function reconcileMarketplacePurchases(): Promise<void> {
  if (running || !isStripeConfigured()) return;
  running = true;
  try {
    await ensureMarketplaceSchema();
    const { rows } = await pool.query<{ stripe_checkout_session_id: string }>(
      `SELECT stripe_checkout_session_id
         FROM marketplace_purchases
        WHERE status = 'pending'
          AND stripe_checkout_session_id IS NOT NULL
          AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at ASC
        LIMIT 50`,
    );
    for (const row of rows) {
      try {
        await fulfillMarketplaceCheckout(row.stripe_checkout_session_id);
        logger.info({ checkoutSessionId: row.stripe_checkout_session_id }, "Marketplace purchase reconciled");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("not complete")) {
          logger.warn({ checkoutSessionId: row.stripe_checkout_session_id, error: message }, "Marketplace reconciliation skipped purchase");
        }
      }
    }
  } catch (error) {
    logger.error({ error }, "Marketplace reconciliation cycle failed");
  } finally {
    running = false;
  }
}

export function startMarketplaceReconciler(): void {
  if (timersStarted || process.env.NODE_ENV === "test") return;
  timersStarted = true;
  setTimeout(() => { void reconcileMarketplacePurchases(); }, 20_000).unref();
  setInterval(() => { void reconcileMarketplacePurchases(); }, RECONCILE_INTERVAL_MS).unref();
}
