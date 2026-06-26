import { Router, type IRouter } from "express";

const router: IRouter = Router();

const providers = ["railway", "render", "digitalocean", "vercel", "sevall", "custom"];

router.get("/deployment-providers", (_req, res): void => {
  res.json({ providers: providers.map((id) => ({ id, status: id === "railway" ? "available" : "manual_guided" })), rawValuesReturned: false });
});

router.get("/deployment-providers/:providerId", (req, res): void => {
  const providerId = String(req.params.providerId ?? "");
  if (!providers.includes(providerId)) {
    res.status(404).json({ error: "Unknown deployment provider" });
    return;
  }
  res.json({ id: providerId, status: providerId === "railway" ? "available" : "manual_guided", rawValuesReturned: false });
});

export default router;
