import { Router, type IRouter } from "express";
import { getCircuitStatus, getStartupLoadInfo, resetProviderCircuit } from "../lib/adapterRetry";

const router: IRouter = Router();

router.get("/circuit-status", (req, res): void => {
  const info = getStartupLoadInfo();
  res.json({
    entries: getCircuitStatus(),
    lastLoadedAt: info?.loadedAt ?? null,
    restoredCount: info?.restoredCount ?? 0,
  });
});

router.delete(
  "/circuit-status/:provider",
  async (req, res): Promise<void> => {
    const provider = (req.params.provider ?? "").trim();
    if (!provider) {
      res.status(400).json({ error: "provider is required" });
      return;
    }
    await resetProviderCircuit(provider);
    res.json({ ok: true, provider });
  }
);

router.post(
  "/circuit-status/:provider/reset",
  async (req, res): Promise<void> => {
    const provider = (req.params.provider ?? "").trim();
    if (!provider) {
      res.status(400).json({ error: "provider is required" });
      return;
    }
    await resetProviderCircuit(provider);
    res.json({ ok: true, provider });
  }
);

export default router;
