import { Router, type Request } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, sessionsTable, agentsTable, approvalsTable } from "@workspace/db";

const router = Router();

function authenticatedUserId(req: Request): number | null {
  return typeof req.session?.userId === "number" && req.session.userId > 0
    ? req.session.userId
    : null;
}

function parsePositiveId(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Return only the authenticated user's sessions. Legacy rows with no owner are
 * intentionally not exposed through normal user APIs; they require an explicit
 * administrative migration before use.
 */
router.get("/sessions", async (req, res, next): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const rawLimit = Number.parseInt(String(req.query.limit ?? "100"), 10);
    const rawOffset = Number.parseInt(String(req.query.offset ?? "0"), 10);
    const limit = Math.min(Number.isNaN(rawLimit) ? 100 : Math.max(1, rawLimit), 500);
    const offset = Number.isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);

    const sessions = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, userId))
      .orderBy(asc(sessionsTable.id))
      .limit(limit)
      .offset(offset);

    const sessionIds = sessions.map((session) => session.id);
    const agents = sessionIds.length === 0
      ? []
      : await db
          .select()
          .from(agentsTable)
          .where(inArray(agentsTable.sessionId, sessionIds));

    const agentsBySession = agents.reduce<Map<number, typeof agents>>((map, agent) => {
      const existing = map.get(agent.sessionId) ?? [];
      existing.push(agent);
      map.set(agent.sessionId, existing);
      return map;
    }, new Map());

    res.json(sessions.map((session) => ({
      ...session,
      agentModes: (agentsBySession.get(session.id) ?? []).map((agent) => ({
        name: agent.name,
        provider: agent.provider,
        isMock: agent.isMock,
      })),
    })));
  } catch (err) {
    next(err);
  }
});

/**
 * Production sessions must use real provider adapters. Simulation is available
 * only in tests or when an operator explicitly enables ALLOW_SIMULATION_MODE.
 */
router.post("/sessions", (req, res, next): void => {
  const allowSimulation = process.env.NODE_ENV === "test" || process.env.ALLOW_SIMULATION_MODE === "true";
  const agents = Array.isArray(req.body?.agents) ? req.body.agents as Array<Record<string, unknown>> : [];
  const containsMock = agents.some((agent) => agent.isMock === true);

  if (containsMock && !allowSimulation) {
    res.status(422).json({
      error: "simulation_disabled",
      message: "VIBA production sessions require configured live AI providers. Simulation agents are disabled.",
    });
    return;
  }

  next();
});

/**
 * Every nested session route is owner-scoped before the legacy route handler
 * can read or mutate related agents, tasks, messages, approvals, memory, logs,
 * exports, or SSE snapshots.
 */
router.use("/sessions/:id", async (req, res, next): Promise<void> => {
  const userId = authenticatedUserId(req);
  const sessionId = parsePositiveId(req.params.id);

  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!sessionId) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }

  try {
    const [owned] = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)))
      .limit(1);

    if (!owned) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (req.method === "POST" && req.path === "/approve") {
      const approvalId = parsePositiveId(req.body?.approvalId);
      if (!approvalId) {
        res.status(400).json({ error: "Invalid approval id" });
        return;
      }
      const [approval] = await db
        .select({ id: approvalsTable.id })
        .from(approvalsTable)
        .where(and(eq(approvalsTable.id, approvalId), eq(approvalsTable.sessionId, sessionId)))
        .limit(1);
      if (!approval) {
        res.status(404).json({ error: "Approval not found" });
        return;
      }
    }

    next();
  } catch (err) {
    next(err);
  }
});

export default router;
