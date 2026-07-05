import { Router, type IRouter } from "express";
import { requireAdmin } from "../middlewares/adminAuth";
import {
  startAdvertisingScheduler,
  stopAdvertisingScheduler,
  getAdvertisingSchedulerStatus,
  runOrganicGrowthAutopilotCycle,
  getStrategyOverview,
} from "../engines/advertisingEngine";

const router: IRouter = Router();

router.get("/api/growth-autopilot/status", requireAdmin, async (_req, res): Promise<void> => {
  res.json({
    success: true,
    scheduler: getAdvertisingSchedulerStatus(),
    strategy: getStrategyOverview(),
  });
});

router.post("/api/growth-autopilot/start", requireAdmin, async (_req, res): Promise<void> => {
  startAdvertisingScheduler();
  res.json({
    success: true,
    message: "VIBA Growth Autopilot started",
    scheduler: getAdvertisingSchedulerStatus(),
  });
});

router.post("/api/growth-autopilot/stop", requireAdmin, async (_req, res): Promise<void> => {
  stopAdvertisingScheduler();
  res.json({
    success: true,
    message: "VIBA Growth Autopilot stopped",
    scheduler: getAdvertisingSchedulerStatus(),
  });
});

router.post("/api/growth-autopilot/run-now", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await runOrganicGrowthAutopilotCycle());
});

export default router;
