import { Router, type IRouter } from "express";
import { getCircuitStatus, resetProviderCircuit } from "../lib/adapterRetry";

const router: IRouter = Router();

router.get("/circuit-status", (req, res): void => {
  res.json(getCircuitStatus());
});

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
