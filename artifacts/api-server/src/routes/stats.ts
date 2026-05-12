import { Router, type IRouter } from "express";
import { db, auditLogsTable, sessionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/stats", async (req, res): Promise<void> => {
  const [totals] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(sessionsTable);

  const [active] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(sessionsTable)
    .where(eq(sessionsTable.status, "active"));

  const [completed] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(sessionsTable)
    .where(eq(sessionsTable.status, "completed"));

  const [fallbacks] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLogsTable)
    .where(eq(auditLogsTable.eventType, "adapter_fallback"));

  const byProvider = await db
    .select({
      provider: sql<string>`metadata->>'agentId'`,
      count: sql<number>`count(*)::int`,
    })
    .from(auditLogsTable)
    .where(eq(auditLogsTable.eventType, "adapter_fallback"))
    .groupBy(sql`metadata->>'agentId'`);

  res.json({
    totalSessions: totals?.total ?? 0,
    activeSessions: active?.total ?? 0,
    completedSessions: completed?.total ?? 0,
    fallbackEvents: fallbacks?.total ?? 0,
    fallbacksByProvider: byProvider,
  });
});

export default router;
