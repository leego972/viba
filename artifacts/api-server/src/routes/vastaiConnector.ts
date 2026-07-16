/**
 * Vast.ai Connector Routes
 *
 * GET    /api/vastai-connector/status              — API key + connectivity check
 * GET    /api/vastai-connector/offers               — search available GPU offers
 * GET    /api/vastai-connector/instances             — list this account's instances
 * POST   /api/vastai-connector/instances             — rent an offer (admin + confirm)
 * POST   /api/vastai-connector/instances/:id/start   — start a stopped instance (admin + confirm)
 * POST   /api/vastai-connector/instances/:id/stop    — stop a running instance (admin + confirm)
 * DELETE /api/vastai-connector/instances/:id         — destroy an instance, irreversible (admin + confirm)
 * POST   /api/vastai-connector/instances/:id/command — run a constrained command (admin + confirm)
 */

import { Router, type IRouter } from "express";
import { requireAdmin, requireConfirmation } from "../middlewares/adminAuth";
import {
  getVastConnectorStatus,
  searchVastOffers,
  createVastInstance,
  listVastInstances,
  setVastInstanceState,
  destroyVastInstance,
  runVastCommand,
} from "../lib/vastaiConnector";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── GET /api/vastai-connector/status ──────────────────────────────────────────

router.get("/vastai-connector/status", async (_req, res): Promise<void> => {
  try {
    const status = await getVastConnectorStatus();
    res.json({ status });
  } catch (err) {
    logger.error({ err }, "vastai-connector/status failed");
    res.status(500).json({ error: "Status check failed" });
  }
});

// ── GET /api/vastai-connector/offers?gpu_name=&num_gpus=&max_price= ──────────

router.get("/vastai-connector/offers", async (req, res): Promise<void> => {
  try {
    const { gpu_name, num_gpus, max_price, verified_only } = req.query as Record<string, string | undefined>;
    const query: Record<string, unknown> = { rentable: { eq: true } };
    if (gpu_name) query["gpu_name"] = { eq: gpu_name };
    if (num_gpus) query["num_gpus"] = { gte: Number(num_gpus) };
    if (max_price) query["dph_total"] = { lte: Number(max_price) };
    if (verified_only === "true") query["verified"] = { eq: true };

    const result = await searchVastOffers(query, Math.min(Number(req.query["limit"] ?? 20), 50));
    if (!result.ok) {
      res.status(502).json({ error: result.error ?? "Failed to search offers" });
      return;
    }
    res.json({ offers: result.offers, count: result.offers.length });
  } catch (err) {
    logger.error({ err }, "vastai-connector/offers failed");
    res.status(500).json({ error: "Failed to search offers" });
  }
});

// ── GET /api/vastai-connector/instances ───────────────────────────────────────

router.get("/vastai-connector/instances", async (_req, res): Promise<void> => {
  try {
    const result = await listVastInstances();
    if (!result.ok) {
      res.status(502).json({ error: result.error ?? "Failed to list instances" });
      return;
    }
    res.json({ instances: result.instances, count: result.instances.length });
  } catch (err) {
    logger.error({ err }, "vastai-connector/instances failed");
    res.status(500).json({ error: "Failed to list instances" });
  }
});

// ── POST /api/vastai-connector/instances — rent an offer ─────────────────────
// Requires ADMIN_TOKEN + X-Admin-Confirm: true — this spends real money.

