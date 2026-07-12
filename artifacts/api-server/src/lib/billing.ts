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

// ─── Plan definitions ─────────────────────────────────────────────────────────

/** Legacy plan — kept for backward compat */
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

export const BASIC_PLAN = {
  key: "basic_assessment",
  priceEnvKey: "STRIPE_BILLING_BASIC_PRICE_ID",
  productName: "VIBA Basic Assessment",
  description:
    "Automated website and code quality assessment. 750 credits/month. Scans, audits, and QA reports. 7-day free trial — card required.",
  unitAmount: 2500, // $25.00 USD
  currency: "usd",
  monthlyCredits: 750,
  trialDays: 7,
} as const;

export const PRO_PLAN = {
  key: "pro_repair",
  priceEnvKey: "STRIPE_BILLING_PRO_PRICE_ID",
  productName: "VIBA Pro Repair",
  description:
    "Full repair, multi-agent collaboration, deep security, and client proof reports. 4,000 credits/month. 7-day free trial — card required.",
  unitAmount: 8900, // $89.00 USD
  currency: "usd",
  monthlyCredits: 4000,
  trialDays: 7,
} as const;

/** All subscription plans — keyed for lookup */
export const ALL_PLANS = {
  viba_monthly: VIBA_PLAN,
  basic_assessment: BASIC_PLAN,
  pro_repair: PRO_PLAN,
} as const;

export type SubscriptionPlanKey = keyof typeof ALL_PLANS;

export function getPlanByKey(key: string) {
  return ALL_PLANS[key as SubscriptionPlanKey] ?? null;
}

export function getMonthlyCreditsForPlan(planKey: string): number {
  return getPlanByKey(planKey)?.monthlyCredits ?? VIBA_PLAN.monthlyCredits;
}

// ─── Credit pack definitions ──────────────────────────────────────────────────

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

  // ── Membership subscription prices ────────────────────────────────────────
  for (const plan of [VIBA_PLAN, BASIC_PLAN, PRO_PLAN]) {
    const envVal = process.env[plan.priceEnvKey];
    if (envVal) {
      _priceCache[plan.key] = envVal;
      logger.info({ key: plan.key, priceId: envVal }, "Billing: plan price from env");
      continue;
    }
    const priceId = await findOrCreatePrice({
      stripe,
      productName: plan.productName,
      productDesc: plan.description,
      unitAmount: plan.unitAmount,
      currency: plan.currency,
      recurring: { interval: "month" },
      metadata: {
        system: "viba_billing",
        type: "subscription",
        credits: String(plan.monthlyCredits),
        planKey: plan.key,
      },
    });
    _priceCache[plan.key] = priceId;
    logger.info({ key: plan.key, priceId }, "Billing: plan price ready");
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
  planKey = "viba_monthly",
): Promise<void> {
  await pool.query(
    `UPDATE users SET
       stripe_customer_id     = $1,
       stripe_subscription_id = $2,
       subscription_status    = $3,
       credits_period_end     = $4,
       plan_key               = $6,
       updated_at             = NOW()
     WHERE id = $5`,
    [customerId, subscriptionId, status, periodEnd, userId, planKey],
  );
  logger.info({ userId, customerId, subscriptionId, status, planKey }, "Billing: subscription linked");
}

