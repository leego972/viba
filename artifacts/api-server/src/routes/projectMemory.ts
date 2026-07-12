import { Router } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router = Router();

router.get("/api/project-memory", async (req, res) => {
  const user = (req as unknown as { user?: { id: number } }).user;
  if (!user) return void res.status(401).json({ error: "Unauthorized" });

  const projectId = req.query["projectId"] as string | undefined;
  if (!projectId) return void res.status(400).json({ error: "projectId required" });

  try {
    const { rows } = await pool.query(
      `SELECT * FROM ai_project_memory
       WHERE user_id = $1 AND project_id = $2 AND outdated = false
       ORDER BY pinned DESC, user_confirmed DESC, created_at DESC`,
      [user.id, projectId],
    );
    res.json({ memories: rows });
  } catch (err) {
    logger.error({ err }, "GET /api/project-memory failed");
    res.status(500).json({ error: "Failed to load project memory" });
  }
});

const memorySchema = z.object({
  projectId: z.string().min(1),
  memoryType: z.enum(["general", "architecture", "decisions", "issues", "preferences", "stack", "deployment"]).default("general"),
  key: z.string().min(1),
  value: z.string().min(1),
  source: z.string().default("user"),
  confidence: z.number().min(0).max(1).default(1),
  userConfirmed: z.boolean().default(true),
  pinned: z.boolean().default(false),
});

router.post("/api/project-memory", async (req, res) => {
  const user = (req as unknown as { user?: { id: number } }).user;
  if (!user) return void res.status(401).json({ error: "Unauthorized" });

  const parsed = memorySchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid memory", details: parsed.error.issues });

  const d = parsed.data;
  try {
    const { rows } = await pool.query(
      `INSERT INTO ai_project_memory
         (user_id, project_id, memory_type, key, value, source, confidence, user_confirmed, pinned)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [user.id, d.projectId, d.memoryType, d.key, d.value, d.source, d.confidence, d.userConfirmed, d.pinned],
    );
    res.status(201).json({ memory: rows[0] });
  } catch (err) {
    logger.error({ err }, "POST /api/project-memory failed");
    res.status(500).json({ error: "Failed to save memory" });
  }
});

router.patch("/api/project-memory/:id", async (req, res) => {
  const user = (req as unknown as { user?: { id: number } }).user;
  if (!user) return void res.status(401).json({ error: "Unauthorized" });

  const allowed = ["value", "pinned", "outdated", "user_confirmed", "key"] as const;
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  let pi = 1;

  for (const key of allowed) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    const val = (req.body as Record<string, unknown>)[camel] ?? (req.body as Record<string, unknown>)[key];
    if (val !== undefined) { sets.push(`${key} = $${pi++}`); params.push(val); }
  }

  params.push(req.params["id"], user.id);

  try {
    const { rows } = await pool.query(
      `UPDATE ai_project_memory SET ${sets.join(", ")}
       WHERE id = $${pi} AND user_id = $${pi + 1}
       RETURNING *`,
      params,
    );
    if (!rows[0]) return void res.status(404).json({ error: "Memory not found" });
    res.json({ memory: rows[0] });
  } catch (err) {
    logger.error({ err }, "PATCH /api/project-memory/:id failed");
    res.status(500).json({ error: "Failed to update memory" });
  }
});

router.delete("/api/project-memory/:id", async (req, res) => {
  const user = (req as unknown as { user?: { id: number } }).user;
  if (!user) return void res.status(401).json({ error: "Unauthorized" });

  try {
    await pool.query(
      `DELETE FROM ai_project_memory WHERE id = $1 AND user_id = $2`,
      [req.params["id"], user.id],
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /api/project-memory/:id failed");
    res.status(500).json({ error: "Failed to delete memory" });
  }
});

router.get("/api/project-memory/projects", async (req, res) => {
  const user = (req as unknown as { user?: { id: number } }).user;
  if (!user) return void res.status(401).json({ error: "Unauthorized" });

  try {
    const { rows } = await pool.query(
      `SELECT project_id, COUNT(*) AS memory_count, MAX(updated_at) AS last_updated
       FROM ai_project_memory WHERE user_id = $1 GROUP BY project_id ORDER BY last_updated DESC`,
      [user.id],
    );
    res.json({ projects: rows });
  } catch (err) {
    logger.error({ err }, "GET /api/project-memory/projects failed");
    res.status(500).json({ error: "Failed to load projects" });
  }
});

export default router;
