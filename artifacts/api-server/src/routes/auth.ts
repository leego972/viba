import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { isAccessTokenConfigured, validateToken } from "../middlewares/accessToken";

const router: IRouter = Router();

/**
 * GET /auth/config
 * Returns whether ACCESS_TOKEN protection is active.
 * Intentionally unprotected — the frontend needs this before it has a token.
 */
router.get("/auth/config", (_req, res): void => {
  res.json({ protected: isAccessTokenConfigured() });
});

const VerifyBody = z.object({ token: z.string().min(1).max(512) });

/**
 * POST /auth/verify
 * Validates a candidate access token.
 * Intentionally unprotected — used by the frontend gate to verify the passcode.
 */
router.post("/auth/verify", (req, res): void => {
  const parsed = VerifyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "token is required" });
    return;
  }
  if (!validateToken(parsed.data.token)) {
    res.status(401).json({ error: "Invalid access token" });
    return;
  }
  res.json({ ok: true });
});

export default router;
