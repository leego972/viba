import { Router } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { invalidateModelCache } from "../lib/modelRegistry";
import { logger } from "../lib/logger";
import { isAdminEmail } from "../lib/adminAccess";
import type { Request, Response, NextFunction } from "express";

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as unknown as { user?: { email?: string } }).user;
  if (!user || !isAdminEmail(user.email)) {
    return void res.status(403).json({ error: "Admin access required" });
  }
  next();
}

const router = Router();

router.get("/api/ai/models", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ai_model_registry ORDER BY quality_tier, provider, model`,
    );
    res.json({ models: rows });
  } catch (err) {
    logger.error({ err }, "GET /api/ai/models failed");
    res.status(500).json({ error: "Failed to load models" });
  }
});

const modelUpdateSchema = z.object({
  displayName: z.string().optional(),
  inputCostPerMillionTokens: z.number().min(0).optional(),
  outputCostPerMillionTokens: z.number().min(0).optional(),
  contextWindow: z.number().min(1).optional(),
  latency: z.enum(["very_fast", "fast", "medium", "slow"]).optional(),
  qualityTier: z.enum(["economy", "standard", "premium"]).optional(),
  capabilities: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  notes: z.string().optional(),
});

router.put("/api/ai/models/:id", requireAdmin, async (req, res) => {
  const parsed = modelUpdateSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid model update", details: parsed.error.issues });

  const d = parsed.data;
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  let pi = 1;

  const field = (col: string, val: unknown) => {
    if (val !== undefined) { sets.push(`${col} = $${pi++}`); params.push(val); }
  };
  field("display_name", d.displayName);
  field("input_cost_per_million_tokens", d.inputCostPerMillionTokens);
  field("output_cost_per_million_tokens", d.outputCostPerMillionTokens);
  field("context_window", d.contextWindow);
  field("latency", d.latency);
  field("quality_tier", d.qualityTier);
  field("capabilities", d.capabilities);
  field("enabled", d.enabled);
  field("notes", d.notes);

  params.push(req.params["id"]);

  try {
    const { rows } = await pool.query(
      `UPDATE ai_model_registry SET ${sets.join(", ")} WHERE id = $${pi} RETURNING *`,
      params,
    );
    if (!rows[0]) return void res.status(404).json({ error: "Model not found" });
    invalidateModelCache();
    res.json({ model: rows[0] });
  } catch (err) {
    logger.error({ err }, "PUT /api/ai/models/:id failed");
    res.status(500).json({ error: "Failed to update model" });
  }
});

export default router;
