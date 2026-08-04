import {
  aiUsageEventsTable,
  architectureDecisionsTable,
  auditLogsTable,
  db,
  engineeringLessonsTable,
  governanceReservationsTable,
  improvementRecommendationsTable,
  operatorPerformanceSnapshotsTable,
  operatorProposalsTable,
  systemHealthSnapshotsTable,
  tasksTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  generateImprovementRecommendations,
  scoreSystem,
  scoreWorker,
  type ImprovementRecommendation,
  type WorkerScore,
} from "./continuousImprovement";

function numberFromMetadata(metadata: unknown, key: string): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function activeConflictCount(rows: Array<{ taskId: number; resourceType: string; resourceKey: string }>): number {
  const owners = new Map<string, Set<number>>();
  for (const row of rows) {
    const key = `${row.resourceType}:${row.resourceKey}`;
    const tasks = owners.get(key) ?? new Set<number>();
    tasks.add(row.taskId);
    owners.set(key, tasks);
  }
  return [...owners.values()].filter((tasks) => tasks.size > 1).length;
}

async function nextWorkerVersion(sessionId: number, agentId: number): Promise<number> {
  const [latest] = await db
    .select({ version: operatorPerformanceSnapshotsTable.version })
    .from(operatorPerformanceSnapshotsTable)
    .where(and(
      eq(operatorPerformanceSnapshotsTable.sessionId, sessionId),
      eq(operatorPerformanceSnapshotsTable.agentId, agentId),
    ))
    .orderBy(desc(operatorPerformanceSnapshotsTable.version))
    .limit(1);
  return (latest?.version ?? 0) + 1;
}

async function nextSystemVersion(sessionId: number): Promise<number> {
  const [latest] = await db
    .select({ version: systemHealthSnapshotsTable.version })
    .from(systemHealthSnapshotsTable)
    .where(eq(systemHealthSnapshotsTable.sessionId, sessionId))
    .orderBy(desc(systemHealthSnapshotsTable.version))
    .limit(1);
  return (latest?.version ?? 0) + 1;
}

async function persistRecommendations(sessionId: number, recommendations: ImprovementRecommendation[]): Promise<void> {
  for (const recommendation of recommendations) {
    const [existing] = await db
      .select({ id: improvementRecommendationsTable.id })
      .from(improvementRecommendationsTable)
      .where(and(
        eq(improvementRecommendationsTable.sessionId, sessionId),
        eq(improvementRecommendationsTable.recommendationKey, recommendation.key),
      ))
      .limit(1);
    const values = {
      category: recommendation.category,
      priority: recommendation.priority,
      status: "proposed",
      title: recommendation.title,
      rationale: recommendation.rationale,
      expectedBenefit: recommendation.expectedBenefit,
      confidence: recommendation.confidence,
      evidence: recommendation.evidence,
    };
    if (existing) {
      await db.update(improvementRecommendationsTable).set(values).where(eq(improvementRecommendationsTable.id, existing.id));
    } else {
      await db.insert(improvementRecommendationsTable).values({
        sessionId,
        recommendationKey: recommendation.key,
        ...values,
      });
    }
  }
}

