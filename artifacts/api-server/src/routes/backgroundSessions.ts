import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, sessionsTable } from "@workspace/db";
import { isStripeConfigured } from "../lib/billing";
import { getBackgroundRun, startBackgroundFullRun } from "../lib/backgroundSessionRunner";

const router: IRouter = Router();

type ReqWithSession = { session?: { userId?: number; bypass?: boolean } };

function canAccessSession(req: ReqWithSession, session: typeof sessionsTable.$inferSelect): boolean {
  if (req.session?.bypass) return true;
  const userId = req.session?.userId;
  return typeof userId === "number" && session.userId === userId;
}

router.get("/sessions/:id/run-state", async (req, res): Promise<void> => {
  const sessionId = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(sessionId)) { res.status(400).json({ error: "invalid_session_id" }); return; }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session) { res.status(404).json({ error: "session_not_found" }); return; }
  if (!canAccessSession(req, session)) { res.status(403).json({ error: "forbidden" }); return; }

  res.json({ active: Boolean(getBackgroundRun(sessionId)), run: getBackgroundRun(sessionId) });
});

router.post("/sessions/:id/run-full", async (req, res): Promise<void> => {
  const sessionId = Number.parseInt(String(req.params.id ?? ""), 10);
  const userId = req.session?.userId as number | undefined;
  if (!Number.isFinite(sessionId)) { res.status(400).json({ error: "invalid_session_id" }); return; }
  if (!userId && !req.session?.bypass) { res.status(401).json({ error: "not_authenticated" }); return; }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session) { res.status(404).json({ error: "session_not_found" }); return; }
  if (!canAccessSession(req, session)) { res.status(403).json({ error: "forbidden" }); return; }
  if (session.status !== "active") { res.status(409).json({ error: "session_not_active", status: session.status }); return; }

  const billableUserId = userId ?? session.userId ?? 0;
  const result = startBackgroundFullRun({
    sessionId,
    userId: billableUserId,
    firstCreditAlreadyReserved: isStripeConfigured(),
  });

  res.status(result.alreadyRunning ? 200 : 202).json({
    background: true,
    sessionId,
    alreadyRunning: result.alreadyRunning,
    started: result.started,
    message: result.alreadyRunning
      ? "This session is already running in the background."
      : "Full workflow started in the background. You can exit; VIBA will continue until completion, approval, stop, or credits exhausted.",
    runStateUrl: `/api/sessions/${sessionId}/run-state`,
  });
});

export default router;
