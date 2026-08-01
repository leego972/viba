import { Router, type IRouter } from "express";
import { requireSessionOrApiKey } from "../middlewares/apiKeyAuth";

const router: IRouter = Router();
router.use("/task-intake", requireSessionOrApiKey("task-intake"));

export default router;
