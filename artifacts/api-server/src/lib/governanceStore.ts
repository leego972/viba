import {
  db,
  governanceReservationsTable,
  operatorProposalsTable,
  proposalDecisionsTable,
  taskContractsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { captureApprovedProposalDecision } from "./engineeringMemoryIntegration";
import type {
  ActiveReservation,
  ImprovementProposal,
  ProposalAssessment,
  TaskContract,
} from "./orchestrationGovernance";

export type GovernanceMode = "audit" | "enforce";

export interface ExecutionAuthorization {
  allowed: boolean;
  mode: GovernanceMode;
  contract: TaskContract | null;
  reason: string;
}

function modeFromEnvironment(): GovernanceMode {
  return process.env.VIBA_GOVERNANCE_MODE?.toLowerCase() === "audit" ? "audit" : "enforce";
}

function toRuntimeContract(row: typeof taskContractsTable.$inferSelect): TaskContract {
  return {
    id: String(row.id),
    version: row.version,
    sessionId: row.sessionId,
    taskId: row.taskId,
    objective: row.objective,
    assignedAgentId: row.assignedAgentId ?? 0,
    allowedPaths: row.allowedPaths,
    forbiddenPaths: row.forbiddenPaths,
    ownedInterfaces: row.ownedInterfaces,
    dependencies: row.dependencyTaskIds,
    requiredChecks: row.requiredChecks,
    ...(row.maxEstimatedCost === null ? {} : { maxEstimatedCost: row.maxEstimatedCost }),
    ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt.toISOString() }),
  };
}

export function evaluateExecutionAuthorization(input: {
  taskId: number;
  sessionId: number;
  agentId: number;
  mode: GovernanceMode;
  contract: TaskContract | null;
}): ExecutionAuthorization {
  const { contract, mode } = input;
  if (!contract) {
    return {
      allowed: mode === "audit",
      mode,
      contract: null,
      reason: mode === "audit"
        ? "No active task contract; execution allowed in audit mode."
        : "Execution blocked: no active task contract.",
    };
  }
  if (contract.taskId !== input.taskId) {
    return { allowed: false, mode, contract, reason: "Execution blocked: contract belongs to another task." };
  }
  if (contract.sessionId !== input.sessionId) {
    return { allowed: false, mode, contract, reason: "Execution blocked: contract belongs to another session." };
  }
  if (contract.assignedAgentId > 0 && contract.assignedAgentId !== input.agentId) {
    return { allowed: false, mode, contract, reason: "Execution blocked: contract is assigned to another operator." };
  }
  if (contract.expiresAt && Date.parse(contract.expiresAt) <= Date.now()) {
    return { allowed: false, mode, contract, reason: "Execution blocked: task contract has expired." };
  }
  return { allowed: true, mode, contract, reason: "Execution authorized by active task contract." };
}

export async function getActiveTaskContract(taskId: number): Promise<TaskContract | null> {
  const [row] = await db
    .select()
    .from(taskContractsTable)
    .where(and(eq(taskContractsTable.taskId, taskId), eq(taskContractsTable.status, "active")))
    .orderBy(desc(taskContractsTable.version))
    .limit(1);

  if (!row) return null;
  return toRuntimeContract(row);
}

export async function authorizeTaskExecution(input: {
  taskId: number;
  sessionId: number;
  agentId: number;
  mode?: GovernanceMode;
}): Promise<ExecutionAuthorization> {
  const mode = input.mode ?? modeFromEnvironment();
  const contract = await getActiveTaskContract(input.taskId);
  return evaluateExecutionAuthorization({ ...input, mode, contract });
}

export async function listActiveReservations(sessionId: number): Promise<ActiveReservation[]> {
  const rows = await db
    .select()
    .from(governanceReservationsTable)
    .where(and(
      eq(governanceReservationsTable.sessionId, sessionId),
      eq(governanceReservationsTable.status, "active"),
    ));

  const grouped = new Map<number, ActiveReservation>();
  for (const row of rows) {
    const current = grouped.get(row.taskId) ?? {
      contractId: String(row.contractId),
      taskId: row.taskId,
      agentId: row.agentId ?? 0,
      paths: [],
      interfaces: [],
    };
    if (row.resourceType === "path") current.paths.push(row.resourceKey);
    if (row.resourceType === "interface") current.interfaces.push(row.resourceKey);
    grouped.set(row.taskId, current);
  }
  return [...grouped.values()];
}

