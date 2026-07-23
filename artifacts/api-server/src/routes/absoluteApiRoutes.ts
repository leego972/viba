import { Router, type IRouter } from "express";
import agentRuntimeRouter from "./agentRuntime";
import qaReleaseGateRouter from "./qaReleaseGate";
import projectImportRouter from "./projectImport";
import productionOpsSecurityBoundary from "../middlewares/productionOpsSecurityBoundary";
import productionOpsRouter from "./productionOps";
import deploymentProvidersRouter from "./deploymentProviders";
import securityRouter from "./security";
import domainSetupRouter from "./domainSetup";
import betaTesterRouter from "./betaTester";
import seoRouter from "./seo";
import marketingRouter from "./marketing";
import advertisingRouter from "./advertising";
import contentCreatorRouter from "./contentCreator";
import userBrowserRouter from "./userBrowserRouter";
import aiOptimizerRouter from "./aiOptimizer";
import aiBudgetsRouter from "./aiBudgets";
import aiModelsRouter from "./aiModels";
import projectMemoryRouter from "./projectMemory";

/**
 * These legacy modules define absolute /api/... paths internally. They must be
 * dispatched at the application root; mounting them under /api would expose
 * them at /api/api/... and break every corresponding frontend page.
 */
export const absoluteApiPrefixes = [
  "/api/runtime",
  "/api/qa",
  "/api/project-import",
  "/api/production-ops",
  "/api/deployment-providers",
  "/api/security",
  "/api/domain-setup",
  "/api/beta-test",
  "/api/seo",
  "/api/marketing",
  "/api/advertising",
  "/api/content-creator",
  "/api/user-browser",
  "/api/ai",
  "/api/project-memory",
] as const;

const router: IRouter = Router();
router.use(agentRuntimeRouter);
router.use(qaReleaseGateRouter);
router.use(projectImportRouter);
router.use(productionOpsSecurityBoundary);
router.use(productionOpsRouter);
router.use(deploymentProvidersRouter);
router.use(securityRouter);
router.use(domainSetupRouter);
router.use(betaTesterRouter);
router.use(seoRouter);
router.use(marketingRouter);
router.use(advertisingRouter);
router.use(contentCreatorRouter);
router.use(userBrowserRouter);
router.use(aiOptimizerRouter);
router.use(aiBudgetsRouter);
router.use(aiModelsRouter);
router.use(projectMemoryRouter);

export default router;
