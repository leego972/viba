import { Router, type IRouter } from "express";
import { getStripe, getBillingStatus, isStripeConfigured, VIBA_PLAN } from "../lib/billing";

const router: IRouter = Router();

const ANNUAL = {
  key: "viba_annual",
  priceEnvKey: "STRIPE_BILLING_ANNUAL_PRICE_ID",
  productName: "VIBA Member Annual",
  unitAmount: 60000,
  currency: "usd",
  credits: 23400,
  trialDays: VIBA_PLAN.trialDays,
};

let cachedAnnualPriceId = "";

function origin(req: import("express").Request): string {
  return (req.headers["origin"] as string | undefined) ?? `${req.protocol}://${req.get("host")}`;
}

async function annualPriceId(): Promise<string> {
  const configured = process.env[ANNUAL.priceEnvKey];
  if (configured) return configured;
  if (cachedAnnualPriceId) return cachedAnnualPriceId;

  const stripe = getStripe();
  const products = await stripe.products.list({ active: true, limit: 100 });
  let product = products.data.find((item) => item.name === ANNUAL.productName);
  if (!product) {
    product = await stripe.products.create({
      name: ANNUAL.productName,
      description: "Annual VIBA membership with 23,400 credits per year, including a 30 percent credit bonus.",
      metadata: { system: "viba_billing", type: "subscription", planKey: ANNUAL.key, credits: String(ANNUAL.credits) },
    });
  }

  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 20 });
  let price = prices.data.find((item) => item.unit_amount === ANNUAL.unitAmount && item.recurring?.interval === "year");
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: ANNUAL.unitAmount,
      currency: ANNUAL.currency,
      recurring: { interval: "year" },
      metadata: { system: "viba_billing", type: "subscription", planKey: ANNUAL.key, credits: String(ANNUAL.credits) },
    });
  }

  cachedAnnualPriceId = price.id;
  return cachedAnnualPriceId;
}

router.post("/billing/checkout/annual", async (req, res): Promise<void> => {
  const userId = req.session?.userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!isStripeConfigured()) { res.status(503).json({ error: "Stripe is not configured" }); return; }

  const current = await getBillingStatus(userId);
  if (current.subscriptionStatus === "active" || current.subscriptionStatus === "trialing") {
    res.status(409).json({ error: "You already have an active subscription" });
    return;
  }

  try {
    const stripe = getStripe();
    const base = origin(req);
    const priceId = await annualPriceId();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(current.stripeCustomerId ? { customer: current.stripeCustomerId } : {}),
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: ANNUAL.trialDays,
        metadata: { system: "viba_billing", userId: String(userId), planKey: ANNUAL.key, credits: String(ANNUAL.credits) },
      },
      payment_method_collection: "always",
      client_reference_id: String(userId),
      metadata: { system: "viba_billing", type: "subscription", userId: String(userId), planKey: ANNUAL.key, credits: String(ANNUAL.credits) },
      success_url: `${base}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pricing`,
    });

    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "annual checkout error");
    res.status(500).json({ error: "Failed to create annual checkout session" });
  }
});

export default router;
