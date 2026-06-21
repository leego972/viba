import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionsRouter from "./sessions";
import settingsRouter from "./settings";
import statsRouter from "./stats";
import circuitStatusRouter from "./circuitStatus";
import workbenchRouter from "../workbench/serverRoutes";
import authRouter from "./auth";
import stripeRouter from "./stripe";
import billingRouter from "./billing";
import githubRouter from "./github";
import connectionsRouter from "./connections";
import vibaKeysRouter from "./credentials";

const router: IRouter = Router();

// auth routes are registered first and bypass the ACCESS_TOKEN gate in app.ts
router.use(authRouter);
router.use(healthRouter);
router.use(sessionsRouter);
router.use(settingsRouter);
router.use(statsRouter);
router.use(circuitStatusRouter);
router.use(workbenchRouter);
router.use(stripeRouter);
router.use(billingRouter);
router.use(githubRouter);
router.use(connectionsRouter);
router.use(vibaKeysRouter);

export default router;
