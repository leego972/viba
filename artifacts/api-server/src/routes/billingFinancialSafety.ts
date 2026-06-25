import { Router, type IRouter } from "express";
import { requireAdmin } from "../middlewares/adminAuth";
import { getStripeWebhookFinancialSafetyStatus } from "../lib/billingFinancialSafety";

const router: IRouter = Router();

router.get("/billing/financial-safety", requireAdmin, async (_req, res): Promise<void> => {
  const webhook = await getStripeWebhookFinancialSafetyStatus();
  res.json({
    stripeWebhook: webhook,
    controls: {
      webhookSignatureRequired: true,
      persistentWebhookIdempotency: webhook.persistentIdempotency,
      duplicateWebhookSkip: true,
      failedWebhookRetryTracked: true,
      paidCreditResetUsesTransaction: true,
      negativeBalanceBlocked: true,
      rawValuesReturned: false,
    },
    rawValuesReturned: false,
  });
});

export default router;
