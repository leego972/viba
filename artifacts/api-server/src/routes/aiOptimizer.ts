import { Router } from "express";
import { z } from "zod/v4";
import { previewDecision, decideOptimisation } from "../lib/aiCostOptimizer";
import {
  getMonthlySummary, getUserBudget, checkBudgetStatus,
  recordUsageEvent, ensureUsageTables,
} from "../lib/usageTracker";
import { getAllModels, ensureModelRegistryTable } from "../lib/modelRegistry";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router = Router();

let _tablesReady = false;
async function ensureTables() {
  if (_tablesReady) return;
  await ensureUsageTables();
  await ensureModelRegistryTable();
  _tablesReady = true;
}

router.get("/api/ai/optimize/models", async (req, res) => {
  try {
    await ensureTables();
    const models = await getAllModels();
    res.json({ models });
  } catch (err) {
    logger.error({ err }, "GET /api/ai/optimize/models failed");
    res.status(500).json({ error: "Failed to load model registry" });
  }
});

const previewSchema = z.object({
  taskType: z.string().default("general"),
  prompt: z.string().min(1),
  contextText: z.string().optional(),
  qualityMode: z.enum(["economy", "balanced", "maximum"]).optional(),
  preferredProvider: z.string().optional(),
  projectId: z.string().optional(),
  sessionId: z.coerce.number().optional(),
});

router.post("/api/ai/optimize/preview", async (req, res) => {
  const user = (req as unknown as { user?: { id: number } }).user;
  if (!user) return void res.status(401).json({ error: "Unauthorized" });

  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid request", details: parsed.error.issues });

  try {
    await ensureTables();
    const decision = await previewDecision({
      userId: user.id,
      ...parsed.data,
    });
    res.json({ decision });
  } catch (err) {
    logger.error({ err }, "POST /api/ai/optimize/preview failed");
    res.status(500).json({ error: "Optimiser unavailable" });
  }
});

router.post("/api/ai/optimize/record", async (req, res) => {
  const user = (req as unknown as { user?: { id: number } }).user;
  if (!user) return void res.status(401).json({ error: "Unauthorized" });

  try {
    await ensureTables();
    const id = await recordUsageEvent({ userId: user.id, ...req.body });
    res.json({ id });
  } catch (err) {
    logger.error({ err }, "POST /api/ai/optimize/record failed");
    res.status(500).json({ error: "Failed to record usage" });
  }
});

router.get("/api/ai/savings/summary", async (req, res) => {
  const user = (req as unknown as { user?: { id: number } }).user;
  if (!user) return void res.status(401).json({ error: "Unauthorized" });

  const after = req.query["after"] as string | undefined;
  const before = req.query["before"] as string | undefined;

  try {
    await ensureTables();
    const [summary, budgetStatus] = await Promise.all([
      getMonthlySummary(user.id, { after, before }),
      checkBudgetStatus(user.id),
    ]);
    res.json({ summary, budgetStatus });
  } catch (err) {
    logger.error({ err }, "GET /api/ai/savings/summary failed");
    res.status(500).json({ error: "Failed to load savings summary" });
  }
});

router.get("/api/ai/usage/history", async (req, res) => {
  const user = (req as unknown as { user?: { id: number } }).user;
  if (!user) return void res.status(401).json({ error: "Unauthorized" });

  const page = Math.max(1, Number(req.query["page"] ?? 1));
  const limit = Math.min(100, Math.max(10, Number(req.query["limit"] ?? 50)));
  const offset = (page - 1) * limit;
  const provider = req.query["provider"] as string | undefined;
  const taskType = req.query["taskType"] as string | undefined;
  const method = req.query["method"] as string | undefined;
  const after = req.query["after"] as string | undefined;
  const before = req.query["before"] as string | undefined;

  try {
    await ensureTables();
    const conditions: string[] = ["user_id = $1"];
    const params: unknown[] = [user.id];
    let pi = 2;

    if (provider)   { conditions.push(`provider = $${pi++}`);           params.push(provider); }
    if (taskType)   { conditions.push(`task_type = $${pi++}`);          params.push(taskType); }
    if (method)     { conditions.push(`execution_method = $${pi++}`);   params.push(method); }
    if (after)      { conditions.push(`created_at >= $${pi++}`);        params.push(after); }
    if (before)     { conditions.push(`created_at < $${pi++}`);         params.push(before); }

    const where = conditions.join(" AND ");
    const { rows } = await pool.query(
      `SELECT id, task_type, execution_method, provider, model,
              prompt_tokens, completion_tokens, estimated_cost_usd, estimated_savings_usd,
              savings_reasons, success, cache_hit, quality_mode, created_at
       FROM ai_usage_events
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM ai_usage_events WHERE ${where}`, params,
    );
    res.json({ events: rows, total: countRows[0]?.total ?? 0, page, limit });
  } catch (err) {
    logger.error({ err }, "GET /api/ai/usage/history failed");
    res.status(500).json({ error: "Failed to load usage history" });
  }
});

router.get("/api/ai/usage/breakdown", async (req, res) => {
  const user = (req as unknown as { user?: { id: number } }).user;
  if (!user) return void res.status(401).json({ error: "Unauthorized" });

  const after = req.query["after"] as string | undefined;
  const before = req.query["before"] as string | undefined;

  try {
    await ensureTables();

    // Build shared date conditions
    const dateConditions: string[] = [];
    const dateParams: unknown[] = [user.id];
    let pi = 2;
    if (after)  { dateConditions.push(`created_at >= $${pi++}`); dateParams.push(after); }
    else        { dateConditions.push(`created_at >= date_trunc('month', NOW())`); }
    if (before) { dateConditions.push(`created_at < $${pi++}`);  dateParams.push(before); }

    const dateWhere = dateConditions.join(" AND ");
    const baseWhere = `user_id = $1 AND ${dateWhere}`;

    const [{ rows: byProvider }, { rows: byTaskType }, { rows: byMethod }, { rows: daily }] =
      await Promise.all([
        pool.query(
          `SELECT provider, COUNT(*) AS tasks, SUM(estimated_cost_usd) AS cost, SUM(estimated_savings_usd) AS savings
           FROM ai_usage_events WHERE ${baseWhere} GROUP BY provider ORDER BY cost DESC`,
          dateParams,
        ),
        pool.query(
          `SELECT task_type, COUNT(*) AS tasks, SUM(estimated_savings_usd) AS savings
           FROM ai_usage_events WHERE ${baseWhere} GROUP BY task_type ORDER BY tasks DESC`,
          dateParams,
        ),
        pool.query(
          `SELECT execution_method, COUNT(*) AS tasks, SUM(estimated_savings_usd) AS savings
           FROM ai_usage_events WHERE ${baseWhere} GROUP BY execution_method ORDER BY tasks DESC`,
          dateParams,
        ),
        pool.query(
          `SELECT DATE(created_at) AS day, COUNT(*) AS tasks, SUM(estimated_cost_usd) AS cost
           FROM ai_usage_events WHERE ${baseWhere} GROUP BY day ORDER BY day`,
          dateParams,
        ),
      ]);

    res.json({ byProvider, byTaskType, byMethod, daily });
  } catch (err) {
    logger.error({ err }, "GET /api/ai/usage/breakdown failed");
    res.status(500).json({ error: "Failed to load breakdown" });
  }
});

export default router;
