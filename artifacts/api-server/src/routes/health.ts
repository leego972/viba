import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { fallbackStatus } from "../lib/fallbackPool";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/sessions/:id/provider-health", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "valid session id required" });
    return;
  }
  res.json(await fallbackStatus(id));
});

export default router;
