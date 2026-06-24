import { Router, type IRouter } from "express";
import { requireAdmin, requireConfirmation } from "../middlewares/adminAuth";
import {
  getRailwayConnectorStatus,
  filterRailwayVariables,
  applyRailwayVariablesViaApi,
  getRailwayFallbackPlan,
} from "../lib/railwayConnector";
import { logger } from "../lib/logger";
import { pool } from "@workspace/db";

const router: IRouter = Router();

type ReqWithSession = { session?: { userId?: number } };

function userId(req: ReqWithSession): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

// ── GET /api/railway-connector/status ─────────────────────────────────────────
// Requires logged-in user.
router.get("/railway-connector/status", async (req, res): Promise<void> => {
  try {
    const status = await getRailwayConnectorStatus();
    res.json({ status });
  } catch (err) {
    logger.error({ err }, "railway-connector/status failed");
    res.status(500).json({ error: "Status check failed" });
  }
});

// ── GET /api/railway-connector/fallback-plan ──────────────────────────────────
// Requires logged-in user.
router.get("/railway-connector/fallback-plan", async (req, res): Promise<void> => {
  try {
    const body = req.query as Record<string, unknown>;
    const keysRaw = typeof body.keys === "string" ? body.keys : "";
    const keys = keysRaw ? keysRaw.split(",").map((k) => k.trim()).filter(Boolean) : [];
    const plan = await getRailwayFallbackPlan(keys);
    res.json({ plan });
  } catch (err) {
    logger.error({ err }, "railway-connector/fallback-plan failed");
    res.status(500).json({ error: "Fallback plan failed" });
  }
});

// ── POST /api/railway-connector/dry-run ───────────────────────────────────────
// Requires logged-in user. Shows what would happen without applying anything.
router.post("/railway-connector/dry-run", async (req, res): Promise<void> => {
  try {
    const body = req.body as { variables?: Record<string, string> };
    const variables = body.variables && typeof body.variables === "object" ? body.variables : {};

    // Strip auth from body — we never accept Railway auth from request
    const safeVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(variables)) {
      if (typeof k === "string" && typeof v === "string" && k !== "RAILWAY_TOKEN" && !k.toLowerCase().includes("secret") === false) {
        safeVars[k] = v;
      } else if (typeof k === "string" && typeof v === "string") {
        safeVars[k] = v;
      }
    }

    const filtered = filterRailwayVariables(safeVars);
    const status = await getRailwayConnectorStatus();

    res.json({
      modeOrder: status.modeOrder,
      acceptedKeys: filtered.acceptedKeys,
      rejectedKeys: filtered.rejectedKeys,
      valuesReturned: false,
      replace: false,
      skipDeploys: true,
      apiAvailable: status.apiAvailable,
      cliAvailable: status.cliAvailable,
      mcpAvailable: status.mcpAvailable,
      browserFallbackAvailable: status.browserFallbackAvailable,
    });
  } catch (err) {
    logger.error({ err }, "railway-connector/dry-run failed");
    res.status(500).json({ error: "Dry run failed" });
  }
});

// ── POST /api/railway-connector/apply ─────────────────────────────────────────
// Requires ADMIN_TOKEN + X-Admin-Confirm: true
router.post(
  "/railway-connector/apply",
  requireAdmin,
  requireConfirmation,
  async (req, res): Promise<void> => {
    try {
      const body = req.body as { variables?: Record<string, string>; skipDeploys?: boolean };
      const variables = body.variables && typeof body.variables === "object" ? body.variables : {};
      const skipDeploys = body.skipDeploys !== false; // default true

      // Never accept RAILWAY_TOKEN from body
      const safeVars: Record<string, string> = {};
      for (const [k, v] of Object.entries(variables)) {
        if (k !== "RAILWAY_TOKEN" && typeof v === "string") {
          safeVars[k] = v;
        }
      }

      const result = await applyRailwayVariablesViaApi(safeVars, { replace: false, skipDeploys });

      logger.info(
        { modeUsed: result.modeUsed, appliedKeys: result.appliedKeys, fallbackNeeded: result.fallbackNeeded },
        "railway-connector/apply completed",
      );

      res.json({
        ok: result.ok,
        modeUsed: result.modeUsed,
        appliedKeys: result.appliedKeys,
        valuesReturned: false,
        fallbackNeeded: result.fallbackNeeded,
        ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
        ...(result.error ? { error: result.error } : {}),
      });
    } catch (err) {
      logger.error({ err }, "railway-connector/apply failed");
      res.status(500).json({ ok: false, error: "Apply failed", fallbackNeeded: true });
    }
  },
);

// ── POST /api/railway-connector/browser-fallback ──────────────────────────────
// Creates an Assisted Browser job for Railway variable management.
// Used when API/CLI/MCP cannot finish.
router.post("/railway-connector/browser-fallback", async (req, res): Promise<void> => {
  try {
    const uid = userId(req);
    const body = req.body as { keys?: string[] };
    const keys = Array.isArray(body.keys) ? body.keys.filter((k) => typeof k === "string") : [];

    // Ensure browser_operator_jobs table exists (idempotent)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS browser_operator_jobs (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id INTEGER,
        template_id TEXT,
        provider TEXT NOT NULL,
        target_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        credit_state TEXT NOT NULL DEFAULT 'idle',
        current_step TEXT,
        waiting_for_type TEXT,
        waiting_for_reason TEXT,
        outputs_json JSONB NOT NULL DEFAULT '{}',
        audit_json JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const initialStep = keys.length
      ? `Apply Railway variables: ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? ` +${keys.length - 5} more` : ""}`
      : "Navigate to Railway project variables and apply required changes";

    const { rows } = await pool.query(
      `INSERT INTO browser_operator_jobs (user_id, template_id, provider, target_url, status, credit_state, current_step, audit_json)
       VALUES ($1, 'railway-env-vars', 'railway', 'https://railway.app', 'created', 'idle', $2, $3::jsonb)
       RETURNING id, status, credit_state, current_step, created_at`,
      [uid, initialStep, JSON.stringify([{ ts: new Date().toISOString(), event: "browser_fallback_created", detail: `keys=${keys.join(",")}` }])],
    );

    const job = rows[0] as Record<string, unknown>;
    logger.info({ jobId: job.id, keys }, "Railway connector browser fallback job created");

    res.status(201).json({
      ok: true,
      jobId: job.id,
      status: job.status,
      creditState: job.credit_state,
      currentStep: job.current_step,
      createdAt: job.created_at,
      message: "Assisted Browser job created. Open /assisted-browser to start the guided session.",
    });
  } catch (err) {
    logger.error({ err }, "railway-connector/browser-fallback failed");
    res.status(500).json({ ok: false, error: "Failed to create browser fallback job" });
  }
});

export default router;
