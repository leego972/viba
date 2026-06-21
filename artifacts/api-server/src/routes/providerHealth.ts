import { Router, type IRouter } from "express";
import { fallbackStatus } from "../lib/fallbackPool";

const router: IRouter = Router();

router.get("/sessions/:id/provider-health", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "valid session id required" });
    return;
  }
  const status = await fallbackStatus(id);
  res.json(status);
});

export default router;
