import { Router, type IRouter } from "express";
import { requireAdmin } from "../middlewares/adminAuth";
import {
  getAutonomousGrowthStatus,
  restartAutonomousGrowthScheduler,
  runAutonomousGrowthCycle,
  stopAutonomousGrowthScheduler,
} from "../engines/autonomousGrowthEngine";
import { getStrategyOverview } from "../engines/advertisingEngine";

const router: IRouter = Router();

router.get("/growth-autopilot/status", requireAdmin, async (_req, res): Promise<void> => {
  res.json({
    success: true,
    scheduler: await getAutonomousGrowthStatus(),
    strategy: getStrategyOverview(),
  });
});

router.post("/growth-autopilot/start", requireAdmin, async (_req, res): Promise<void> => {
  res.json({
    success: true,
    message: "VIBA Growth Autopilot started",
    scheduler: await restartAutonomousGrowthScheduler(),
  });
});

router.post("/growth-autopilot/stop", requireAdmin, async (_req, res): Promise<void> => {
  res.json({
    success: true,
    message: "VIBA Growth Autopilot stopped",
    scheduler: await stopAutonomousGrowthScheduler(),
  });
});

router.post("/growth-autopilot/run-now", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await runAutonomousGrowthCycle("growth-autopilot-api"));
});

export default router;
