import type { RequestHandler } from "express";
import { pool } from "@workspace/db";
import { getStripeClient, isStripeConfigured } from "../lib/stripe/client";
import {
  getSubscriberByCustomerId,
  createSubscriber,
  updateSubscriberBySubscriptionId,
} from "../lib/stripe/storage";
import { sendAccessTokenEmail } from "../lib/stripe/email";
import { logger } from "../lib/logger";
import {
  isWebhookProcessed,
  markWebhookProcessed,
  getUserByStripeCustomer,
  linkSubscription,
  updateSubscriptionStatus,
  grantCredits,
  VIBA_CREDIT_ECONOMICS,
} from "../lib/billing";
import {
  sendPaymentFailedEmail,
  sendSubscriptionCanceledEmail,
} from "../lib/billingEmail";

const MEMBER_MONTHLY_CREDITS = 1500;
const PRO_MONTHLY_CREDITS = 6000;

function tsToDate(ts: number | null | undefined): Date | null {
  return ts != null ? new Date(ts * 1000) : null;
}

function creditsFromMetadata(meta: Record<string, string | undefined> | null | undefined): number {
  const raw = Number(meta?.["credits"]);
  if (Number.isFinite(raw) && raw > 0) return raw;
  if (meta?.["planKey"] === "viba_pro") return PRO_MONTHLY_CREDITS;
  return MEMBER_MONTHLY_CREDITS;
}

async function subscriptionCredits(subscriptionId: string): Promise<number> {
  const stripe = getStripeClient();
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price"] });
  const fromSub = creditsFromMetadata(sub.metadata as Record<string, string | undefined>);
  if (fromSub > MEMBER_MONTHLY_CREDITS || sub.metadata?.["credits"]) return fromSub;
  const priceMeta = sub.items.data[0]?.price.metadata as Record<string, string | undefined> | undefined;
  return creditsFromMetadata(priceMeta);
}

async function resetPaidCredits(userId: number, periodEnd: Date | null, credits: number): Promise<void> {
  await pool.query(
    `UPDATE users SET
       credits_remaining = $1,
       credits_period_end = $2,
       subscription_status = 'active',
       updated_at = NOW()
     WHERE id = $3`,
    [credits, periodEnd, userId],
  );
  await pool.query(
    `INSERT INTO credit_transactions (user_id, amount, balance_after, reason)
     VALUES ($1, $2, $3, $4)`,
    [userId, credits, credits, "paid_allowance_reset"],
  );
}

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

  let event: import("stripe").Stripe.Event;
  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(req.body as Buffer, sigStr, webhookSecret);
  } catch (err) {
    logger.error({ err }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: "Webhook signature invalid" });
    return;
  }

  if (isWebhookProcessed(event.id)) {
    logger.info({ eventId: event.id }, "Webhook already processed — skipping");
    res.json({ received: true, duplicate: true });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as import("stripe").Stripe.Checkout.Session;
        const meta = session.metadata ?? {};

        if (meta["system"] === "viba_billing") {
          const userId = Number(meta["userId"]);
          const customerId = session.customer as string;

          if (meta["type"] === "subscription") {
            const subscriptionId = session.subscription as string;
            const stripe = getStripeClient();
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            const periodEnd = tsToDate(sub.current_period_end);
            await linkSubscription(userId, customerId, subscriptionId, sub.status, periodEnd);

            const isTrial = sub.status === "trialing";
            const initialCredits = isTrial
              ? VIBA_CREDIT_ECONOMICS.trialCreditsDaily
              : creditsFromMetadata(meta as Record<string, string | undefined>);
            await grantCredits(
              userId,
              initialCredits,
              isTrial ? "trial_daily_reset" : "new subscription initial credit grant",
            );
            logger.info({ userId, subscriptionId, status: sub.status, initialCredits }, "Billing: subscription linked");

          } else if (meta["type"] === "credit_pack") {
            const credits = Number(meta["credits"]);
            if (credits > 0) {
              await grantCredits(userId, credits, `credit pack purchase: ${meta["packKey"] ?? "unknown"}`);
              logger.info({ userId, credits }, "Billing: credit pack granted");
            }
          }

        } else if (session.mode === "subscription") {
          const customerId = session.customer as string;
          const subscriptionId = session.subscription as string;
          const email: string =
            (session.customer_details as { email?: string } | null)?.email ??
            (session.customer_email as string | null) ??
            "";

          const existing = await getSubscriberByCustomerId(customerId);
          if (existing) {
            logger.info({ customerId }, "Subscriber already exists — skipping");
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

          logger.info({ email, tokenPrefix: sub.accessToken.slice(0, 16) }, "Subscriber created");
          sendAccessTokenEmail(email, sub.accessToken).catch((err) => {
            logger.error({ err, email }, "Failed to send access token email");
          });
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as import("stripe").Stripe.Invoice & { billing_reason?: string; amount_paid?: number; period_end?: number };
        const subId = invoice.subscription as string | undefined;
        if (!subId) break;

        if (invoice.billing_reason === "subscription_create" && (invoice.amount_paid ?? 0) === 0) {
          logger.info({ subscriptionId: subId }, "Trial invoice succeeded — paid credit reset skipped until paid renewal");
          break;
        }

        const customerId = invoice.customer as string;
        const user = await getUserByStripeCustomer(customerId);
        if (user) {
          const periodEnd = tsToDate(invoice.period_end);
          const credits = await subscriptionCredits(subId);
          await resetPaidCredits(user.id, periodEnd, credits);
          logger.info({ userId: user.id, credits }, "Billing: paid credits reset on renewal");
        }

        await updateSubscriberBySubscriptionId(subId, { status: "active" });
        logger.info({ subscriptionId: subId }, "Invoice payment succeeded");
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as import("stripe").Stripe.Subscription;
        const periodEnd = tsToDate(sub.current_period_end);
        await updateSubscriptionStatus(sub.id, sub.status, periodEnd);
        await updateSubscriberBySubscriptionId(sub.id, {
          status: sub.status,
          trialEnd: tsToDate(sub.trial_end),
          currentPeriodEnd: periodEnd,
        });
        logger.info({ subscriptionId: sub.id, status: sub.status }, "Subscription updated");
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as import("stripe").Stripe.Subscription;
        await updateSubscriptionStatus(sub.id, "canceled", null);
        await updateSubscriberBySubscriptionId(sub.id, { status: "canceled" });
        logger.info({ subscriptionId: sub.id }, "Subscription canceled");

        const user = await getUserByStripeCustomer(sub.customer as string);
        if (user) {
          sendSubscriptionCanceledEmail(user.email).catch((err) =>
            logger.error({ err }, "sendSubscriptionCanceledEmail failed"),
          );
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as import("stripe").Stripe.Invoice;
        const subId = invoice.subscription as string | undefined;
        if (!subId) break;

        const customerId = invoice.customer as string;
        const user = await getUserByStripeCustomer(customerId);
        if (user) {
          await updateSubscriptionStatus(subId, "past_due", null);
          sendPaymentFailedEmail(user.email).catch((err) =>
            logger.error({ err }, "sendPaymentFailedEmail failed"),
          );
        }

        await updateSubscriberBySubscriptionId(subId, { status: "past_due" });
        logger.warn({ subscriptionId: subId }, "Invoice payment failed — marked past_due, user notified");
        break;
      }

      default:
        logger.debug({ type: event.type }, "Unhandled Stripe webhook event");
    }

    markWebhookProcessed(event.id);
    res.json({ received: true });
  } catch (err) {
    logger.error({ err, eventType: event.type }, "Webhook handler error");
    res.status(500).json({ error: "Webhook processing failed" });
  }
};
