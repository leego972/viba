/**
 * VIBA Proof Report Routes
 *
 * GET  /proof-report/demo          — public demo report (no auth required beyond ACCESS_TOKEN)
 * GET  /proof-report/session/:id   — full proof report for a specific session (user-scoped)
 *
 * All responses are scrubbed of secrets. rawValuesReturned is always false.
 */
import { Router } from "express";
import { buildDemoProofReport, generateSessionProofReport } from "../lib/proofReport";

const router = Router();

// GET /proof-report/demo — static demo, no DB needed
router.get("/proof-report/demo", (_req, res): void => {
  const report = buildDemoProofReport();
  res.json(report);
});

// GET /proof-report/session/:id — live session proof report (requires authenticated session)
router.get("/proof-report/session/:id", async (req, res): Promise<void> => {
  const sessionId = parseInt(String(req.params["id"] ?? ""), 10);
  // BUG 1 FIX: use req.session?.userId — the app session middleware sets this field,
  // not req.userId (which was never populated by any middleware).
  const userId: number | undefined = req.session?.userId;

  if (!sessionId || isNaN(sessionId)) {
    res.status(400).json({ error: "invalid_session_id", message: "Session ID must be a positive integer." });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "unauthorized", message: "Authentication required." });
    return;
  }

  try {
    const report = await generateSessionProofReport(sessionId, userId);
    res.json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Session not found or access denied.") {
      res.status(404).json({ error: "not_found", message: msg });
    } else {
      res.status(500).json({ error: "internal_error", message: "Failed to generate proof report." });
    }
  }
});

export default router;