export async function refreshContinuousImprovementSnapshot(sessionId: number): Promise<{
  workers: WorkerScore[];
  recommendations: ImprovementRecommendation[];
  systemVersion: number;
}> {
  const [tasks, audits, reservations, proposals, lessons, decisions, usage] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.sessionId, sessionId)),
    db.select().from(auditLogsTable).where(eq(auditLogsTable.sessionId, sessionId)),
    db.select().from(governanceReservationsTable).where(and(
      eq(governanceReservationsTable.sessionId, sessionId),
      eq(governanceReservationsTable.status, "active"),
    )),
    db.select().from(operatorProposalsTable).where(eq(operatorProposalsTable.sessionId, sessionId)),
    db.select().from(engineeringLessonsTable).where(eq(engineeringLessonsTable.sessionId, sessionId)),
    db.select().from(architectureDecisionsTable).where(eq(architectureDecisionsTable.sessionId, sessionId)),
    db.select().from(aiUsageEventsTable).where(eq(aiUsageEventsTable.sessionId, sessionId)),
  ]);

  const recoveredByAgent = new Map<number, number>();
  for (const audit of audits.filter((row) => row.eventType === "coordination_recover")) {
    const agentId = numberFromMetadata(audit.metadata, "agentId");
    if (agentId !== null) recoveredByAgent.set(agentId, (recoveredByAgent.get(agentId) ?? 0) + 1);
  }

  const agentIds = [...new Set(tasks.map((task) => task.assignedAgentId).filter((id): id is number => id !== null))];
  const workerScores: WorkerScore[] = [];
  for (const agentId of agentIds) {
    const assigned = tasks.filter((task) => task.assignedAgentId === agentId);
    const durations = assigned.map((task) => Math.max(0, task.updatedAt.getTime() - task.createdAt.getTime()));
    const costs = assigned.map((task) => task.costEstimate ?? 0);
    const qualitySignals = assigned.map((task) => task.status === "complete" ? 1 : task.status === "review" ? 0.45 : task.status === "blocked_needs_tools" ? 0.2 : 0.6);
    const input = {
      agentId,
      completedTasks: assigned.filter((task) => task.status === "complete").length,
      reviewedTasks: assigned.filter((task) => task.status === "review").length,
      recoveredTasks: recoveredByAgent.get(agentId) ?? 0,
      blockedTasks: assigned.filter((task) => task.status === "blocked_needs_tools").length,
      averageCostUsd: average(costs),
      averageDurationMs: average(durations),
      qualitySignals,
    };
    const score = scoreWorker(input);
    workerScores.push(score);
    await db.insert(operatorPerformanceSnapshotsTable).values({
      sessionId,
      agentId,
      version: await nextWorkerVersion(sessionId, agentId),
      ...input,
      ...score,
      evidence: { taskIds: assigned.map((task) => task.id) },
    });
  }

  const conflicts = activeConflictCount(reservations);
  const unresolvedHighSeverityLessons = lessons.filter((lesson) =>
    (lesson.severity === "high" || lesson.severity === "critical") && lesson.resolvedAt === null,
  ).length;
  const systemInput = {
    totalTasks: tasks.length,
    completedTasks: tasks.filter((task) => task.status === "complete").length,
    reviewedTasks: tasks.filter((task) => task.status === "review").length,
    recoveries: audits.filter((row) => row.eventType === "coordination_recover").length,
    coordinationBlocks: audits.filter((row) => row.eventType === "coordination_blocked" || row.eventType === "coordination_wait_for_dependencies").length,
    activeConflicts: conflicts,
    proposalsApproved: proposals.filter((proposal) => proposal.status === "approved" || proposal.status === "approved_with_conditions").length,
    proposalsRejected: proposals.filter((proposal) => proposal.status === "rejected").length,
    proposalsDeferred: proposals.filter((proposal) => proposal.status === "deferred").length,
    unresolvedHighSeverityLessons,
    totalLessons: lessons.length,
    activeArchitectureDecisions: decisions.filter((decision) => decision.status === "accepted").length,
    supersededArchitectureDecisions: decisions.filter((decision) => decision.status === "superseded").length,
    memoryEntriesUsed: audits.filter((row) => row.eventType === "engineering_memory_context_injected").length,
    usageEvents: usage.length,
    successfulUsageEvents: usage.filter((event) => event.success).length,
    estimatedSpendUsd: usage.reduce((sum, event) => sum + event.estimatedCostUsd, 0),
    estimatedSpendWithoutOptimisationUsd: usage.reduce((sum, event) => sum + event.estimatedCostWithoutOptimisation, 0),
  };
  const system = scoreSystem(systemInput);
  const systemVersion = await nextSystemVersion(sessionId);
  await db.insert(systemHealthSnapshotsTable).values({
    sessionId,
    version: systemVersion,
    ...system,
    unresolvedHighSeverityLessons,
    activeConflictCount: conflicts,
    metrics: systemInput,
  });

  const recommendations = generateImprovementRecommendations({
    workers: workerScores,
    system,
    unresolvedHighSeverityLessons,
    activeConflicts: conflicts,
  });
  await persistRecommendations(sessionId, recommendations);
  return { workers: workerScores, recommendations, systemVersion };
}

export async function getLatestWorkerReliability(sessionId: number): Promise<Map<number, number>> {
  const rows = await db
    .select()
    .from(operatorPerformanceSnapshotsTable)
    .where(eq(operatorPerformanceSnapshotsTable.sessionId, sessionId))
    .orderBy(desc(operatorPerformanceSnapshotsTable.version));
  const scores = new Map<number, number>();
  for (const row of rows) if (!scores.has(row.agentId)) scores.set(row.agentId, row.reliabilityScore);
  return scores;
}
