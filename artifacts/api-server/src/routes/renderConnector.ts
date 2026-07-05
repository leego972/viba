/**
 * Render Connector Routes
 *
 * GET  /api/render-connector/status         — API health + service state
 * GET  /api/render-connector/services       — list all services on this account
 * GET  /api/render-connector/deploys        — recent deploy history for configured service
 * POST /api/render-connector/deploy         — trigger a new deploy (admin + confirm)
 * GET  /api/render-connector/env-vars       — list env var keys (no values returned)
 * POST /api/render-connector/env-vars/dry-run — show which keys would be accepted/rejected
 * POST /api/render-connector/env-vars/apply — merge-update env vars (admin + confirm)
 * GET  /api/render-connector/logs           — recent service logs
 */

import { Router, type IRouter } from "express";
import { requireAdmin, requireConfirmation } from "../middlewares/adminAuth";
import {
  getRenderConnectorStatus,
  listRenderServices,
  triggerRenderDeploy,
  getRenderDeploys,
  getRenderEnvVarKeys,
  applyRenderEnvVars,
  getRenderLogs,
  filterRenderVariables,
} from "../lib/renderConnector";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── GET /api/render-connector/status ──────────────────────────────────────────

router.get("/render-connector/status", async (_req, res): Promise<void> => {
  try {
    const status = await getRenderConnectorStatus();
    res.json({ status });
  } catch (err) {
    logger.error({ err }, "render-connector/status failed");
    res.status(500).json({ error: "Status check failed" });
  }
});

// ── GET /api/render-connector/services ────────────────────────────────────────

router.get("/render-connector/services", async (_req, res): Promise<void> => {
  try {
    const result = await listRenderServices();
    if (!result.ok) {
      res.status(502).json({ error: result.error ?? "Failed to list services" });
      return;
    }
    res.json({ services: result.services, count: result.services.length });
  } catch (err) {
    logger.error({ err }, "render-connector/services failed");
    res.status(500).json({ error: "Failed to list services" });
  }
});

// ── GET /api/render-connector/deploys ─────────────────────────────────────────

router.get("/render-connector/deploys", async (req, res): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query["limit"] ?? 5), 20);
    const result = await getRenderDeploys(limit);
    if (!result.ok) {
      res.status(502).json({ error: result.error ?? "Failed to fetch deploys" });
      return;
    }
    res.json({ deploys: result.deploys, count: result.deploys.length });
  } catch (err) {
    logger.error({ err }, "render-connector/deploys failed");
    res.status(500).json({ error: "Failed to fetch deploys" });
  }
});

// ── POST /api/render-connector/deploy ─────────────────────────────────────────
// Requires ADMIN_TOKEN + X-Admin-Confirm: true

router.post(
  "/render-connector/deploy",
  requireAdmin,
  requireConfirmation,
  async (req, res): Promise<void> => {
    try {
      const body = req.body as { clearCache?: boolean };
      const result = await triggerRenderDeploy({ clearCache: body.clearCache === true });

      logger.info(
        { deployId: result.deployId, status: result.status, ok: result.ok },
        "render-connector/deploy triggered",
      );

      if (!result.ok) {
        res.status(502).json({ ok: false, error: result.error ?? "Deploy trigger failed" });
        return;
      }

      res.status(201).json({
        ok: true,
        deployId: result.deployId,
        status: result.status,
        message: "Deploy triggered successfully. Monitor via /render-connector/deploys.",
        rawValuesReturned: false,
      });
    } catch (err) {
      logger.error({ err }, "render-connector/deploy failed");
      res.status(500).json({ ok: false, error: "Deploy trigger failed" });
    }
  },
);

// ── GET /api/render-connector/env-vars ────────────────────────────────────────
// Returns key names only — values are never surfaced.

router.get("/render-connector/env-vars", async (_req, res): Promise<void> => {
  try {
    const result = await getRenderEnvVarKeys();
    if (!result.ok) {
      res.status(502).json({ error: result.error ?? "Failed to read env vars" });
      return;
    }
    res.json({
      keys: result.keys,
      count: result.count,
      valuesReturned: false,
    });
  } catch (err) {
    logger.error({ err }, "render-connector/env-vars GET failed");
    res.status(500).json({ error: "Failed to read env vars" });
  }
});

// ── POST /api/render-connector/env-vars/dry-run ───────────────────────────────

router.post("/render-connector/env-vars/dry-run", async (req, res): Promise<void> => {
  try {
    const body = req.body as { variables?: Record<string, string> };
    const variables =
      body.variables && typeof body.variables === "object" ? body.variables : {};

    // Strip auth keys from body before filtering
    const safeVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(variables)) {
      if (k !== "RENDER_API_KEY" && k !== "RENDER_SERVICE_ID" && typeof v === "string") {
        safeVars[k] = v;
      }
    }

    const filtered = filterRenderVariables(safeVars);
    const status = await getRenderConnectorStatus();

    res.json({
      acceptedKeys: filtered.acceptedKeys,
      rejectedKeys: filtered.rejectedKeys,
      valuesReturned: false,
      apiAvailable: status.apiAvailable,
      serviceIdConfigured: status.serviceIdConfigured,
      wouldApply: filtered.acceptedKeys.length > 0 && status.apiAvailable && status.serviceIdConfigured,
    });
  } catch (err) {
    logger.error({ err }, "render-connector/env-vars/dry-run failed");
    res.status(500).json({ error: "Dry run failed" });
  }
});

// ── POST /api/render-connector/env-vars/apply ─────────────────────────────────
// Requires ADMIN_TOKEN + X-Admin-Confirm: true

router.post(
  "/render-connector/env-vars/apply",
  requireAdmin,
  requireConfirmation,
  async (req, res): Promise<void> => {
    try {
      const body = req.body as { variables?: Record<string, string> };
      const variables =
        body.variables && typeof body.variables === "object" ? body.variables : {};

      // Strip auth keys — never accept from request body
      const safeVars: Record<string, string> = {};
      for (const [k, v] of Object.entries(variables)) {
        if (k !== "RENDER_API_KEY" && k !== "RENDER_SERVICE_ID" && typeof v === "string") {
          safeVars[k] = v;
        }
      }

      const result = await applyRenderEnvVars(safeVars);

      logger.info(
        { appliedKeys: result.appliedKeys, skippedKeys: result.skippedKeys, ok: result.ok },
        "render-connector/env-vars/apply completed",
      );

      if (!result.ok) {
        res.status(result.error?.includes("RENDER_SERVICE_ID") ? 400 : 502).json({
          ok: false,
          appliedKeys: result.appliedKeys,
          skippedKeys: result.skippedKeys,
          valuesReturned: false,
          error: result.error,
        });
        return;
      }

      res.json({
        ok: true,
        appliedKeys: result.appliedKeys,
        skippedKeys: result.skippedKeys,
        totalEnvVarCount: result.totalEnvVarCount,
        valuesReturned: false,
        message: `Applied ${result.appliedKeys.length} env var(s) to Render service.`,
      });
    } catch (err) {
      logger.error({ err }, "render-connector/env-vars/apply failed");
      res.status(500).json({ ok: false, error: "Env var apply failed" });
    }
  },
);

// ── GET /api/render-connector/logs ────────────────────────────────────────────

router.get("/render-connector/logs", async (req, res): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query["limit"] ?? 100), 500);
    const result = await getRenderLogs(limit);
    if (!result.ok) {
      res.status(502).json({ error: result.error ?? "Failed to fetch logs" });
      return;
    }
    res.json({ lines: result.lines, count: result.count });
  } catch (err) {
    logger.error({ err }, "render-connector/logs failed");
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

export default router;
