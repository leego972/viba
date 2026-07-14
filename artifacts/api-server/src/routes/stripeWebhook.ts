import type { RequestHandler } from "express";
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
  refreshMonthlyCredits,
  updateSubscriptionStatus,
  grantCredits,
  VIBA_PLAN,
} from "../lib/billing";
import { pool } from "@workspace/db";
import {
  sendPaymentFailedEmail,
  sendSubscriptionCanceledEmail,
} from "../lib/billingEmail";

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

  let event: import("stripe").Stripe.Event;
  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(req.body as Buffer, sigStr, webhookSecret);
  } catch (err) {
    logger.error({ err }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: "Webhook signature invalid" });
    return;
  }

  // Idempotency — skip duplicate deliveries
  if (isWebhookProcessed(event.id)) {
    logger.info({ eventId: event.id }, "Webhook already processed — skipping");
    res.json({ received: true, duplicate: true });
    return;
  }

  try {
    switch (event.type) {

      // ── checkout.session.completed ─────────────────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as import("stripe").Stripe.Checkout.Session;
        const meta = session.metadata ?? {};

        if (meta["system"] === "viba_billing") {
          // New billing system — linked to users table via userId in metadata
          const userId = Number(meta["userId"]);
          const customerId = session.customer as string;

          if (meta["type"] === "subscription") {
            const subscriptionId = session.subscription as string;
            const stripe = getStripeClient();
            const sub = await stripe.subscriptions.retrieve(subscriptionId, {
              expand: ["default_payment_method"],
            });
            const periodEnd = tsToDate(sub.current_period_end);
            // planKey comes from checkout session metadata (set by billing and annualBilling routes)
            const planKey = (meta["planKey"] as string | undefined) ?? VIBA_PLAN.key;
            await linkSubscription(userId, customerId, subscriptionId, sub.status, periodEnd, planKey);
            // Grant initial credits based on plan
            const INITIAL_CREDITS: Record<string, number> = {
              basic_assessment: 750,
              pro_repair: 4000,
              viba_annual: 23400,
            };
            const initialCredits = INITIAL_CREDITS[planKey] ?? VIBA_PLAN.monthlyCredits;
            await grantCredits(userId, initialCredits, `new subscription — initial credit grant (${planKey})`);
            logger.info({ userId, subscriptionId, status: sub.status }, "Billing: subscription linked");

            // Sync the subscription's default_payment_method to the customer's
            // invoice_settings so triggerAutoTopupIfNeeded can find it for off-session charges.
            const pmFromSub = sub.default_payment_method;
            const pmId = typeof pmFromSub === "string" ? pmFromSub : pmFromSub?.id ?? null;
            if (pmId) {
              await stripe.customers.update(customerId, {
                invoice_settings: { default_payment_method: pmId },
              });
              logger.info({ userId, customerId, pmId }, "Billing: customer default PM synced");
            }

          } else if (meta["type"] === "credit_pack") {
            const credits = Number(meta["credits"]);
            if (credits > 0) {
              await grantCredits(userId, credits, `credit pack purchase: ${meta["packKey"] ?? "unknown"}`);
              logger.info({ userId, credits }, "Billing: credit pack granted");
            }
            // Sync the payment method used in this one-time purchase as the customer's
            // default so auto top-up off-session charges can find it (setup_future_usage=off_session
            // attaches it, but invoice_settings must be set explicitly).
            const stripe = getStripeClient();
            const paymentIntentId = session.payment_intent as string | null;
            if (paymentIntentId) {
              const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
              const pmId = typeof pi.payment_method === "string"
                ? pi.payment_method
                : pi.payment_method?.id ?? null;
              if (pmId) {
                await stripe.customers.update(customerId, {
                  invoice_settings: { default_payment_method: pmId },
                });
                logger.info({ userId, customerId, pmId }, "Billing: customer default PM synced from credit pack");
              }
            }
          }

        } else if (session.mode === "subscription") {
          // Legacy subscriber system (access-token flow)
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

      // ── invoice.payment_succeeded — monthly renewal grants fresh credits ────
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as import("stripe").Stripe.Invoice;
        const subId = invoice.subscription as string | undefined;
        if (!subId) break;

        const customerId = invoice.customer as string;
        const user = await getUserByStripeCustomer(customerId);
        if (user) {
          const periodEnd = tsToDate((invoice as import("stripe").Stripe.Invoice & { period_end?: number }).period_end);
          await refreshMonthlyCredits(user.id, periodEnd);
          logger.info({ userId: user.id }, "Billing: monthly credits refreshed on renewal");

          // Resume any sessions that were paused specifically due to credit exhaustion.
          // Sessions paused for other reasons (human approval rejection, budget cap, manual)
          // are identified by the system message metadata left by pauseSessionForActionCredits.
          const { rows: resumed } = await pool.query(
            `UPDATE sessions SET status = 'active', updated_at = NOW()
             WHERE user_id = $1 AND status = 'paused'
               AND id IN (
                 SELECT DISTINCT session_id FROM messages
                 WHERE (metadata->>'reason') IN (
                   'insufficient_action_credits',
                   'session_budget_cap_reached'
                 )
               )
             RETURNING id`,
            [user.id],
          );
          if (resumed.length > 0) {
            logger.info(
              { userId: user.id, resumedSessions: resumed.map((r: { id: number }) => r.id) },
              "Billing: credit-paused sessions auto-resumed after payment",
            );
          }
        }

        // Legacy
        await updateSubscriberBySubscriptionId(subId, { status: "active" });
        logger.info({ subscriptionId: subId }, "Invoice payment succeeded");
        break;
      }

      // ── customer.subscription.updated ──────────────────────────────────────
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

      // ── customer.subscription.deleted — service suspended, data preserved ───
      case "customer.subscription.deleted": {
        const sub = event.data.object as import("stripe").Stripe.Subscription;
        await updateSubscriptionStatus(sub.id, "canceled", null);
        await updateSubscriberBySubscriptionId(sub.id, { status: "canceled" });
        logger.info({ subscriptionId: sub.id }, "Subscription canceled");

        // Notify user — data is NEVER deleted, service resumes on resubscribe
        const user = await getUserByStripeCustomer(sub.customer as string);
        if (user) {
          sendSubscriptionCanceledEmail(user.email).catch((err) =>
            logger.error({ err }, "sendSubscriptionCanceledEmail failed"),
          );
        }
        break;
      }

      // ── invoice.payment_failed — warn user, service remains on past_due ─────
      case "invoice.payment_failed": {
        const invoice = event.data.object as import("stripe").Stripe.Invoice;
        const subId = invoice.subscription as string | undefined;
        if (!subId) break;

        const customerId = invoice.customer as string;
        const user = await getUserByStripeCustomer(customerId);
        if (user) {
          await updateSubscriptionStatus(subId, "past_due", null);
          // Send payment-failed reminder — never delete their data
          sendPaymentFailedEmail(user.email).catch((err) =>
            logger.error({ err }, "sendPaymentFailedEmail failed"),
          );
        }

        await updateSubscriberBySubscriptionId(subId, { status: "past_due" });
        logger.warn({ subscriptionId: subId }, "Invoice payment failed — marked past_due, user notified");
        break;
      }

      // ── payment_intent.succeeded — auto top-up charge completed ─────────────
      // Fires when an off-session PaymentIntent from triggerAutoTopupIfNeeded succeeds.
      // (Immediate-success path already grants credits in billing.ts; this handles
      //  any delayed-capture or async-confirmation cases.)
      case "payment_intent.succeeded": {
        const pi = event.data.object as import("stripe").Stripe.PaymentIntent;
        const meta = pi.metadata ?? {};
        if (meta["system"] === "viba_billing" && meta["type"] === "auto_topup") {
          const userId = Number(meta["userId"]);
          const credits = Number(meta["credits"]);
          const packKey = meta["packKey"] ?? "unknown";
          if (userId && credits > 0) {
            // Guard: only grant if we haven't already done so (immediate path may have)
            // We rely on the webhook idempotency guard (markWebhookProcessed) above.
            await grantCredits(userId, credits, `auto top-up (webhook): ${packKey}`);
            logger.info({ userId, credits, packKey, piId: pi.id }, "Auto top-up: credits granted via webhook");
          }
        }
        break;
      }

      // ── payment_intent.payment_failed — auto top-up declined ─────────────────
      case "payment_intent.payment_failed": {
        const pi = event.data.object as import("stripe").Stripe.PaymentIntent;
        const meta = pi.metadata ?? {};
        if (meta["system"] === "viba_billing" && meta["type"] === "auto_topup") {
          const userId = Number(meta["userId"]);
          logger.warn({ userId, piId: pi.id, lastError: pi.last_payment_error?.message }, "Auto top-up: payment failed");
        }
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
