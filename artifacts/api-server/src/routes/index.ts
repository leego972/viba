import { Router, type IRouter } from "express";
import healthRouter from "./health";
import coreDefaultsRouter from "./coreDefaults";
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
import webResearchRouter from "./webResearch";
import pricingResearchRouter from "./pricingResearch";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(coreDefaultsRouter);
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
router.use(webResearchRouter);
router.use(pricingResearchRouter);

export default router;
