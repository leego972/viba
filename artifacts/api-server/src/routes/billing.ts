import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  getStripe,
  isStripeConfigured,
  getBillingPriceId,
  getBillingStatus,
  getCreditTransactions,
  VIBA_PLAN,
} from "../lib/billing";

const router: IRouter = Router();

const MONTHLY_CREDITS = 1500;
const TRIAL_DAILY_CREDITS = 500;
const TOP_UP_PACK = {
  key: "credits_1500",
  label: "1,500 Credit Pack",
  description: "1,500 credits",
  credits: 1500,
  unitAmount: 5000,
  badge: "Another Month",
};

let cachedTopUpPriceId = "";

function origin(req: import("express").Request): string {
  return (
    (req.headers["origin"] as string | undefined) ??
    `${req.protocol}://${req.get("host")}`
  );
}

async function getTopUpPriceId(): Promise<string> {
  const configured = process.env["STRIPE_BILLING_CREDITS_1500_PRICE_ID"];
  if (configured) return configured;
  if (cachedTopUpPriceId) return cachedTopUpPriceId;

  const stripe = getStripe();
  const products = await stripe.products.list({ active: true, limit: 100 });
  let product = products.data.find((item) => item.name === "VIBA 1,500 Credit Pack");
  if (!product) {
    product = await stripe.products.create({
      name: "VIBA 1,500 Credit Pack",
      description: "1,500 VIBA credits — one-time top-up pack",
      metadata: { system: "viba_billing", type: "credit_pack", credits: String(TOP_UP_PACK.credits) },
    });
  }

  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 20 });
  let price = prices.data.find((item) => item.unit_amount === TOP_UP_PACK.unitAmount && !item.recurring);
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: TOP_UP_PACK.unitAmount,
      currency: "usd",
      metadata: { system: "viba_billing", type: "credit_pack", credits: String(TOP_UP_PACK.credits) },
    });
  }

  cachedTopUpPriceId = price.id;
  return cachedTopUpPriceId;
}

router.get("/billing/plans", (_req, res): void => {
  res.json({
    plan: {
      name: VIBA_PLAN.productName,
      unitAmount: VIBA_PLAN.unitAmount,
      currency: VIBA_PLAN.currency,
      monthlyCredits: MONTHLY_CREDITS,
      trialDays: VIBA_PLAN.trialDays,
      trialDailyCredits: TRIAL_DAILY_CREDITS,
      configured: isStripeConfigured() && !!getBillingPriceId(VIBA_PLAN.key),
    },
    creditPacks: [{
      key: TOP_UP_PACK.key,
      label: TOP_UP_PACK.label,
      description: TOP_UP_PACK.description,
      credits: TOP_UP_PACK.credits,
      unitAmount: TOP_UP_PACK.unitAmount,
      badge: TOP_UP_PACK.badge,
      configured: isStripeConfigured(),
    }],
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

  const priceId = getBillingPriceId(VIBA_PLAN.key);
  if (!priceId) {
    res.status(503).json({ error: "Membership price not provisioned yet — try again in a moment" });
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

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      ...(current.stripeCustomerId ? { customer: current.stripeCustomerId } : {}),
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: VIBA_PLAN.trialDays,
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
  if (parsed.data.packKey !== TOP_UP_PACK.key) { res.status(400).json({ error: "Unknown credit pack" }); return; }

  const current = await getBillingStatus(userId);

  try {
    const stripe = getStripe();
    const base = origin(req);
    const priceId = await getTopUpPriceId();

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
        credits: String(TOP_UP_PACK.credits),
        packKey: TOP_UP_PACK.key,
      },
      success_url: `${base}/billing?credits_added=${TOP_UP_PACK.credits}`,
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
