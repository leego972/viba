import { and, asc, eq } from "drizzle-orm";
import { db, sessionsTable, agentsTable, tasksTable, approvalsTable, auditLogsTable } from "@workspace/db";
import { routeTaskWithDecision } from "./taskRouter";

const QUALITY_FLOOR: Record<string, number> = {
  planning: 0.68,
  research: 0.62,
  creative_direction: 0.68,
  copywriting: 0.65,
  build: 0.78,
  code_review: 0.80,
  ux_review: 0.72,
  final_qa: 0.85,
  deployment_approval: 0.82,
};

const PROVIDER_QUALITY: Record<string, number> = {
  ollama: 0.62,
  groq: 0.74,
  google: 0.82,
  gemini: 0.82,
  deepseek: 0.79,
  mistral: 0.78,
  perplexity: 0.80,
  openai: 0.90,
  anthropic: 0.93,
  venice: 0.72,
  railway: 0.86,
  custom: 0.70,
};

export interface QualityGateResult {
  allowed: boolean;
  approvalRequired: boolean;
  approval: typeof approvalsTable.$inferSelect | null;
  selectedAgentId: number | null;
  selectedProvider: string | null;
  selectedQuality: number | null;
  qualityFloor: number | null;
  reason: string;
}

/**
 * Single-AI sessions are valid. This gate never requires multiple providers.
 * It only pauses when the best available provider is below the task's quality
 * floor and the user has not already approved that exact task/provider pairing.
 */
export async function evaluateQualityGate(sessionId: number): Promise<QualityGateResult> {
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session || session.status !== "active") {
    return { allowed: true, approvalRequired: false, approval: null, selectedAgentId: null, selectedProvider: null, selectedQuality: null, qualityFloor: null, reason: "Session is not active." };
  }

  const [agents, tasks] = await Promise.all([
    db.select().from(agentsTable).where(eq(agentsTable.sessionId, sessionId)),
    db.select().from(tasksTable).where(eq(tasksTable.sessionId, sessionId)).orderBy(asc(tasksTable.id)),
  ]);

  const activeAgents = agents.filter((agent) => !agent.satOutReason);
  const task = tasks.find((candidate) => candidate.status === "planned");
  if (!task || activeAgents.length === 0) {
    return { allowed: true, approvalRequired: false, approval: null, selectedAgentId: null, selectedProvider: null, selectedQuality: null, qualityFloor: null, reason: "No planned task or active provider requires quality evaluation." };
  }

  const decision = routeTaskWithDecision(task, activeAgents);
  if (!decision.agent) {
    return { allowed: true, approvalRequired: false, approval: null, selectedAgentId: null, selectedProvider: null, selectedQuality: null, qualityFloor: null, reason: "No routing candidate was selected." };
  }

  const provider = decision.agent.provider.toLowerCase();
  const selectedQuality = PROVIDER_QUALITY[provider] ?? 0.70;
  const qualityFloor = QUALITY_FLOOR[task.type] ?? 0.65;
  if (selectedQuality >= qualityFloor) {
    return {
      allowed: true,
      approvalRequired: false,
      approval: null,
      selectedAgentId: decision.agent.id,
      selectedProvider: provider,
      selectedQuality,
      qualityFloor,
      reason: decision.reason,
    };
  }

  const approvalType = `quality_override:${task.id}:${decision.agent.id}`;
  const [approved] = await db
    .select()
    .from(approvalsTable)
    .where(and(
      eq(approvalsTable.sessionId, sessionId),
      eq(approvalsTable.type, approvalType),
      eq(approvalsTable.status, "approved"),
    ));

  if (approved) {
    return {
      allowed: true,
      approvalRequired: false,
      approval: approved,
      selectedAgentId: decision.agent.id,
      selectedProvider: provider,
      selectedQuality,
      qualityFloor,
      reason: `User approved lower-quality execution for task ${task.id} using ${provider}.`,
    };
  }

  const [pending] = await db
    .select()
    .from(approvalsTable)
    .where(and(
      eq(approvalsTable.sessionId, sessionId),
      eq(approvalsTable.type, approvalType),
      eq(approvalsTable.status, "pending"),
    ));

  if (pending) {
    return {
      allowed: false,
      approvalRequired: true,
      approval: pending,
      selectedAgentId: decision.agent.id,
      selectedProvider: provider,
      selectedQuality,
      qualityFloor,
      reason: pending.description,
    };
  }

  const description =
    `Only ${decision.agent.name} (${provider}) is currently selected for task "${task.title}". ` +
    `Its estimated quality score is ${Math.round(selectedQuality * 100)}%, below the ${Math.round(qualityFloor * 100)}% target for ${task.type}. ` +
    `VIBA can still continue in single-AI mode, but output quality may be reduced. Approve this task to continue.`;

  const [approval] = await db.insert(approvalsTable).values({
    sessionId,
    type: approvalType,
    description,
    status: "pending",
  }).returning();

  await db.insert(auditLogsTable).values({
    sessionId,
    eventType: "quality_override_requested",
    description,
    metadata: {
      taskId: task.id,
      taskType: task.type,
      agentId: decision.agent.id,
      provider,
      selectedQuality,
      qualityFloor,
      singleAiMode: activeAgents.length === 1,
      routingReason: decision.reason,
    },
  });

  return {
    allowed: false,
    approvalRequired: true,
    approval: approval ?? null,
    selectedAgentId: decision.agent.id,
    selectedProvider: provider,
    selectedQuality,
    qualityFloor,
    reason: description,
  };
}
