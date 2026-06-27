import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  getStripe,
  isStripeConfigured,
  getBillingPriceId,
  getBillingStatus,
  getCreditTransactions,
  VIBA_PLAN,
  CREDIT_PACKS,
} from "../lib/billing";

const router: IRouter = Router();

function origin(req: import("express").Request): string {
  return (
    (req.headers["origin"] as string | undefined) ??
    `${req.protocol}://${req.get("host")}`
  );
}

// GET /api/billing/plans — public: returns plan + credit pack metadata for the pricing page
router.get("/billing/plans", (_req, res): void => {
  res.json({
    plan: {
      name: VIBA_PLAN.productName,
      unitAmount: VIBA_PLAN.unitAmount,
      currency: VIBA_PLAN.currency,
      monthlyCredits: VIBA_PLAN.monthlyCredits,
      trialDays: VIBA_PLAN.trialDays,
      configured: isStripeConfigured() && !!getBillingPriceId(VIBA_PLAN.key),
    },
    creditPacks: CREDIT_PACKS.map((p) => ({
      key: p.key,
      label: p.label,
      description: p.description,
      credits: p.credits,
      unitAmount: p.unitAmount,
      badge: p.badge ?? null,
      configured: isStripeConfigured() && !!getBillingPriceId(p.key),
    })),
  });
});

// GET /api/billing/status — requires session
router.get("/billing/status", async (req, res): Promise<void> => {
  const userId = req.session?.userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const status = await getBillingStatus(userId);
  res.json(status);
});

// POST /api/billing/checkout — create Stripe subscription checkout (requires session)
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

  // Check if user already has an active subscription
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
        metadata: { system: "viba_billing", userId: String(userId) },
      },
      payment_method_collection: "always",
      client_reference_id: String(userId),
      metadata: { system: "viba_billing", type: "subscription", userId: String(userId) },
      success_url: `${base}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pricing`,
    });

    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "billing checkout error");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// POST /api/billing/credits/checkout — buy a one-time credit pack (requires session)
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

  const pack = CREDIT_PACKS.find((p) => p.key === parsed.data.packKey);
  if (!pack) { res.status(400).json({ error: "Unknown credit pack" }); return; }

  const priceId = getBillingPriceId(pack.key);
  if (!priceId) {
    res.status(503).json({ error: "Credit pack not provisioned yet — try again in a moment" });
    return;
  }

  const current = await getBillingStatus(userId);

  try {
    const stripe = getStripe();
    const base = origin(req);

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

// POST /api/billing/portal — open Stripe customer portal (requires active subscription)
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

// GET /api/billing/transactions — credit usage history for the current user
router.get("/billing/transactions", async (req, res): Promise<void> => {
  const userId = req.session?.userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const limitParam = Number(req.query["limit"]);
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 200 ? limitParam : 50;
  const txns = await getCreditTransactions(userId, limit);
  res.json({ transactions: txns });
});

export default router;
