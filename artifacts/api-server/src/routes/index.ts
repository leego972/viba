import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionsRouter from "./sessions";
import settingsRouter from "./settings";
import statsRouter from "./stats";
import circuitStatusRouter from "./circuitStatus";
import workbenchRouter from "../workbench/serverRoutes";
import authRouter from "./auth";

const router: IRouter = Router();

// auth routes are registered first and bypass the ACCESS_TOKEN gate in app.ts
router.use(authRouter);
router.use(healthRouter);
router.use(sessionsRouter);
router.use(settingsRouter);
router.use(statsRouter);
router.use(circuitStatusRouter);
router.use(workbenchRouter);

export default router;
