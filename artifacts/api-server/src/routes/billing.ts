import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  getStripe,
  isStripeConfigured,
  getBillingStatus,
  getCreditTransactions,
  VIBA_PLAN,
} from "../lib/billing";

const router: IRouter = Router();

const MONTHLY_CREDITS = 1500;
const TRIAL_DAILY_CREDITS = 500;
const MONTHLY_PLAN = {
  productName: "VIBA Member Monthly",
  unitAmount: 5000,
  currency: "usd",
  credits: MONTHLY_CREDITS,
  trialDays: VIBA_PLAN.trialDays,
};

const TOP_UP_PACKS = [
  { key: "credits_1000", label: "1,000 Credit Pack", description: "1,000 credits", credits: 1000, unitAmount: 5000, badge: "$50" },
  { key: "credits_2000", label: "2,000 Credit Pack", description: "2,000 credits", credits: 2000, unitAmount: 10000, badge: "$100" },
  { key: "credits_3000", label: "3,000 Credit Pack", description: "3,000 credits", credits: 3000, unitAmount: 15000, badge: "$150" },
  { key: "credits_4000", label: "4,000 Credit Pack", description: "4,000 credits", credits: 4000, unitAmount: 20000, badge: "$200" },
  { key: "credits_5000", label: "5,000 Credit Pack", description: "5,000 credits", credits: 5000, unitAmount: 25000, badge: "$250" },
  { key: "credits_6000", label: "6,000 Credit Pack", description: "6,000 credits", credits: 6000, unitAmount: 30000, badge: "$300" },
] as const;

type TopUpPack = (typeof TOP_UP_PACKS)[number];

let cachedMonthlyPriceId = "";
const cachedTopUpPriceIds: Record<string, string> = {};

function origin(req: import("express").Request): string {
  return (
    (req.headers["origin"] as string | undefined) ??
    `${req.protocol}://${req.get("host")}`
  );
}

async function getMonthlyPriceId(): Promise<string> {
  const configured = process.env["STRIPE_BILLING_SUBSCRIPTION_PRICE_ID"];
  if (configured) return configured;
  if (cachedMonthlyPriceId) return cachedMonthlyPriceId;

  const stripe = getStripe();
  const products = await stripe.products.list({ active: true, limit: 100 });
  let product = products.data.find((item) => item.name === MONTHLY_PLAN.productName);
  if (!product) {
    product = await stripe.products.create({
      name: MONTHLY_PLAN.productName,
      description: "Monthly VIBA membership with 1,500 credits per month.",
      metadata: { system: "viba_billing", type: "subscription", credits: String(MONTHLY_PLAN.credits), trialDailyCredits: String(TRIAL_DAILY_CREDITS) },
    });
  }

  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 20 });
  let price = prices.data.find((item) => item.unit_amount === MONTHLY_PLAN.unitAmount && item.recurring?.interval === "month");
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: MONTHLY_PLAN.unitAmount,
      currency: MONTHLY_PLAN.currency,
      recurring: { interval: "month" },
      metadata: { system: "viba_billing", type: "subscription", credits: String(MONTHLY_PLAN.credits), trialDailyCredits: String(TRIAL_DAILY_CREDITS) },
    });
  }

  cachedMonthlyPriceId = price.id;
  return cachedMonthlyPriceId;
}

function envKeyForTopUp(pack: TopUpPack): string {
  return `STRIPE_BILLING_CREDITS_${pack.credits}_PRICE_ID`;
}

async function getTopUpPriceId(pack: TopUpPack): Promise<string> {
  const configured = process.env[envKeyForTopUp(pack)];
  if (configured) return configured;
  if (cachedTopUpPriceIds[pack.key]) return cachedTopUpPriceIds[pack.key]!;

  const stripe = getStripe();
  const productName = `VIBA ${pack.label}`;
  const products = await stripe.products.list({ active: true, limit: 100 });
  let product = products.data.find((item) => item.name === productName);
  if (!product) {
    product = await stripe.products.create({
      name: productName,
      description: `${pack.description} — VIBA one-time top-up pack`,
      metadata: { system: "viba_billing", type: "credit_pack", credits: String(pack.credits), packKey: pack.key },
    });
  }

  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 20 });
  let price = prices.data.find((item) => item.unit_amount === pack.unitAmount && !item.recurring);
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: pack.unitAmount,
      currency: "usd",
      metadata: { system: "viba_billing", type: "credit_pack", credits: String(pack.credits), packKey: pack.key },
    });
  }

  cachedTopUpPriceIds[pack.key] = price.id;
  return price.id;
}

