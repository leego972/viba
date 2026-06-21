import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { runFullWorkflow, runNextAgentStep } from "../lib/agentLoop";
import { fallbackStatus } from "../lib/fallbackPool";

const router: IRouter = Router();

function idParam(value: string | undefined): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/sessions/:id/provider-health", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  if (!id) { res.status(400).json({ error: "valid session id required" }); return; }
  res.json(await fallbackStatus(id));
});

router.post("/sessions/:id/run-next-resilient", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  if (!id) { res.status(400).json({ error: "valid session id required" }); return; }
  const result = await runNextAgentStep(id);
  res.json({ ...result, resilient: true });
});

router.post("/sessions/:id/run-full-resilient", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  if (!id) { res.status(400).json({ error: "valid session id required" }); return; }
  const result = await runFullWorkflow(id);
  res.json({ ...result, resilient: true });
});

export default router;
