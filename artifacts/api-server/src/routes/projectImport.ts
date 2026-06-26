import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/project-import/status", (_req, res): void => {
  res.json({ status: "unavailable", rawValuesReturned: false });
});

router.post("/project-import/analyze", (_req, res): void => {
  res.status(501).json({ error: "PROJECT_IMPORT_ROUTE_NOT_IMPLEMENTED_ON_MAIN", rawValuesReturned: false });
});

export default router;
