import { Router } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router = Router();

const budgetSchema = z.object({
  monthlyBudgetUsd: z.number().min(0).nullable().optional(),
  warnThresholdUsd: z.number().min(0).nullable().optional(),
  hardLimitUsd: z.number().min(0).nullable().optional(),
  premiumApprovalThresholdUsd: z.number().min(0).optional(),
  requireApprovalAboveUsd: z.number().min(0).optional(),
  autoEconomyAtPercent: z.number().min(0).max(100).optional(),
  blockPremiumAtLimit: z.boolean().optional(),
  allowMultiModel: z.boolean().optional(),
  qualityMode: z.enum(["economy", "balanced", "maximum"]).optional(),
  useExistingFirst: z.boolean().optional(),
  providerLimits: z.record(z.string(), z.number()).optional(),
});

router.get("/api/ai/budgets", async (req, res) => {
  const user = (req as unknown as { user?: { id: number } }).user;
  if (!user) return void res.status(401).json({ error: "Unauthorized" });

  try {
    const { rows } = await pool.query(
      `SELECT * FROM user_ai_budgets WHERE user_id = $1`, [user.id],
    );
    res.json({ budget: rows[0] ?? null });
  } catch (err) {
    logger.error({ err }, "GET /api/ai/budgets failed");
    res.status(500).json({ error: "Failed to load budget" });
  }
});

router.put("/api/ai/budgets", async (req, res) => {
  const user = (req as unknown as { user?: { id: number } }).user;
  if (!user) return void res.status(401).json({ error: "Unauthorized" });

  const parsed = budgetSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid budget settings", details: parsed.error.issues });

  const d = parsed.data;
  try {
    const { rows } = await pool.query(
      `INSERT INTO user_ai_budgets
         (user_id, monthly_budget_usd, warn_threshold_usd, hard_limit_usd,
          premium_approval_threshold_usd, require_approval_above_usd,
          auto_economy_at_percent, block_premium_at_limit, allow_multi_model,
          quality_mode, use_existing_first, provider_limits, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         monthly_budget_usd = COALESCE(EXCLUDED.monthly_budget_usd, user_ai_budgets.monthly_budget_usd),
         warn_threshold_usd = COALESCE(EXCLUDED.warn_threshold_usd, user_ai_budgets.warn_threshold_usd),
         hard_limit_usd = COALESCE(EXCLUDED.hard_limit_usd, user_ai_budgets.hard_limit_usd),
         premium_approval_threshold_usd = COALESCE(EXCLUDED.premium_approval_threshold_usd, user_ai_budgets.premium_approval_threshold_usd),
         require_approval_above_usd = COALESCE(EXCLUDED.require_approval_above_usd, user_ai_budgets.require_approval_above_usd),
         auto_economy_at_percent = COALESCE(EXCLUDED.auto_economy_at_percent, user_ai_budgets.auto_economy_at_percent),
         block_premium_at_limit = COALESCE(EXCLUDED.block_premium_at_limit, user_ai_budgets.block_premium_at_limit),
         allow_multi_model = COALESCE(EXCLUDED.allow_multi_model, user_ai_budgets.allow_multi_model),
         quality_mode = COALESCE(EXCLUDED.quality_mode, user_ai_budgets.quality_mode),
         use_existing_first = COALESCE(EXCLUDED.use_existing_first, user_ai_budgets.use_existing_first),
         provider_limits = COALESCE(EXCLUDED.provider_limits, user_ai_budgets.provider_limits),
         updated_at = NOW()
       RETURNING *`,
      [
        user.id,
        d.monthlyBudgetUsd ?? null, d.warnThresholdUsd ?? null, d.hardLimitUsd ?? null,
        d.premiumApprovalThresholdUsd ?? 0.25, d.requireApprovalAboveUsd ?? 1.0,
        d.autoEconomyAtPercent ?? 80, d.blockPremiumAtLimit ?? true,
        d.allowMultiModel ?? false, d.qualityMode ?? "balanced",
        d.useExistingFirst ?? true,
        d.providerLimits ? JSON.stringify(d.providerLimits) : null,
      ],
    );
    res.json({ budget: rows[0] });
  } catch (err) {
    logger.error({ err }, "PUT /api/ai/budgets failed");
    res.status(500).json({ error: "Failed to save budget" });
  }
});

router.get("/api/ai/subscriptions", async (req, res) => {
  const user = (req as unknown as { user?: { id: number } }).user;
  if (!user) return void res.status(401).json({ error: "Unauthorized" });

  try {
    const { rows } = await pool.query(
      `SELECT * FROM user_ai_subscriptions WHERE user_id = $1 ORDER BY monthly_cost_usd DESC`,
      [user.id],
    );
    res.json({ subscriptions: rows });
  } catch (err) {
    logger.error({ err }, "GET /api/ai/subscriptions failed");
    res.status(500).json({ error: "Failed to load subscriptions" });
  }
});

const subSchema = z.object({
  provider: z.string().min(1),
  displayName: z.string().min(1),
  monthlyCostUsd: z.number().min(0),
  includedUsageDescription: z.string().optional(),
  renewalDay: z.number().min(1).max(31).optional(),
  prioritise: z.boolean().optional(),
});

router.post("/api/ai/subscriptions", async (req, res) => {
  const user = (req as unknown as { user?: { id: number } }).user;
  if (!user) return void res.status(401).json({ error: "Unauthorized" });

  const parsed = subSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid subscription", details: parsed.error.issues });

  const d = parsed.data;
  try {
    const { rows } = await pool.query(
      `INSERT INTO user_ai_subscriptions
         (user_id, provider, display_name, monthly_cost_usd, included_usage_description, renewal_day, prioritise)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         monthly_cost_usd = EXCLUDED.monthly_cost_usd,
         included_usage_description = EXCLUDED.included_usage_description,
         renewal_day = EXCLUDED.renewal_day,
         prioritise = EXCLUDED.prioritise,
         updated_at = NOW()
       RETURNING *`,
      [user.id, d.provider, d.displayName, d.monthlyCostUsd,
       d.includedUsageDescription ?? null, d.renewalDay ?? null, d.prioritise ?? false],
    );
    res.json({ subscription: rows[0] });
  } catch (err) {
    logger.error({ err }, "POST /api/ai/subscriptions failed");
    res.status(500).json({ error: "Failed to save subscription" });
  }
});

router.delete("/api/ai/subscriptions/:id", async (req, res) => {
  const user = (req as unknown as { user?: { id: number } }).user;
  if (!user) return void res.status(401).json({ error: "Unauthorized" });

  try {
    await pool.query(
      `DELETE FROM user_ai_subscriptions WHERE id = $1 AND user_id = $2`,
      [req.params["id"], user.id],
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /api/ai/subscriptions failed");
    res.status(500).json({ error: "Failed to delete subscription" });
  }
});

export default router;
