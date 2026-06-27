/**
 * VIBA Billing — Stripe integration
 *
 * $50/month membership — 7-day free trial, card captured upfront
 * 1,000 credits/month included
 * One-time credit top-up packs available when allowance runs out
 *
 * Adapted from leego972/virellestudios billing system (simplified for VIBA).
 */
import Stripe from "stripe";
import { pool } from "@workspace/db";
import { logger } from "./logger";

// ─── Stripe singleton ─────────────────────────────────────────────────────────
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!_stripe) {
    _stripe = new Stripe(key, {
      apiVersion: "2025-01-27.acacia" as Stripe.LatestApiVersion,
    });
  }
  return _stripe;
}

export function isStripeConfigured(): boolean {
  return !!process.env["STRIPE_SECRET_KEY"];
}

// ─── Plan definition ──────────────────────────────────────────────────────────

export const VIBA_PLAN = {
  key: "viba_monthly",
  priceEnvKey: "STRIPE_BILLING_SUBSCRIPTION_PRICE_ID",
  productName: "VIBA Member",
  description:
    "Full access to VIBA collaborative multi-agent orchestration. Includes 1,000 credits/month. 7-day free trial — card required.",
  unitAmount: 5000, // $50.00 USD in cents
  currency: "usd",
  monthlyCredits: 1000,
  trialDays: 7,
} as const;

// ─── Credit pack definitions ──────────────────────────────────────────────────

export interface CreditPack {
  key: string;
  priceEnvKey: string;
  label: string;
  description: string;
  credits: number;
  unitAmount: number; // USD cents
  badge?: string;
}

export const CREDIT_PACKS: CreditPack[] = [
  {
    key: "credits_200",
    priceEnvKey: "STRIPE_BILLING_CREDITS_200_PRICE_ID",
    label: "Starter Pack",
    description: "200 credits",
    credits: 200,
    unitAmount: 900, // $9
  },
  {
    key: "credits_500",
    priceEnvKey: "STRIPE_BILLING_CREDITS_500_PRICE_ID",
    label: "Pro Pack",
    description: "500 credits",
    credits: 500,
    unitAmount: 1900, // $19
    badge: "Popular",
  },
  {
    key: "credits_1200",
    priceEnvKey: "STRIPE_BILLING_CREDITS_1200_PRICE_ID",
    label: "Power Pack",
    description: "1,200 credits",
    credits: 1200,
    unitAmount: 3900, // $39
  },
  {
    key: "credits_3000",
    priceEnvKey: "STRIPE_BILLING_CREDITS_3000_PRICE_ID",
    label: "Pro Max Pack",
    description: "3,000 credits",
    credits: 3000,
    unitAmount: 7900, // $79
    badge: "Best Value",
  },
];

// ─── In-memory price ID cache ─────────────────────────────────────────────────
const _priceCache: Record<string, string> = {};

export function getBillingPriceId(key: string): string {
  return _priceCache[key] ?? "";
}

// ─── Auto-provisioning (idempotent — safe on every restart) ──────────────────
export async function provisionStripeProducts(): Promise<void> {
  if (!isStripeConfigured()) {
    logger.warn("Stripe not configured — billing provisioning skipped");
    return;
  }

  const stripe = getStripe();

  // ── Membership subscription price ────────────────────────────────────────
  const subsEnvVal = process.env[VIBA_PLAN.priceEnvKey];
  if (subsEnvVal) {
    _priceCache[VIBA_PLAN.key] = subsEnvVal;
    logger.info({ priceId: subsEnvVal }, "Billing: membership price from env");
  } else {
    const priceId = await findOrCreatePrice({
      stripe,
      productName: VIBA_PLAN.productName,
      productDesc: VIBA_PLAN.description,
      unitAmount: VIBA_PLAN.unitAmount,
      currency: VIBA_PLAN.currency,
      recurring: { interval: "month" },
      metadata: {
        system: "viba_billing",
        type: "subscription",
        credits: String(VIBA_PLAN.monthlyCredits),
      },
    });
    _priceCache[VIBA_PLAN.key] = priceId;
    logger.info({ priceId }, "Billing: membership price ready");
  }

  // ── Credit pack prices ────────────────────────────────────────────────────
  for (const pack of CREDIT_PACKS) {
    const envVal = process.env[pack.priceEnvKey];
    if (envVal) {
      _priceCache[pack.key] = envVal;
      logger.info({ key: pack.key, priceId: envVal }, "Billing: credit pack price from env");
      continue;
    }

    const priceId = await findOrCreatePrice({
      stripe,
      productName: `VIBA ${pack.label}`,
      productDesc: `${pack.description} — one-time top-up for VIBA`,
      unitAmount: pack.unitAmount,
      currency: "usd",
      metadata: {
        system: "viba_billing",
        type: "credit_pack",
        credits: String(pack.credits),
      },
    });
    _priceCache[pack.key] = priceId;
    logger.info({ key: pack.key, priceId }, "Billing: credit pack price ready");
  }
}

