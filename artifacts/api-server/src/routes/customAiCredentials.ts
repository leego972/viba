import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.post("/custom-ai/save", (_req, res): void => {
  res.status(501).json({ error: "CUSTOM_AI_ROUTE_NOT_IMPLEMENTED_ON_MAIN", rawValuesReturned: false });
});

router.get("/custom-ai/list", (_req, res): void => {
  res.json({ customAi: [], rawValuesReturned: false });
});

export default router;
