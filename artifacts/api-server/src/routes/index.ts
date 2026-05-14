import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionsRouter from "./sessions";
import settingsRouter from "./settings";
import statsRouter from "./stats";
import circuitStatusRouter from "./circuitStatus";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sessionsRouter);
router.use(settingsRouter);
router.use(statsRouter);
router.use(circuitStatusRouter);

export default router;
