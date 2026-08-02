import { pool } from "@workspace/db";
import { getStripeClient } from "./stripe/client";

export async function fulfillMarketplaceCheckout(checkoutSessionId: string): Promise<{
  inventoryId: number;
  moduleId: number;
  alreadyOwned: boolean;
}> {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
  const meta = session.metadata ?? {};

  if (meta["system"] !== "viba_marketplace" || meta["type"] !== "module_purchase") {
    throw new Error("Checkout session is not a VIBA marketplace purchase");
  }
  if (session.payment_status !== "paid") {
    throw new Error(`Marketplace payment is not complete (${session.payment_status})`);
  }

  const buyerUserId = Number(meta["buyerUserId"]);
  const moduleId = Number(meta["moduleId"]);
  const sellerId = Number(meta["sellerId"]);
  if (![buyerUserId, moduleId, sellerId].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error("Marketplace checkout metadata is invalid");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const purchaseResult = await client.query<{
      id: number;
      status: string;
      amount_cents: number;
      platform_fee_cents: number;
      seller_net_cents: number;
    }>(
      `SELECT id, status, amount_cents, platform_fee_cents, seller_net_cents
         FROM marketplace_purchases
        WHERE stripe_checkout_session_id = $1
        FOR UPDATE`,
      [checkoutSessionId],
    );
    const purchase = purchaseResult.rows[0];
    if (!purchase) throw new Error("Marketplace purchase record was not found");

    const moduleResult = await client.query<{
      id: number;
      version: string;
      license: string;
      name: string;
    }>(
      `SELECT id, version, license, name
         FROM marketplace_modules
        WHERE id = $1 AND seller_id = $2
        FOR UPDATE`,
      [moduleId, sellerId],
    );
    const module = moduleResult.rows[0];
    if (!module) throw new Error("Marketplace module was not found");

    const existing = await client.query<{ id: number }>(
      `SELECT id FROM user_module_inventory WHERE user_id = $1 AND module_id = $2 LIMIT 1`,
      [buyerUserId, moduleId],
    );
    let inventoryId = existing.rows[0]?.id;
    const alreadyOwned = Boolean(inventoryId);

    if (!inventoryId) {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO user_module_inventory
           (user_id, module_id, purchase_id, acquired_via, license_snapshot, version_owned)
         VALUES ($1,$2,$3,'purchase',$4::jsonb,$5)
         RETURNING id`,
        [buyerUserId, moduleId, purchase.id, JSON.stringify({ license: module.license, moduleName: module.name }), module.version],
      );
      inventoryId = inserted.rows[0]!.id;
    }

    if (purchase.status !== "completed") {
      await client.query(
        `UPDATE marketplace_purchases
            SET status = 'completed', stripe_payment_intent_id = $1, completed_at = NOW()
          WHERE id = $2`,
        [typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null, purchase.id],
      );
      await client.query(
        `UPDATE marketplace_modules SET total_sales = total_sales + 1, updated_at = NOW() WHERE id = $1`,
        [moduleId],
      );
      await client.query(
        `UPDATE marketplace_sellers
            SET total_sales = total_sales + 1,
                total_revenue_cents = total_revenue_cents + $1,
                updated_at = NOW()
          WHERE id = $2`,
        [purchase.seller_net_cents, sellerId],
      );
    }

    await client.query("COMMIT");
    return { inventoryId: inventoryId!, moduleId, alreadyOwned };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
