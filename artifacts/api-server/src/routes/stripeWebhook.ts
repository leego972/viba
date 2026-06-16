import type { RequestHandler } from "express";
import { getStripeClient, isStripeConfigured } from "../lib/stripe/client";
import {
  getSubscriberByCustomerId,
  createSubscriber,
  updateSubscriberBySubscriptionId,
} from "../lib/stripe/storage";
import { sendAccessTokenEmail } from "../lib/stripe/email";
import { logger } from "../lib/logger";

function tsToDate(ts: number | null | undefined): Date | null {
  return ts != null ? new Date(ts * 1000) : null;
}

// Exported as a plain RequestHandler so app.ts can register it with express.raw()
// BEFORE express.json() — Stripe signature verification requires the raw Buffer body.
export const webhookHandler: RequestHandler = async (req, res): Promise<void> => {
  if (!isStripeConfigured()) {
    res.json({ skipped: true });
    return;
  }

  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];

  if (!sig || !webhookSecret) {
    logger.warn("Stripe webhook missing signature or secret");
    res.status(400).json({ error: "Missing stripe-signature or webhook secret" });
    return;
  }

  const sigStr = Array.isArray(sig) ? sig[0]! : sig;

  let event;
  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      sigStr,
      webhookSecret,
    );
  } catch (err) {
    logger.error({ err }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: "Webhook signature invalid" });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;
        if (session.mode !== "subscription") break;

        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        const email: string =
          (session.customer_details as any)?.email ??
          (session.customer_email as string | null) ??
          "";

        // Idempotency: skip if subscriber already exists for this customer
        const existing = await getSubscriberByCustomerId(customerId);
        if (existing) {
          logger.info({ customerId }, "Subscriber already exists — skipping creation");
          break;
        }

        const stripe = getStripeClient();
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        const sub = await createSubscriber({
          email,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          status: subscription.status,
          trialEnd: tsToDate(subscription.trial_end),
          currentPeriodEnd: tsToDate(subscription.current_period_end),
        });

        logger.info(
          { email, tokenPrefix: sub.accessToken.slice(0, 16) },
          "Subscriber created",
        );

        // Fire-and-forget — don't block the webhook response on email delivery
        sendAccessTokenEmail(email, sub.accessToken).catch((err) => {
          logger.error({ err, email }, "Failed to send access token email");
        });
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as any;
        await updateSubscriberBySubscriptionId(sub.id as string, {
          status: sub.status as string,
          trialEnd: tsToDate(sub.trial_end),
          currentPeriodEnd: tsToDate(sub.current_period_end),
        });
        logger.info({ subscriptionId: sub.id, status: sub.status }, "Subscription updated");
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as any;
        await updateSubscriberBySubscriptionId(sub.id as string, { status: "canceled" });
        logger.info({ subscriptionId: sub.id }, "Subscription cancelled");
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as any;
        const subId = invoice.subscription as string | undefined;
        if (subId) {
          await updateSubscriberBySubscriptionId(subId, { status: "past_due" });
          logger.warn({ subscriptionId: subId }, "Invoice payment failed — marked past_due");
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as any;
        const subId = invoice.subscription as string | undefined;
        if (subId) {
          await updateSubscriberBySubscriptionId(subId, { status: "active" });
          logger.info({ subscriptionId: subId }, "Invoice payment succeeded — marked active");
        }
        break;
      }

      default:
        logger.debug({ type: event.type }, "Unhandled Stripe webhook event");
    }

    res.json({ received: true });
  } catch (err) {
    logger.error({ err, eventType: event.type }, "Webhook handler error");
    res.status(500).json({ error: "Webhook processing failed" });
  }
};