router.get("/billing/plans", (_req, res): void => {
  res.json({
    plan: {
      name: MONTHLY_PLAN.productName,
      unitAmount: MONTHLY_PLAN.unitAmount,
      currency: MONTHLY_PLAN.currency,
      monthlyCredits: MONTHLY_CREDITS,
      trialDays: MONTHLY_PLAN.trialDays,
      trialDailyCredits: TRIAL_DAILY_CREDITS,
      configured: isStripeConfigured(),
    },
    creditPacks: TOP_UP_PACKS.map((pack) => ({
      key: pack.key,
      label: pack.label,
      description: pack.description,
      credits: pack.credits,
      unitAmount: pack.unitAmount,
      badge: pack.badge,
      configured: isStripeConfigured(),
    })),
  });
});

router.get("/billing/status", async (req, res): Promise<void> => {
  const userId = req.session?.userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const status = await getBillingStatus(userId);
  res.json(status);
});

router.post("/billing/checkout", async (req, res): Promise<void> => {
  const userId = req.session?.userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Stripe is not configured on this deployment" });
    return;
  }

  const current = await getBillingStatus(userId);
  if (current.subscriptionStatus === "active" || current.subscriptionStatus === "trialing") {
    res.status(409).json({ error: "You already have an active subscription" });
    return;
  }

  try {
    const stripe = getStripe();
    const base = origin(req);
    const priceId = await getMonthlyPriceId();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      ...(current.stripeCustomerId ? { customer: current.stripeCustomerId } : {}),
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: MONTHLY_PLAN.trialDays,
        metadata: { system: "viba_billing", userId: String(userId), credits: String(MONTHLY_CREDITS), trialDailyCredits: String(TRIAL_DAILY_CREDITS) },
      },
      payment_method_collection: "always",
      client_reference_id: String(userId),
      metadata: { system: "viba_billing", type: "subscription", userId: String(userId), credits: String(MONTHLY_CREDITS), trialDailyCredits: String(TRIAL_DAILY_CREDITS) },
      success_url: `${base}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pricing`,
    });

    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "billing checkout error");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

const CreditPackBody = z.object({ packKey: z.string().min(1) });

router.post("/billing/credits/checkout", async (req, res): Promise<void> => {
  const userId = req.session?.userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Stripe is not configured" });
    return;
  }

  const parsed = CreditPackBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "packKey is required" }); return; }
  const pack = TOP_UP_PACKS.find((item) => item.key === parsed.data.packKey);
  if (!pack) { res.status(400).json({ error: "Unknown credit pack" }); return; }

  const current = await getBillingStatus(userId);

  try {
    const stripe = getStripe();
    const base = origin(req);
    const priceId = await getTopUpPriceId(pack);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      ...(current.stripeCustomerId ? { customer: current.stripeCustomerId } : {}),
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: String(userId),
      metadata: {
        system: "viba_billing",
        type: "credit_pack",
        userId: String(userId),
        credits: String(pack.credits),
        packKey: pack.key,
      },
      success_url: `${base}/billing?credits_added=${pack.credits}`,
      cancel_url: `${base}/billing`,
    });

    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "billing credits checkout error");
    res.status(500).json({ error: "Failed to create credit checkout session" });
  }
});

router.post("/billing/portal", async (req, res): Promise<void> => {
  const userId = req.session?.userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Stripe is not configured" });
    return;
  }

  const { stripeCustomerId } = await getBillingStatus(userId);
  if (!stripeCustomerId) {
    res.status(404).json({ error: "No billing account found — subscribe first" });
    return;
  }

  try {
    const stripe = getStripe();
    const base = origin(req);

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${base}/billing`,
    });

    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "billing portal error");
    res.status(500).json({ error: "Failed to create portal session" });
  }
});

router.get("/billing/transactions", async (req, res): Promise<void> => {
  const userId = req.session?.userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const limitParam = Number(req.query["limit"]);
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 200 ? limitParam : 50;
  const txns = await getCreditTransactions(userId, limit);
  res.json({ transactions: txns });
});

export default router;
