import type { ImprovementProposal, ProposalAssessment, TaskContract } from "./orchestrationGovernance";
import {
  ArchitectureDigitalTwin,
  type ArchitectureImpactReport,
  type ArchitectureTwinSnapshot,
  type ChangeIntent,
} from "./architectureDigitalTwin";
import { getLatestArchitectureTwin } from "./architectureGraphStore";

export interface ImpactGateDecision {
  allowed: boolean;
  action: "approve" | "approve_with_conditions" | "defer" | "reject";
  report: ArchitectureImpactReport;
  conditions: string[];
  reasons: string[];
}

export function proposalToChangeIntent(proposal: ImprovementProposal): ChangeIntent {
  const dependencyChanges = proposal.requestedDependencies.map((dependency) => ({
    from: `task:${proposal.taskId}`,
    to: dependency,
    operation: "add" as const,
  }));
  return {
    taskId: proposal.taskId,
    agentId: proposal.proposedByAgentId,
    changedPaths: proposal.requestedPaths,
    changedInterfaces: proposal.affectedInterfaces,
    ...(dependencyChanges.length > 0 ? { dependencyChanges } : {}),
    ...(proposal.estimatedMonthlyCostDelta === undefined
      ? {}
      : { estimatedMonthlyCostDelta: proposal.estimatedMonthlyCostDelta }),
    publicContractChange: proposal.affectedInterfaces.length > 0,
    destructiveMigration: proposal.type === "security" && proposal.risk === "high",
  };
}

export function evaluateArchitectureImpact(
  snapshot: ArchitectureTwinSnapshot,
  intent: ChangeIntent,
): ImpactGateDecision {
  const report = new ArchitectureDigitalTwin(snapshot).analyzeChange(intent);
  const conditions = report.requiredReviews.map((review) => `Require ${review} review before merge.`);

  if (report.conflictingTaskIds.length > 0) {
    return {
      allowed: false,
      action: "defer",
      report,
      conditions: [
        `Wait for conflicting tasks to release reservations: ${report.conflictingTaskIds.join(", ")}.`,
        ...conditions,
      ],
      reasons: report.reasons,
    };
  }
  if (report.riskLevel === "critical") {
    return {
      allowed: false,
      action: "reject",
      report,
      conditions,
      reasons: [...report.reasons, "Predicted architecture risk exceeds the execution threshold."],
    };
  }
  if (report.riskLevel === "high" || conditions.length > 0) {
    return {
      allowed: true,
      action: "approve_with_conditions",
      report,
      conditions,
      reasons: report.reasons,
    };
  }
  return {
    allowed: true,
    action: "approve",
    report,
    conditions: [],
    reasons: report.reasons,
  };
}

export function mergeImpactWithProposalAssessment(
  assessment: ProposalAssessment,
  impact: ImpactGateDecision,
): ProposalAssessment {
  if (impact.action === "defer") {
    return {
      ...assessment,
      decision: "deferred",
      reasons: [...new Set([...assessment.reasons, ...impact.reasons])],
      conflictingTaskIds: [...new Set([
        ...assessment.conflictingTaskIds,
        ...impact.report.conflictingTaskIds,
      ])].sort((left, right) => left - right),
      conditions: [...new Set([...assessment.conditions, ...impact.conditions])],
    };
  }
  if (impact.action === "reject") {
    return {
      ...assessment,
      decision: "rejected",
      reasons: [...new Set([...assessment.reasons, ...impact.reasons])],
      conditions: [...new Set([...assessment.conditions, ...impact.conditions])],
    };
  }
  if (impact.action === "approve_with_conditions" && assessment.decision === "approved") {
    return {
      ...assessment,
      decision: "approved_with_conditions",
      reasons: [...new Set([...assessment.reasons, ...impact.reasons])],
      conditions: [...new Set([...assessment.conditions, ...impact.conditions])],
    };
  }
  return {
    ...assessment,
    reasons: [...new Set([...assessment.reasons, ...impact.reasons])],
    conditions: [...new Set([...assessment.conditions, ...impact.conditions])],
  };
}

export async function simulateProposalImpact(input: {
  sessionId: number;
  proposal: ImprovementProposal;
}): Promise<ImpactGateDecision | null> {
  const snapshot = await getLatestArchitectureTwin(input.sessionId);
  if (!snapshot) return null;
  return evaluateArchitectureImpact(snapshot, proposalToChangeIntent(input.proposal));
}

export async function authorizeScheduledContract(input: {
  sessionId: number;
  contract: TaskContract;
}): Promise<ImpactGateDecision | null> {
  const snapshot = await getLatestArchitectureTwin(input.sessionId);
  if (!snapshot) return null;
  return evaluateArchitectureImpact(snapshot, {
    taskId: input.contract.taskId,
    agentId: input.contract.assignedAgentId,
    changedPaths: input.contract.allowedPaths,
    changedInterfaces: input.contract.ownedInterfaces,
  });
}