router.post(
  "/vastai-connector/instances",
  requireAdmin,
  requireConfirmation,
  async (req, res): Promise<void> => {
    try {
      const body = req.body as { offerId?: number; image?: string; disk?: number; onstart?: string; env?: Record<string, string> };
      if (!body.offerId || typeof body.offerId !== "number") {
        res.status(400).json({ ok: false, error: "offerId (number) is required — get one from GET /vastai-connector/offers" });
        return;
      }
      if (!body.image || typeof body.image !== "string") {
        res.status(400).json({ ok: false, error: "image (docker image string) is required" });
        return;
      }

      const result = await createVastInstance({ offerId: body.offerId, image: body.image, disk: body.disk, onstart: body.onstart, env: body.env });
      logger.info({ offerId: body.offerId, contractId: result.contractId, ok: result.ok }, "vastai-connector/instances create");

      if (!result.ok) {
        res.status(502).json({ ok: false, error: result.error ?? "Instance creation failed" });
        return;
      }
      res.status(201).json({
        ok: true,
        instanceId: result.contractId,
        message: "Instance created. It needs time to pull the image and boot — poll GET /vastai-connector/instances until actual_status is 'running'.",
      });
    } catch (err) {
      logger.error({ err }, "vastai-connector/instances create failed");
      res.status(500).json({ ok: false, error: "Instance creation failed" });
    }
  },
);

// ── POST /api/vastai-connector/instances/:id/start ────────────────────────────

router.post(
  "/vastai-connector/instances/:id/start",
  requireAdmin,
  requireConfirmation,
  async (req, res): Promise<void> => {
    try {
      const id = Number(req.params["id"]);
      if (!Number.isFinite(id)) { res.status(400).json({ ok: false, error: "Invalid instance id" }); return; }
      const result = await setVastInstanceState(id, "running");
      if (!result.ok) { res.status(502).json({ ok: false, error: result.error ?? "Start failed" }); return; }
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "vastai-connector/instances start failed");
      res.status(500).json({ ok: false, error: "Start failed" });
    }
  },
);

// ── POST /api/vastai-connector/instances/:id/stop ──────────────────────────────
// Stopping halts compute billing; disk storage charges continue until destroyed.

router.post(
  "/vastai-connector/instances/:id/stop",
  requireAdmin,
  requireConfirmation,
  async (req, res): Promise<void> => {
    try {
      const id = Number(req.params["id"]);
      if (!Number.isFinite(id)) { res.status(400).json({ ok: false, error: "Invalid instance id" }); return; }
      const result = await setVastInstanceState(id, "stopped");
      if (!result.ok) { res.status(502).json({ ok: false, error: result.error ?? "Stop failed" }); return; }
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "vastai-connector/instances stop failed");
      res.status(500).json({ ok: false, error: "Stop failed" });
    }
  },
);

// ── DELETE /api/vastai-connector/instances/:id — irreversible ─────────────────

router.delete(
  "/vastai-connector/instances/:id",
  requireAdmin,
  requireConfirmation,
  async (req, res): Promise<void> => {
    try {
      const id = Number(req.params["id"]);
      if (!Number.isFinite(id)) { res.status(400).json({ ok: false, error: "Invalid instance id" }); return; }
      const result = await destroyVastInstance(id);
      logger.info({ instanceId: id, ok: result.ok }, "vastai-connector/instances destroy");
      if (!result.ok) { res.status(502).json({ ok: false, error: result.error ?? "Destroy failed" }); return; }
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "vastai-connector/instances destroy failed");
      res.status(500).json({ ok: false, error: "Destroy failed" });
    }
  },
);

// ── POST /api/vastai-connector/instances/:id/command ───────────────────────────

router.post(
  "/vastai-connector/instances/:id/command",
  requireAdmin,
  requireConfirmation,
  async (req, res): Promise<void> => {
    try {
      const id = Number(req.params["id"]);
      if (!Number.isFinite(id)) { res.status(400).json({ ok: false, error: "Invalid instance id" }); return; }
      const body = req.body as { command?: string };
      if (!body.command || typeof body.command !== "string") {
        res.status(400).json({ ok: false, error: "command (string) is required" });
        return;
      }
      const result = await runVastCommand(id, body.command);
      if (!result.ok) { res.status(502).json({ ok: false, error: result.error ?? "Command failed" }); return; }
      res.json({ ok: true, output: result.output });
    } catch (err) {
      logger.error({ err }, "vastai-connector/instances command failed");
      res.status(500).json({ ok: false, error: "Command failed" });
    }
  },
);

export default router;
