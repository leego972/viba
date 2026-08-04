import { db, improvementRecommendationsTable, memoryTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";

const PRIORITIES = ["critical", "high", "medium"];

function compact(value: string, max = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

export async function injectContinuousImprovementContext(sessionId: number): Promise<string> {
  const rows = await db
    .select()
    .from(improvementRecommendationsTable)
    .where(and(
      eq(improvementRecommendationsTable.sessionId, sessionId),
      eq(improvementRecommendationsTable.status, "proposed"),
      inArray(improvementRecommendationsTable.priority, PRIORITIES),
    ))
    .orderBy(desc(improvementRecommendationsTable.confidence))
    .limit(5);

  const brief = rows.length > 0
    ? `[CONTINUOUS IMPROVEMENT]\n${rows.map((row) => `• ${row.priority.toUpperCase()}: ${compact(row.title)} — ${compact(row.expectedBenefit)}`).join("\n")}`
    : "";
  if (!brief) return "";

  const [memory] = await db.select().from(memoryTable).where(eq(memoryTable.sessionId, sessionId)).limit(1);
  const withoutPrevious = (memory?.summary ?? "")
    .replace(/\n?\[CONTINUOUS IMPROVEMENT\][\s\S]*$/m, "")
    .trim();
  const summary = [withoutPrevious, brief].filter(Boolean).join("\n\n");

  if (memory) {
    await db.update(memoryTable).set({ summary }).where(eq(memoryTable.id, memory.id));
  } else {
    await db.insert(memoryTable).values({ sessionId, summary, decisions: [] });
  }
  return brief;
}