export async function reserveContractResources(contract: TaskContract): Promise<void> {
  const contractId = Number(contract.id);
  if (!Number.isSafeInteger(contractId)) throw new Error("Persisted contract id must be numeric");

  const existing = await db
    .select()
    .from(governanceReservationsTable)
    .where(and(
      eq(governanceReservationsTable.contractId, contractId),
      eq(governanceReservationsTable.status, "active"),
    ));
  if (existing.length > 0) return;

  const rows = [
    ...contract.allowedPaths.map((resourceKey) => ({ resourceType: "path", resourceKey })),
    ...contract.ownedInterfaces.map((resourceKey) => ({ resourceType: "interface", resourceKey })),
  ];
  if (rows.length === 0) return;

  await db.insert(governanceReservationsTable).values(rows.map((row) => ({
    sessionId: contract.sessionId,
    taskId: contract.taskId,
    contractId,
    agentId: contract.assignedAgentId || null,
    resourceType: row.resourceType,
    resourceKey: row.resourceKey,
    status: "active",
  })));
}

export async function releaseTaskReservations(taskId: number): Promise<void> {
  await db
    .update(governanceReservationsTable)
    .set({ status: "released", releasedAt: new Date() })
    .where(and(
      eq(governanceReservationsTable.taskId, taskId),
      eq(governanceReservationsTable.status, "active"),
    ));
}

export async function persistImprovementProposal(
  proposal: ImprovementProposal,
  expectedBenefits: string[] = [],
): Promise<number> {
  const contractId = Number(proposal.contractId);
  if (!Number.isSafeInteger(contractId)) throw new Error("Persisted contract id must be numeric");

  const [contract] = await db
    .select({ sessionId: taskContractsTable.sessionId, taskId: taskContractsTable.taskId })
    .from(taskContractsTable)
    .where(eq(taskContractsTable.id, contractId))
    .limit(1);
  if (!contract) throw new Error("Cannot persist a proposal for a missing task contract");
  if (contract.taskId !== proposal.taskId) throw new Error("Proposal task does not match its task contract");

  const estimatedCost: Record<string, number> = {};
  if (proposal.estimatedImplementationCost !== undefined) estimatedCost.implementation = proposal.estimatedImplementationCost;
  if (proposal.estimatedMonthlyCostDelta !== undefined) estimatedCost.monthlyDelta = proposal.estimatedMonthlyCostDelta;
  if (proposal.estimatedSavingsPercent !== undefined) estimatedCost.savingsPercent = proposal.estimatedSavingsPercent;

  const [row] = await db.insert(operatorProposalsTable).values({
    sessionId: contract.sessionId,
    taskId: proposal.taskId,
    contractId,
    agentId: proposal.proposedByAgentId,
    proposalType: proposal.type,
    summary: proposal.summary,
    rationale: proposal.rationale,
    affectedPaths: proposal.requestedPaths,
    affectedInterfaces: proposal.affectedInterfaces,
    requestedDependencies: proposal.requestedDependencies,
    expectedBenefits,
    estimatedCost,
    risk: proposal.risk,
    status: "pending",
  }).returning({ id: operatorProposalsTable.id });
  if (!row) throw new Error("Failed to persist operator proposal");
  return row.id;
}

export async function persistProposalDecision(input: {
  proposalId: number;
  assessment: ProposalAssessment;
  contractVersionCreated?: number;
}): Promise<void> {
  await db.insert(proposalDecisionsTable).values({
    proposalId: input.proposalId,
    decision: input.assessment.decision,
    reason: input.assessment.reasons.join(" "),
    conditions: input.assessment.conditions,
    conflictReport: { taskIds: input.assessment.conflictingTaskIds },
    ...(input.contractVersionCreated === undefined ? {} : { contractVersionCreated: input.contractVersionCreated }),
  });
  await db
    .update(operatorProposalsTable)
    .set({ status: input.assessment.decision, decidedAt: new Date() })
    .where(eq(operatorProposalsTable.id, input.proposalId));
  await captureApprovedProposalDecision({
    proposalId: input.proposalId,
    assessment: input.assessment,
  });
}
