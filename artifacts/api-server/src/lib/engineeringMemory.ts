import {
  architectureDecisionsTable,
  db,
  engineeringLessonsTable,
  engineeringPatternsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

export interface DecisionRecordInput {
  sessionId: number;
  taskId?: number;
  decisionKey: string;
  title: string;
  context: string;
  decision: string;
  rationale: string;
  alternatives?: Array<{ option: string; reasonRejected?: string }>;
  consequences?: string[];
  affectedModules?: string[];
  affectedInterfaces?: string[];
  evidence?: Array<{ type: string; reference: string; summary?: string }>;
  createdBy?: string;
}

export interface MemoryQuery {
  modules?: string[];
  interfaces?: string[];
  text?: string;
  limit?: number;
}

function normalize(values: string[]): Set<string> {
  return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function overlapScore(left: string[], right: string[]): number {
  const expected = normalize(left);
  let score = 0;
  for (const value of normalize(right)) if (expected.has(value)) score += 1;
  return score;
}

export function rankEngineeringMemory<T extends {
  title: string;
  decision?: string;
  rationale?: string;
  affectedModules?: string[];
  affectedInterfaces?: string[];
}>(records: T[], query: MemoryQuery): T[] {
  const search = (query.text ?? "").trim().toLowerCase();
  const scored = records.map((record, index) => {
    let score = 0;
    score += overlapScore(query.modules ?? [], record.affectedModules ?? []) * 10;
    score += overlapScore(query.interfaces ?? [], record.affectedInterfaces ?? []) * 12;
    if (search) {
      const haystack = [record.title, record.decision ?? "", record.rationale ?? ""].join(" ").toLowerCase();
      if (haystack.includes(search)) score += 8;
      for (const token of search.split(/\s+/).filter(Boolean)) if (haystack.includes(token)) score += 1;
    }
    return { record, score, index };
  });

  return scored
    .filter((item) => item.score > 0 || (!query.text && !(query.modules?.length) && !(query.interfaces?.length)))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, query.limit ?? 10)
    .map((item) => item.record);
}

export async function recordArchitectureDecision(input: DecisionRecordInput): Promise<number> {
  const [latest] = await db
    .select()
    .from(architectureDecisionsTable)
    .where(and(
      eq(architectureDecisionsTable.sessionId, input.sessionId),
      eq(architectureDecisionsTable.decisionKey, input.decisionKey),
    ))
    .orderBy(desc(architectureDecisionsTable.version))
    .limit(1);

  const version = (latest?.version ?? 0) + 1;
  const [row] = await db.insert(architectureDecisionsTable).values({
    sessionId: input.sessionId,
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    decisionKey: input.decisionKey,
    version,
    status: "accepted",
    title: input.title,
    context: input.context,
    decision: input.decision,
    rationale: input.rationale,
    alternatives: input.alternatives ?? [],
    consequences: input.consequences ?? [],
    affectedModules: input.affectedModules ?? [],
    affectedInterfaces: input.affectedInterfaces ?? [],
    evidence: input.evidence ?? [],
    ...(latest ? { supersedesDecisionId: latest.id } : {}),
    createdBy: input.createdBy ?? "orchestrator",
  }).returning({ id: architectureDecisionsTable.id });

  if (!row) throw new Error("Failed to persist architecture decision");
  if (latest) {
    await db
      .update(architectureDecisionsTable)
      .set({ status: "superseded" })
      .where(eq(architectureDecisionsTable.id, latest.id));
  }
  return row.id;
}

export async function listActiveArchitectureDecisions(sessionId: number) {
  return db
    .select()
    .from(architectureDecisionsTable)
    .where(and(
      eq(architectureDecisionsTable.sessionId, sessionId),
      eq(architectureDecisionsTable.status, "accepted"),
    ))
    .orderBy(desc(architectureDecisionsTable.createdAt));
}

export async function retrieveEngineeringMemory(sessionId: number, query: MemoryQuery) {
  const [decisions, patterns, lessons] = await Promise.all([
    listActiveArchitectureDecisions(sessionId),
    db.select().from(engineeringPatternsTable).where(and(
      eq(engineeringPatternsTable.sessionId, sessionId),
      eq(engineeringPatternsTable.status, "approved"),
    )),
    db.select().from(engineeringLessonsTable).where(eq(engineeringLessonsTable.sessionId, sessionId)),
  ]);

  const rankedDecisions = rankEngineeringMemory(decisions, query);
  const rankedPatterns = rankEngineeringMemory(
    patterns.map((pattern) => ({
      ...pattern,
      title: pattern.name,
      decision: pattern.solution,
      rationale: pattern.problem,
      affectedModules: pattern.applicability,
      affectedInterfaces: [],
    })),
    query,
  );
  const rankedLessons = rankEngineeringMemory(
    lessons.map((lesson) => ({
      ...lesson,
      decision: lesson.correctiveAction,
      rationale: lesson.rootCause ?? lesson.observation,
      affectedInterfaces: [],
    })),
    query,
  );

  return { decisions: rankedDecisions, patterns: rankedPatterns, lessons: rankedLessons };
}