async function findOrCreatePrice(opts: {
  stripe: Stripe;
  productName: string;
  productDesc: string;
  unitAmount: number;
  currency: string;
  recurring?: { interval: "month" | "year" };
  metadata?: Record<string, string>;
}): Promise<string> {
  const { stripe, productName, productDesc, unitAmount, currency, recurring, metadata } = opts;

  // Find or create the product
  const products = await stripe.products.list({ active: true, limit: 100 });
  let product = products.data.find((p) => p.name === productName);
  if (!product) {
    product = await stripe.products.create({
      name: productName,
      description: productDesc,
      metadata: metadata ?? {},
    });
    logger.info({ productId: product.id, name: productName }, "Billing: created Stripe product");
  }

  // Find or create the price
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 20 });
  let price = prices.data.find(
    (p) =>
      p.unit_amount === unitAmount &&
      (recurring ? p.recurring?.interval === recurring.interval : !p.recurring),
  );
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: unitAmount,
      currency,
      ...(recurring ? { recurring } : {}),
      metadata: metadata ?? {},
    });
    logger.info({ priceId: price.id, productName }, "Billing: created Stripe price");
  }

  return price.id;
}

// ─── Credit management ────────────────────────────────────────────────────────

export async function grantCredits(
  userId: number,
  amount: number,
  reason: string,
): Promise<void> {
  const result = await pool.query(
    `UPDATE users SET credits_remaining = credits_remaining + $1, updated_at = NOW()
     WHERE id = $2 RETURNING credits_remaining`,
    [amount, userId],
  );
  const balanceAfter = (result.rows[0]?.credits_remaining as number) ?? 0;
  await pool.query(
    `INSERT INTO credit_transactions (user_id, amount, balance_after, reason)
     VALUES ($1, $2, $3, $4)`,
    [userId, amount, balanceAfter, reason],
  );
  logger.info({ userId, amount, balanceAfter, reason }, "Billing: credits granted");
}

/** Returns false when insufficient credits — atomically deducts only if balance allows */
export async function deductCredits(
  userId: number,
  amount: number,
  sessionId?: number,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE users SET credits_remaining = credits_remaining - $1, updated_at = NOW()
     WHERE id = $2 AND credits_remaining >= $1
     RETURNING credits_remaining`,
    [amount, userId],
  );
  if ((result.rowCount ?? 0) === 0) return false;
  const balanceAfter = (result.rows[0]?.credits_remaining as number) ?? 0;
  await pool.query(
    `INSERT INTO credit_transactions (user_id, amount, balance_after, reason, session_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, -amount, balanceAfter, "agent_run", sessionId ?? null],
  );
  logger.info({ userId, amount, balanceAfter, remaining: balanceAfter }, "Billing: credits deducted");
  return true;
}

