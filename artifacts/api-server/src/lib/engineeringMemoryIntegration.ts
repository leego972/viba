import {
  db,
  engineeringLessonsTable,
  memoryTable,
  operatorProposalsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordArchitectureDecision, retrieveEngineeringMemory } from "./engineeringMemory";
import type { ProposalAssessment } from "./orchestrationGovernance";

export async function captureApprovedProposalDecision(input: {
  proposalId: number;
  assessment: ProposalAssessment;
}): Promise<number | null> {
  if (input.assessment.decision !== "approved" && input.assessment.decision !== "approved_with_conditions") {
    return null;
  }

  const [proposal] = await db
    .select()
    .from(operatorProposalsTable)
    .where(eq(operatorProposalsTable.id, input.proposalId))
    .limit(1);
  if (!proposal) throw new Error("Cannot capture engineering memory for a missing proposal");

  return recordArchitectureDecision({
    sessionId: proposal.sessionId,
    taskId: proposal.taskId,
    decisionKey: `proposal:${proposal.id}`,
    title: proposal.summary,
    context: proposal.rationale,
    decision: input.assessment.decision,
    rationale: input.assessment.reasons.join(" ") || proposal.rationale,
    alternatives: input.assessment.conflictingTaskIds.map((taskId) => ({
      option: `Proceed while task ${taskId} remains active`,
      reasonRejected: "Conflicts with an active task reservation.",
    })),
    consequences: input.assessment.conditions,
    affectedModules: proposal.affectedPaths,
    affectedInterfaces: proposal.affectedInterfaces,
    evidence: [{
      type: "operator_proposal",
      reference: String(proposal.id),
      summary: `Proposal type: ${proposal.proposalType}; risk: ${proposal.risk}`,
    }],
    createdBy: "orchestrator",
  });
}

export async function captureEngineeringLesson(input: {
  sessionId: number;
  taskId?: number;
  lessonType: string;
  severity?: "low" | "medium" | "high" | "critical";
  title: string;
  observation: string;
  rootCause?: string;
  correctiveAction: string;
  preventionRules?: string[];
  affectedModules?: string[];
  evidence?: Record<string, unknown>;
  resolved?: boolean;
}): Promise<number> {
  const [row] = await db.insert(engineeringLessonsTable).values({
    sessionId: input.sessionId,
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    lessonType: input.lessonType,
    severity: input.severity ?? "medium",
    title: input.title,
    observation: input.observation,
    ...(input.rootCause === undefined ? {} : { rootCause: input.rootCause }),
    correctiveAction: input.correctiveAction,
    preventionRules: input.preventionRules ?? [],
    affectedModules: input.affectedModules ?? [],
    evidence: input.evidence ?? {},
    ...(input.resolved ? { resolvedAt: new Date() } : {}),
  }).returning({ id: engineeringLessonsTable.id });

  if (!row) throw new Error("Failed to persist engineering lesson");
  return row.id;
}

function line(value: string, max = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

export async function buildEngineeringMemoryBrief(input: {
  sessionId: number;
  taskTitle: string;
  taskDescription: string;
  modules?: string[];
  interfaces?: string[];
  limit?: number;
}): Promise<string> {
  const memory = await retrieveEngineeringMemory(input.sessionId, {
    text: `${input.taskTitle} ${input.taskDescription}`,
    modules: input.modules ?? [],
    interfaces: input.interfaces ?? [],
    limit: input.limit ?? 6,
  });

  const entries = [
    ...memory.decisions.map((record) => `ADR: ${line(record.title)} — ${line(record.decision)}`),
    ...memory.patterns.map((record) => `PATTERN: ${line(record.title)} — ${line(record.decision ?? "")}`),
    ...memory.lessons.map((record) => `LESSON: ${line(record.title)} — ${line(record.decision ?? "")}`),
  ].slice(0, input.limit ?? 6);

  return entries.length > 0
    ? `[ENGINEERING MEMORY]\n${entries.map((entry) => `• ${entry}`).join("\n")}`
    : "";
}

export async function injectEngineeringMemoryContext(input: {
  sessionId: number;
  taskTitle: string;
  taskDescription: string;
  modules?: string[];
  interfaces?: string[];
}): Promise<string> {
  const brief = await buildEngineeringMemoryBrief(input);
  if (!brief) return "";

  const [current] = await db.select().from(memoryTable).where(eq(memoryTable.sessionId, input.sessionId)).limit(1);
  const withoutPreviousBrief = (current?.summary ?? "")
    .replace(/\n?\[ENGINEERING MEMORY\][\s\S]*$/m, "")
    .trim();
  const summary = [withoutPreviousBrief, brief].filter(Boolean).join("\n\n");

  if (current) {
    await db.update(memoryTable).set({ summary }).where(eq(memoryTable.id, current.id));
  } else {
    await db.insert(memoryTable).values({ sessionId: input.sessionId, summary, decisions: [] });
  }
  return brief;
}
