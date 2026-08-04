import { db, taskContractsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { mergeImpactWithProposalAssessment, simulateProposalImpact } from "./architectureImpactGate";
import { refreshSessionArchitectureTwin } from "./architectureTwinService";
import {
  getActiveTaskContract,
  listActiveReservations,
  persistImprovementProposal,
  persistProposalDecision,
} from "./governanceStore";
import {
  assessImprovementProposal,
  type ImprovementProposal,
  type ProposalAssessment,
} from "./orchestrationGovernance";

export interface GovernedProposalResult {
  proposalId: number;
  assessment: ProposalAssessment;
  contractVersionCreated?: number;
}

async function persistApprovedContractRevision(
  proposal: ImprovementProposal,
  assessment: ProposalAssessment,
): Promise<number | undefined> {
  if (assessment.decision !== "approved" && assessment.decision !== "approved_with_conditions") {
    return undefined;
  }

  const [current] = await db
    .select()
    .from(taskContractsTable)
    .where(and(
      eq(taskContractsTable.taskId, proposal.taskId),
      eq(taskContractsTable.status, "active"),
    ))
    .orderBy(desc(taskContractsTable.version))
    .limit(1);
  if (!current) throw new Error("Cannot revise a missing active task contract");

  const nextVersion = current.version + 1;
  await db.transaction(async (tx) => {
    await tx
      .update(taskContractsTable)
      .set({ status: "superseded" })
      .where(eq(taskContractsTable.id, current.id));

    await tx.insert(taskContractsTable).values({
      sessionId: current.sessionId,
      taskId: current.taskId,
      assignedAgentId: current.assignedAgentId,
      version: nextVersion,
      status: "active",
      objective: current.objective,
      allowedPaths: assessment.updatedAllowedPaths,
      forbiddenPaths: current.forbiddenPaths,
      ownedInterfaces: assessment.updatedOwnedInterfaces,
      dependencyTaskIds: current.dependencyTaskIds,
      architectureRules: current.architectureRules,
      acceptanceCriteria: current.acceptanceCriteria,
      requiredChecks: [...new Set([...current.requiredChecks, ...assessment.conditions])],
      maxEstimatedCost: current.maxEstimatedCost,
      requiresProposalApproval: current.requiresProposalApproval,
      expiresAt: current.expiresAt,
    });
  });
  return nextVersion;
}

export async function processImprovementProposal(input: {
  sessionId: number;
  proposal: ImprovementProposal;
  approvedDependencies?: ReadonlySet<string>;
  expectedBenefits?: string[];
}): Promise<GovernedProposalResult> {
  const contract = await getActiveTaskContract(input.proposal.taskId);
  if (!contract) throw new Error("Proposal rejected: no active task contract");
  if (contract.sessionId !== input.sessionId) throw new Error("Proposal session does not match its contract");
  if (contract.id !== input.proposal.contractId) throw new Error("Proposal references a stale task contract");

  const proposalId = await persistImprovementProposal(input.proposal, input.expectedBenefits ?? []);
  const reservations = await listActiveReservations(input.sessionId);
  let assessment = assessImprovementProposal({
    proposal: input.proposal,
    contract,
    reservations,
    approvedDependencies: input.approvedDependencies ?? new Set<string>(),
  });

  await refreshSessionArchitectureTwin({ sessionId: input.sessionId });
  const impact = await simulateProposalImpact({ sessionId: input.sessionId, proposal: input.proposal });
  if (impact) assessment = mergeImpactWithProposalAssessment(assessment, impact);

  const contractVersionCreated = await persistApprovedContractRevision(input.proposal, assessment);
  await persistProposalDecision({ proposalId, assessment, ...(contractVersionCreated ? { contractVersionCreated } : {}) });
  await refreshSessionArchitectureTwin({ sessionId: input.sessionId });

  return {
    proposalId,
    assessment,
    ...(contractVersionCreated ? { contractVersionCreated } : {}),
  };
}
