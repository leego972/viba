import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  getStripe,
  isStripeConfigured,
  getBillingStatus,
  getCreditTransactions,
  getAutoTopupConfig,
  setAutoTopupConfig,
  VIBA_PLAN,
  BASIC_PLAN,
  PRO_PLAN,
  CREDIT_PACKS,
  getPlanByKey,
} from "../lib/billing";

const router: IRouter = Router();

const TRIAL_DAILY_CREDITS = 500;
const SUBSCRIPTION_PLANS = [
  {
    key: "viba_member",
    productName: "VIBA Member Monthly",
    displayName: "VIBA Member",
    unitAmount: 5000,
    currency: "usd",
    credits: 1500,
    trialDays: VIBA_PLAN.trialDays,
    badge: "Member",
  },
  {
    key: "viba_pro",
    productName: "VIBA Pro Monthly",
    displayName: "VIBA Pro",
    unitAmount: 15000,
    currency: "usd",
    credits: 6000,
    trialDays: VIBA_PLAN.trialDays,
    badge: "Best Value",
  },
] as const;

const DEFAULT_PLAN = SUBSCRIPTION_PLANS[0];
const PRO_PLAN = SUBSCRIPTION_PLANS[1];
type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

const TOP_UP_PACKS = [
  { key: "credits_1000", label: "1,000 Credit Pack", description: "1,000 credits", credits: 1000, unitAmount: 5000, badge: "$50" },
  { key: "credits_2000", label: "2,000 Credit Pack", description: "2,000 credits", credits: 2000, unitAmount: 10000, badge: "$100" },
  { key: "credits_3000", label: "3,000 Credit Pack", description: "3,000 credits", credits: 3000, unitAmount: 15000, badge: "$150" },
  { key: "credits_4000", label: "4,000 Credit Pack", description: "4,000 credits", credits: 4000, unitAmount: 20000, badge: "$200" },
  { key: "credits_5000", label: "5,000 Credit Pack", description: "5,000 credits", credits: 5000, unitAmount: 25000, badge: "$250" },
  { key: "credits_6000", label: "6,000 Credit Pack", description: "6,000 credits", credits: 6000, unitAmount: 30000, badge: "$300" },
] as const;

type TopUpPack = (typeof TOP_UP_PACKS)[number];

const cachedSubscriptionPriceIds: Record<string, string> = {};
const cachedTopUpPriceIds: Record<string, string> = {};

function origin(req: import("express").Request): string {
  return (
    (req.headers["origin"] as string | undefined) ??
    `${req.protocol}://${req.get("host")}`
  );
}