export async function refreshMonthlyCredits(
  userId: number,
  periodEnd: Date | null,
  planKey?: string,
): Promise<void> {
  const credits = getMonthlyCreditsForPlan(planKey ?? "viba_monthly");
  await pool.query(
    `UPDATE users SET
       credits_remaining  = $1,
       credits_period_end = $2,
       subscription_status = 'active',
       updated_at          = NOW()
     WHERE id = $3`,
    [credits, periodEnd, userId],
  );
  logger.info({ userId, credits, planKey }, "Billing: monthly credits refreshed");
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
  planKey: string;
}> {
  await ensureDailyTrialCredits(userId);
  const result = await pool.query(
    `SELECT subscription_status, credits_remaining, credits_period_end,
            stripe_customer_id, stripe_subscription_id,
            COALESCE(plan_key, 'viba_monthly') AS plan_key
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
        plan_key: string;
      }
    | undefined;

  return {
    subscriptionStatus: row?.subscription_status ?? "none",
    creditsRemaining: row?.credits_remaining ?? 0,
    creditsPeriodEnd: row?.credits_period_end?.toISOString() ?? null,
    stripeCustomerId: row?.stripe_customer_id ?? null,
    stripeSubscriptionId: row?.stripe_subscription_id ?? null,
    planKey: row?.plan_key ?? "viba_monthly",
  };
}

// ─── Auto top-up config ────────────────────────────────────────────────────────

export interface AutoTopupConfig {
  enabled: boolean;
  threshold: number;   // credits below which a top-up is triggered
  packKey: string;     // which credit pack to buy
}

export async function getAutoTopupConfig(userId: number): Promise<AutoTopupConfig> {
  const result = await pool.query(
    `SELECT auto_topup_enabled, auto_topup_threshold, auto_topup_pack_key FROM users WHERE id = $1`,
    [userId],
  );
  const row = result.rows[0] as {
    auto_topup_enabled: boolean;
    auto_topup_threshold: number;
    auto_topup_pack_key: string | null;
  } | undefined;
  return {
    enabled: row?.auto_topup_enabled ?? false,
    threshold: row?.auto_topup_threshold ?? 100,
    packKey: row?.auto_topup_pack_key ?? "",
  };
}

export async function setAutoTopupConfig(userId: number, config: AutoTopupConfig): Promise<void> {
  await pool.query(
    `UPDATE users SET auto_topup_enabled = $1, auto_topup_threshold = $2, auto_topup_pack_key = $3, updated_at = NOW() WHERE id = $4`,
    [config.enabled, config.threshold, config.packKey || null, userId],
  );
}

/**
 * Called after every credit deduction. If the user's balance has dropped below
 * their auto top-up threshold and they have a saved payment method, this fires
 * a Stripe PaymentIntent off-session to charge and top up automatically.
 *
 * Fire-and-forget safe: errors are logged but never propagate to the caller.
 */
export async function triggerAutoTopupIfNeeded(userId: number, balanceAfter: number): Promise<void> {
  if (!isStripeConfigured()) return;

  try {
    const config = await getAutoTopupConfig(userId);
    if (!config.enabled || !config.packKey) return;
    if (balanceAfter > config.threshold) return;

    const pack = CREDIT_PACKS.find((p) => p.key === config.packKey);
    if (!pack) {
      logger.warn({ userId, packKey: config.packKey }, "Auto top-up: unknown pack key — skipping");
      return;
    }

    const priceId = getBillingPriceId(pack.key);
    if (!priceId) {
      logger.warn({ userId, packKey: pack.key }, "Auto top-up: price not provisioned — skipping");
      return;
    }

    // Get the customer's saved payment method from their active subscription
    const billing = await getBillingStatus(userId);
    if (!billing.stripeCustomerId) {
      logger.warn({ userId }, "Auto top-up: no Stripe customer — skipping");
      return;
    }

    const stripe = getStripe();

    // Retrieve the customer's default payment method via their subscription
    let paymentMethodId: string | null = null;
    if (billing.stripeSubscriptionId) {
      const sub = await stripe.subscriptions.retrieve(billing.stripeSubscriptionId);
      const pmFromSub = sub.default_payment_method;
      if (typeof pmFromSub === "string") paymentMethodId = pmFromSub;
      else if (pmFromSub && typeof pmFromSub === "object") paymentMethodId = pmFromSub.id;
    }

    // Fallback 1: customer's default payment method (set by customer_update in checkout)
    if (!paymentMethodId) {
      const customer = await stripe.customers.retrieve(billing.stripeCustomerId);
      if (!customer.deleted) {
        const pm = customer.invoice_settings?.default_payment_method;
        if (typeof pm === "string") paymentMethodId = pm;
        else if (pm && typeof pm === "object") paymentMethodId = pm.id;
      }
    }

    // Fallback 2: list the customer's attached payment methods and take the first card
    if (!paymentMethodId) {
      const pms = await stripe.paymentMethods.list({
        customer: billing.stripeCustomerId,
        type: "card",
        limit: 1,
      });
      paymentMethodId = pms.data[0]?.id ?? null;
    }

    if (!paymentMethodId) {
      logger.warn({ userId }, "Auto top-up: no payment method found on customer — skipping");
      return;
    }

    // Create and confirm a PaymentIntent off-session
    const paymentIntent = await stripe.paymentIntents.create({
      amount: pack.unitAmount,
      currency: "usd",
      customer: billing.stripeCustomerId,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      metadata: {
        system: "viba_billing",
        type: "auto_topup",
        userId: String(userId),
        credits: String(pack.credits),
        packKey: pack.key,
        triggeredAtBalance: String(balanceAfter),
      },
      description: `VIBA auto top-up: ${pack.description}`,
    });

    // Always rely on the payment_intent.succeeded webhook to grant credits.
    // Granting here AND in the webhook would cause a double-grant.
    // The webhook fires within seconds even when the PI succeeds immediately.
    logger.info(
      { userId, packKey: pack.key, credits: pack.credits, paymentIntentId: paymentIntent.id, status: paymentIntent.status },
      "Auto top-up: PaymentIntent created — credits will be granted via webhook",
    );
  } catch (err: unknown) {
    // Insufficient funds, card declined, etc — log but never throw
    const code = (err as { code?: string }).code;
    logger.warn({ err, userId, code }, "Auto top-up: charge failed (card declined or 3DS required)");
  }
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
