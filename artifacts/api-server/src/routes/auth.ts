import { Router, type IRouter } from "express";
import { accessTokenMiddleware } from "../middlewares/accessToken";
import { isStripeConfigured, getPublishableKey } from "../lib/stripe/client";

const router: IRouter = Router();

// GET /auth/config — describes the authentication mode for this deployment
// mode: "stripe" | "password" | "open"
// Stripe takes precedence; if neither is set the app is open.
router.get("/auth/config", (_req, res): void => {
  const configuredToken = process.env["ACCESS_TOKEN"]?.trim();
  const stripeMode = isStripeConfigured();
  const passwordMode = !!configuredToken;

  const mode: "stripe" | "password" | "open" = stripeMode
    ? "stripe"
    : passwordMode
      ? "password"
      : "open";

  res.json({
    protected: stripeMode || passwordMode,
    mode,
    publishableKey: stripeMode ? getPublishableKey() : null,
  });
});

// POST /auth/verify — verify a submitted access token (password mode only)
router.post("/auth/verify", (req, res, next) => {
  accessTokenMiddleware(req, res, next);
}, (_req, res) => {
  res.json({ ok: true });
});

// POST /auth/verify-bypass — verify the Archibald Titan embed bypass token.
// When valid, the frontend stores the result in sessionStorage so embedded
// users skip the subscription gate entirely.
router.post("/auth/verify-bypass", (req, res): void => {
  const bypassToken = process.env["ARCHIBALD_BYPASS_TOKEN"]?.trim();
  if (!bypassToken) {
    res.status(404).json({ error: "Bypass not configured" });
    return;
  }

  const body = req.body as { token?: unknown };
  const provided = typeof body.token === "string" ? body.token.trim() : "";

  if (!provided || provided !== bypassToken) {
    res.status(401).json({ error: "Invalid bypass token" });
    return;
  }

  res.json({ valid: true });
});

export default router;
