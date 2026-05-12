import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionsRouter from "./sessions";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sessionsRouter);
router.use(settingsRouter);

export default router;
