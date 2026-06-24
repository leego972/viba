import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, auditLogsTable, messagesTable, sessionsTable } from "@workspace/db";

const router: IRouter = Router();

type ReqWithSession = { session?: { userId?: number; bypass?: boolean } };

function sessionIdFromParams(value: string | undefined): number | null {
  const id = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function canAccessSession(req: ReqWithSession, session: typeof sessionsTable.$inferSelect): boolean {
  if (req.session?.bypass) return true;
  const userId = req.session?.userId;
  return typeof userId === "number" && session.userId === userId;
}

function normalizeBudgetCap(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const cap = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(cap)) throw new Error("budgetCapCredits must be a number or null");
  if (cap < 0) throw new Error("budgetCapCredits cannot be negative");
  if (cap > 100000) throw new Error("budgetCapCredits is too high for a single session cap");
  return Math.floor(cap);
}

router.get("/sessions/:id/budget", async (req, res): Promise<void> => {
  const sessionId = sessionIdFromParams(req.params.id);
  if (!sessionId) { res.status(400).json({ error: "invalid_session_id" }); return; }
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session) { res.status(404).json({ error: "session_not_found" }); return; }
  if (!canAccessSession(req, session)) { res.status(403).json({ error: "forbidden" }); return; }
  res.json({
    sessionId,
    budgetCapCredits: session.budgetCapCredits ?? null,
    creditsReserved: session.creditsReserved ?? 0,
    remainingBudgetCredits: session.budgetCapCredits === null || session.budgetCapCredits === undefined
      ? null
      : Math.max(0, session.budgetCapCredits - (session.creditsReserved ?? 0)),
  });
});

router.patch("/sessions/:id/budget", async (req, res): Promise<void> => {
  const sessionId = sessionIdFromParams(req.params.id);
  if (!sessionId) { res.status(400).json({ error: "invalid_session_id" }); return; }
  try {
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    if (!session) { res.status(404).json({ error: "session_not_found" }); return; }
    if (!canAccessSession(req, session)) { res.status(403).json({ error: "forbidden" }); return; }

    const budgetCapCredits = normalizeBudgetCap((req.body as { budgetCapCredits?: unknown })?.budgetCapCredits);
    if (budgetCapCredits !== null && budgetCapCredits < (session.creditsReserved ?? 0)) {
      res.status(409).json({
        error: "budget_cap_below_reserved_credits",
        message: "Budget cap cannot be lower than credits already reserved for this session.",
        creditsReserved: session.creditsReserved ?? 0,
      });
      return;
    }

    const [updated] = await db.update(sessionsTable)
      .set({ budgetCapCredits })
      .where(eq(sessionsTable.id, sessionId))
      .returning();

    await db.insert(auditLogsTable).values({
      sessionId,
      eventType: "session_budget_cap_updated",
      description: budgetCapCredits === null ? "Session budget cap cleared" : `Session budget cap set to ${budgetCapCredits} credits`,
      metadata: { userId: req.session?.userId ?? null, budgetCapCredits },
    });

    await db.insert(messagesTable).values({
      sessionId,
      agentId: null,
      role: "assistant",
      provider: "system",
      agentName: "VIBA System",
      agentRole: "Budget Control",
      content: budgetCapCredits === null
        ? "Session budget cap cleared. Billable actions will still require credits."
        : `Session budget cap set to ${budgetCapCredits} credits. VIBA will pause before exceeding this cap.`,
      messageType: "context",
      metadata: { type: "session_budget_cap_updated", budgetCapCredits },
    });

    res.json({
      ok: true,
      sessionId,
      budgetCapCredits: updated?.budgetCapCredits ?? null,
      creditsReserved: updated?.creditsReserved ?? 0,
    });
  } catch (error) {
    res.status(400).json({ error: "budget_update_failed", message: error instanceof Error ? error.message : "Could not update session budget." });
  }
});

export default router;
