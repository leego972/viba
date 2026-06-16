import { Router, type IRouter } from "express";
import { getCircuitStatus, getStartupLoadInfo, resetProviderCircuit } from "../lib/adapterRetry";
import { requireAdmin } from "../middlewares/adminAuth";

const router: IRouter = Router();

router.get("/circuit-status", (_req, res): void => {
  const info = getStartupLoadInfo();
  res.json({
    entries: getCircuitStatus(),
    lastLoadedAt: info?.loadedAt ?? null,
    restoredCount: info?.restoredCount ?? 0,
  });
});

// Admin-only: resetting a circuit forces live API traffic and can burn API credits.
router.delete("/circuit-status/:provider", requireAdmin, async (req, res): Promise<void> => {
  const provider = String(req.params.provider ?? "").trim();
  if (!provider) { res.status(400).json({ error: "provider is required" }); return; }
  await resetProviderCircuit(provider);
  req.log.warn({ adminAction: "reset_circuit", provider }, "Circuit reset via status route");
  res.json({ ok: true, provider });
});

router.post("/circuit-status/:provider/reset", requireAdmin, async (req, res): Promise<void> => {
  const provider = String(req.params.provider ?? "").trim();
  if (!provider) { res.status(400).json({ error: "provider is required" }); return; }
  await resetProviderCircuit(provider);
  req.log.warn({ adminAction: "reset_circuit", provider }, "Circuit reset via status route");
  res.json({ ok: true, provider });
});

export default router;
