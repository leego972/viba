import Stripe from "stripe";
import { pool } from "@workspace/db";
import { logger } from "./logger";

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

export const VIBA_CREDIT_ECONOMICS = {
  standardWebsiteAuditCredits: 220,
  smallRepairCredits: 90,
  typicalSmallRepairCount: 3,
  fullAuditRepairEstimateCredits: 580,
  trialCreditsDaily: 500,
  monthlyCredits: 1000,
  annualCredits: 15600,
  topUpCredits: 1000,
  topUpUnitAmount: 5000,
} as const;

export const VIBA_PLAN = {
  key: "viba_monthly",
  priceEnvKey: "STRIPE_BILLING_SUBSCRIPTION_PRICE_ID",
  productName: "VIBA Member",
  description:
    "Full access to VIBA collaborative multi-agent orchestration. Includes 1,000 credits/month and a 3-day trial with 500 daily credits.",
  unitAmount: 5000,
  currency: "usd",
  monthlyCredits: VIBA_CREDIT_ECONOMICS.monthlyCredits,
  trialDays: 3,
  trialCredits: VIBA_CREDIT_ECONOMICS.trialCreditsDaily,
} as const;

export interface CreditPack {
  key: string;
  priceEnvKey: string;
  label: string;
  description: string;
  credits: number;
  unitAmount: number;
  badge?: string;
}

export const CREDIT_PACKS: CreditPack[] = [
  {
    key: "credits_1000",
    priceEnvKey: "STRIPE_BILLING_CREDITS_1000_PRICE_ID",
    label: "1,000 Credit Pack",
    description: "1,000 credits",
    credits: VIBA_CREDIT_ECONOMICS.topUpCredits,
    unitAmount: VIBA_CREDIT_ECONOMICS.topUpUnitAmount,
    badge: "Another Month",
  },
];

const _priceCache: Record<string, string> = {};

export function getBillingPriceId(key: string): string {
  return _priceCache[key] ?? "";
}

export async function provisionStripeProducts(): Promise<void> {
  if (!isStripeConfigured()) {
    logger.warn("Stripe not configured — billing provisioning skipped");
    return;
  }

  const stripe = getStripe();

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
        trialDays: String(VIBA_PLAN.trialDays),
        trialCreditsDaily: String(VIBA_PLAN.trialCredits),
      },
    });
    _priceCache[VIBA_PLAN.key] = priceId;
    logger.info({ priceId }, "Billing: membership price ready");
  }

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
      productDesc: `${pack.description} — VIBA add-on`,
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

async function ensureDailyTrialCredits(userId: number): Promise<void> {
  const userResult = await pool.query<{
    subscription_status: string | null;
    credits_period_end: Date | null;
    credits_remaining: number;
  }>(
    `SELECT subscription_status, credits_period_end, credits_remaining
     FROM users WHERE id = $1`,
    [userId],
  );
  const user = userResult.rows[0];
  if (!user || user.subscription_status !== "trialing") return;
  if (user.credits_period_end && user.credits_period_end.getTime() < Date.now()) return;

  const resetCheck = await pool.query(
    `SELECT id FROM credit_transactions
     WHERE user_id = $1
       AND reason = 'trial_daily_reset'
       AND created_at >= date_trunc('day', NOW())
     LIMIT 1`,
    [userId],
  );
  if ((resetCheck.rowCount ?? 0) > 0) return;

  const newBalance = VIBA_CREDIT_ECONOMICS.trialCreditsDaily;
  const delta = newBalance - (user.credits_remaining ?? 0);
  await pool.query(
    `UPDATE users SET credits_remaining = $1, updated_at = NOW()
     WHERE id = $2`,
    [newBalance, userId],
  );
  await pool.query(
    `INSERT INTO credit_transactions (user_id, amount, balance_after, reason)
     VALUES ($1, $2, $3, $4)`,
    [userId, delta, newBalance, "trial_daily_reset"],
  );
  logger.info({ userId, balanceAfter: newBalance }, "Billing: trial credits reset for the day");
}

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

export async function deductCredits(
  userId: number,
  amount: number,
  sessionId?: number,
): Promise<boolean> {
  await ensureDailyTrialCredits(userId);
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
  await ensureDailyTrialCredits(userId);
  const result = await pool.query(
    `SELECT credits_remaining FROM users WHERE id = $1`,
    [userId],
  );
  return (result.rows[0]?.credits_remaining as number) ?? 0;
}

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
  await pool.query(
    `INSERT INTO credit_transactions (user_id, amount, balance_after, reason)
     VALUES ($1, $2, $3, $4)`,
    [userId, VIBA_PLAN.monthlyCredits, VIBA_PLAN.monthlyCredits, "monthly_allowance_reset"],
  );
  logger.info({ userId, credits: VIBA_PLAN.monthlyCredits }, "Billing: monthly credits reset");
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
  await ensureDailyTrialCredits(userId);
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