// GET /api/billing/plans — public: returns all plans + credit pack metadata for the pricing page
router.get("/billing/plans", (_req, res): void => {
  res.json({
    // Legacy field kept for backward compat
    plan: {
      name: DEFAULT_PLAN.displayName,
      key: DEFAULT_PLAN.key,
      unitAmount: DEFAULT_PLAN.unitAmount,
      currency: DEFAULT_PLAN.currency,
      monthlyCredits: DEFAULT_PLAN.credits,
      trialDays: DEFAULT_PLAN.trialDays,
      trialDailyCredits: TRIAL_DAILY_CREDITS,
      configured: isStripeConfigured(),
    },
    plans: [BASIC_PLAN, PRO_PLAN].map((p) => ({
      key: p.key,
      name: p.productName,
      unitAmount: p.unitAmount,
      currency: p.currency,
      monthlyCredits: p.monthlyCredits,
      trialDays: p.trialDays,
      configured: isStripeConfigured() && !!getBillingPriceId(p.key),
    })),
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

router.get("/billing/status", async (req, res): Promise<void> => {
  const userId = req.session?.userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const status = await getBillingStatus(userId);
  res.json(status);
});

// POST /api/billing/checkout — create Stripe subscription checkout (requires session)
// Body: { planKey?: "basic_assessment" | "pro_repair" | "viba_monthly" }
const CheckoutBody = z.object({ planKey: z.string().optional() });

router.post("/billing/checkout", async (req, res): Promise<void> => {
  const userId = req.session?.userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Stripe is not configured on this deployment" });
    return;
  }

  const parsed = CheckoutBody.safeParse(req.body ?? {});
  const requestedPlanKey = parsed.success ? (parsed.data.planKey ?? "pro_repair") : "pro_repair";

  // Resolve plan — fall back to PRO_PLAN for unknown keys
  const selectedPlan = getPlanByKey(requestedPlanKey) ?? PRO_PLAN;
  const priceId = getBillingPriceId(selectedPlan.key);
  if (!priceId) {
    // Fallback to legacy plan if new plan not provisioned yet
    const fallbackPriceId = getBillingPriceId(VIBA_PLAN.key);
    if (!fallbackPriceId) {
      res.status(503).json({ error: "Membership price not provisioned yet — try again in a moment" });
      return;
    }
  }

  const resolvedPriceId = priceId || getBillingPriceId(VIBA_PLAN.key);
  if (!resolvedPriceId) {
    res.status(503).json({ error: "Membership price not provisioned yet — try again in a moment" });
    return;
  }

  const current = await getBillingStatus(userId);
  if (current.subscriptionStatus === "active" || current.subscriptionStatus === "trialing") {
    res.status(409).json({ error: "already_subscribed", message: "You already have an active subscription. Use Billing > Manage to change plans." });
    return;
  }

  try {
    const stripe = getStripe();
    const base = origin(req);
    const priceId = await getSubscriptionPriceId(plan);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      ...(current.stripeCustomerId ? { customer: current.stripeCustomerId } : {}),
      line_items: [{ price: resolvedPriceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: selectedPlan.trialDays,
        metadata: { system: "viba_billing", userId: String(userId) },
      },
      payment_method_collection: "always",
      client_reference_id: String(userId),
      metadata: { system: "viba_billing", type: "subscription", userId: String(userId), planKey: selectedPlan.key },
      success_url: `${base}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pricing`,
    });

    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "billing checkout error");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

router.post("/billing/upgrade/pro", async (req, res): Promise<void> => {
  const userId = req.session?.userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!isStripeConfigured()) { res.status(503).json({ error: "Stripe is not configured" }); return; }

  const current = await getBillingStatus(userId);
  if (!current.stripeCustomerId) {
    res.status(400).json({ error: "No billing customer found. Start a Pro checkout from Pricing." });
    return;
  }

  try {
    const stripe = getStripe();
    const base = origin(req);
    const portal = await stripe.billingPortal.sessions.create({
      customer: current.stripeCustomerId,
      return_url: `${base}/billing`,
    });
    res.json({ url: portal.url });
  } catch (err) {
    req.log.error({ err }, "pro upgrade portal error");
    res.status(500).json({ error: "Failed to open upgrade portal" });
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
      // Save the PM for future off-session use (auto top-up).
      // The checkout.session.completed webhook also sets the customer's
      // invoice_settings.default_payment_method so triggerAutoTopupIfNeeded can find it.
      payment_intent_data: { setup_future_usage: "off_session" },
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

// GET /api/billing/auto-topup — load saved auto top-up config (requires session)
router.get("/billing/auto-topup", async (req, res): Promise<void> => {
  const userId = req.session?.userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const config = await getAutoTopupConfig(userId);
  res.json(config);
});

// POST /api/billing/auto-topup — save auto top-up config (requires session)
const AutoTopupBody = z.object({
  enabled: z.boolean(),
  threshold: z.number().int().min(0).max(5000),
  packKey: z.string(),
});

router.post("/billing/auto-topup", async (req, res): Promise<void> => {
  const userId = req.session?.userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const parsed = AutoTopupBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", detail: parsed.error.issues }); return; }

  const { enabled, threshold, packKey } = parsed.data;

  // Validate the packKey if provided
  if (packKey && !CREDIT_PACKS.find((p) => p.key === packKey)) {
    res.status(400).json({ error: "Unknown packKey" }); return;
  }

  await setAutoTopupConfig(userId, { enabled, threshold, packKey });
  res.json({ ok: true });
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