export async function getCreditTransactions(
  userId: number,
  limit = 50,
): Promise<Array<{ id: number; amount: number; balanceAfter: number; reason: string; sessionId: number | null; createdAt: string }>> {
  const result = await pool.query(
    `SELECT id, amount, balance_after, reason, session_id, created_at
     FROM credit_transactions WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return result.rows.map((r) => ({
    id: r.id as number,
    amount: r.amount as number,
    balanceAfter: r.balance_after as number,
    reason: r.reason as string,
    sessionId: (r.session_id as number | null) ?? null,
    createdAt: (r.created_at as Date).toISOString(),
  }));
}

export async function getCredits(userId: number): Promise<number> {
  const result = await pool.query(
    `SELECT credits_remaining FROM users WHERE id = $1`,
    [userId],
  );
  return (result.rows[0]?.credits_remaining as number) ?? 0;
}

// ─── Subscription management ──────────────────────────────────────────────────

export async function linkSubscription(
  userId: number,
  customerId: string,
  subscriptionId: string,
  status: string,
  periodEnd: Date | null,
): Promise<void> {
  await pool.query(
    `UPDATE users SET
       stripe_customer_id     = $1,
       stripe_subscription_id = $2,
       subscription_status    = $3,
       credits_period_end     = $4,
       updated_at             = NOW()
     WHERE id = $5`,
    [customerId, subscriptionId, status, periodEnd, userId],
  );
  logger.info({ userId, customerId, subscriptionId, status }, "Billing: subscription linked");
}

export async function refreshMonthlyCredits(
  userId: number,
  periodEnd: Date | null,
): Promise<void> {
  await pool.query(
    `UPDATE users SET
       credits_remaining  = $1,
       credits_period_end = $2,
       subscription_status = 'active',
       updated_at          = NOW()
     WHERE id = $3`,
    [VIBA_PLAN.monthlyCredits, periodEnd, userId],
  );
  logger.info({ userId, credits: VIBA_PLAN.monthlyCredits }, "Billing: monthly credits refreshed");
}

export async function updateSubscriptionStatus(
  subscriptionId: string,
  status: string,
  periodEnd: Date | null,
): Promise<void> {
  await pool.query(
    `UPDATE users SET subscription_status = $1, credits_period_end = $2, updated_at = NOW()
     WHERE stripe_subscription_id = $3`,
    [status, periodEnd, subscriptionId],
  );
  logger.info({ subscriptionId, status }, "Billing: subscription status updated");
}

export async function getUserByStripeCustomer(
  customerId: string,
): Promise<{ id: number; email: string } | null> {
  const result = await pool.query(
    `SELECT id, email FROM users WHERE stripe_customer_id = $1`,
    [customerId],
  );
  return (result.rows[0] as { id: number; email: string }) ?? null;
}

export async function getUserByEmail(
  email: string,
): Promise<{
  id: number;
  email: string;
  stripe_customer_id: string | null;
} | null> {
  const result = await pool.query(
    `SELECT id, email, stripe_customer_id FROM users WHERE email = $1`,
    [email],
  );
  return (
    (result.rows[0] as {
      id: number;
      email: string;
      stripe_customer_id: string | null;
    }) ?? null
  );
}

export async function getBillingStatus(userId: number): Promise<{
  subscriptionStatus: string;
  creditsRemaining: number;
  creditsPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}> {
  const result = await pool.query(
    `SELECT subscription_status, credits_remaining, credits_period_end,
            stripe_customer_id, stripe_subscription_id
     FROM users WHERE id = $1`,
    [userId],
  );
  const row = result.rows[0] as
    | {
        subscription_status: string;
        credits_remaining: number;
        credits_period_end: Date | null;
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
      }
    | undefined;

  return {
    subscriptionStatus: row?.subscription_status ?? "none",
    creditsRemaining: row?.credits_remaining ?? 0,
    creditsPeriodEnd: row?.credits_period_end?.toISOString() ?? null,
    stripeCustomerId: row?.stripe_customer_id ?? null,
    stripeSubscriptionId: row?.stripe_subscription_id ?? null,
  };
}

// ─── Webhook idempotency (in-memory; survives typical deploys) ────────────────
const _processedWebhooks = new Map<string, number>();
const WEBHOOK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of _processedWebhooks) {
    if (now - ts > WEBHOOK_RETENTION_MS) _processedWebhooks.delete(id);
  }
}, 24 * 60 * 60 * 1000).unref();

export function isWebhookProcessed(id: string): boolean {
  return _processedWebhooks.has(id);
}
export function markWebhookProcessed(id: string): void {
  _processedWebhooks.set(id, Date.now());
}
