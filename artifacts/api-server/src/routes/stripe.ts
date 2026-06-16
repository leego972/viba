import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  getStripeClient,
  isStripeConfigured,
  getPublishableKey,
  getPriceId,
} from "../lib/stripe/client";
import { getSubscriberByToken } from "../lib/stripe/storage";

const router: IRouter = Router();

// GET /api/stripe/config — tells the frontend which mode is active
router.get("/stripe/config", (_req, res): void => {
  const configured = isStripeConfigured();
  res.json({
    configured,
    publishableKey: configured ? getPublishableKey() : null,
  });
});

const CheckoutBody = z.object({ email: z.string().email().max(254) });

// POST /api/stripe/checkout — creates a Stripe Checkout session ($50/mo, 7-day trial, card required)
router.post("/stripe/checkout", async (req, res): Promise<void> => {
  const parsed = CheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid email address is required" });
    return;
  }

  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Stripe is not configured on this deployment" });
    return;
  }

  try {
    const stripe = getStripeClient();
    const priceId = getPriceId();
    const origin =
      (req.headers["origin"] as string | undefined) ??
      `${req.protocol}://${req.get("host")}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: parsed.data.email,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 7 },
      payment_method_collection: "always",
      success_url: `${origin}/checkout/success`,
      cancel_url: `${origin}/pricing`,
    });

    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "stripe checkout error");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

const PortalBody = z.object({ token: z.string().min(1).max(512) });

// POST /api/stripe/portal — creates a Stripe Customer Portal session
router.post("/stripe/portal", async (req, res): Promise<void> => {
  const parsed = PortalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const subscriber = await getSubscriberByToken(parsed.data.token);
  if (!subscriber?.stripeCustomerId) {
    res.status(404).json({ error: "Subscriber not found" });
    return;
  }

  try {
    const stripe = getStripeClient();
    const origin =
      (req.headers["origin"] as string | undefined) ??
      `${req.protocol}://${req.get("host")}`;

    const session = await stripe.billingPortal.sessions.create({
      customer: subscriber.stripeCustomerId,
      return_url: `${origin}/pricing`,
    });

    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "stripe portal error");
    res.status(500).json({ error: "Failed to create portal session" });
  }
});

// GET /api/stripe/subscription?token=xxx — validates a subscriber access token
router.get("/stripe/subscription", async (req, res): Promise<void> => {
  const token = req.query["token"];
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "token query parameter is required" });
    return;
  }

  const subscriber = await getSubscriberByToken(token);
  if (!subscriber) {
    res.status(404).json({ status: "not_found" });
    return;
  }

  res.json({
    status: subscriber.status,
    email: subscriber.email,
    trialEnd: subscriber.trialEnd?.toISOString() ?? null,
    currentPeriodEnd: subscriber.currentPeriodEnd?.toISOString() ?? null,
  });
});

export default router;
