export type GovernanceDecision = "approved" | "approved_with_conditions" | "deferred" | "rejected";
export type ProposalType = "architecture" | "cost" | "performance" | "security" | "maintainability" | "dependency";

export interface TaskContract {
  id: string;
  version: number;
  sessionId: number;
  taskId: number;
  objective: string;
  assignedAgentId: number;
  allowedPaths: string[];
  forbiddenPaths: string[];
  ownedInterfaces: string[];
  dependencies: number[];
  requiredChecks: string[];
  maxEstimatedCost?: number;
  expiresAt?: string;
}

export interface ActiveReservation {
  contractId: string;
  taskId: number;
  agentId: number;
  paths: string[];
  interfaces: string[];
}

export interface ImprovementProposal {
  id: string;
  contractId: string;
  taskId: number;
  proposedByAgentId: number;
  type: ProposalType;
  summary: string;
  rationale: string;
  requestedPaths: string[];
  affectedInterfaces: string[];
  requestedDependencies: string[];
  estimatedImplementationCost?: number;
  estimatedMonthlyCostDelta?: number;
  estimatedSavingsPercent?: number;
  risk: "low" | "medium" | "high";
}

export interface ProposalAssessment {
  decision: GovernanceDecision;
  reasons: string[];
  conflictingTaskIds: number[];
  conditions: string[];
  updatedAllowedPaths: string[];
  updatedOwnedInterfaces: string[];
}

export interface ScopeValidationResult {
  allowed: boolean;
  violations: string[];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function pathContains(parent: string, child: string): boolean {
  const normalizedParent = normalizePath(parent);
  const normalizedChild = normalizePath(child);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

function overlaps(left: string, right: string): boolean {
  return pathContains(left, right) || pathContains(right, left);
}

export function validateTaskScope(contract: TaskContract, changedPaths: string[]): ScopeValidationResult {
  const violations: string[] = [];

  for (const rawPath of changedPaths) {
    const path = normalizePath(rawPath);
    const forbidden = contract.forbiddenPaths.some((candidate) => overlaps(candidate, path));
    if (forbidden) {
      violations.push(`${path}: forbidden by task contract`);
      continue;
    }

    const allowed = contract.allowedPaths.some((candidate) => pathContains(candidate, path));
    if (!allowed) violations.push(`${path}: outside allowed task scope`);
  }

  return { allowed: violations.length === 0, violations };
}

export function findReservationConflicts(
  requestedPaths: string[],
  requestedInterfaces: string[],
  reservations: ActiveReservation[],
  excludingTaskId?: number,
): number[] {
  const conflicts = new Set<number>();

  for (const reservation of reservations) {
    if (reservation.taskId === excludingTaskId) continue;
    const pathConflict = requestedPaths.some((requested) =>
      reservation.paths.some((reserved) => overlaps(requested, reserved)),
    );
    const interfaceConflict = requestedInterfaces.some((requested) => reservation.interfaces.includes(requested));
    if (pathConflict || interfaceConflict) conflicts.add(reservation.taskId);
  }

  return [...conflicts].sort((a, b) => a - b);
}

export function assessImprovementProposal(input: {
  proposal: ImprovementProposal;
  contract: TaskContract;
  reservations: ActiveReservation[];
  approvedDependencies: ReadonlySet<string>;
  constitutionalRules?: string[];
}): ProposalAssessment {
  const { proposal, contract, reservations, approvedDependencies } = input;
  const reasons: string[] = [];
  const conditions: string[] = [];
  const conflicts = findReservationConflicts(
    proposal.requestedPaths,
    proposal.affectedInterfaces,
    reservations,
    proposal.taskId,
  );

  if (conflicts.length > 0) {
    return {
      decision: "deferred",
      reasons: [`Conflicts with active task reservations: ${conflicts.join(", ")}`],
      conflictingTaskIds: conflicts,
      conditions: ["Retry after conflicting reservations are released or explicitly transferred."],
      updatedAllowedPaths: contract.allowedPaths,
      updatedOwnedInterfaces: contract.ownedInterfaces,
    };
  }

  const unapprovedDependencies = proposal.requestedDependencies.filter((dependency) => !approvedDependencies.has(dependency));
  if (unapprovedDependencies.length > 0) {
    conditions.push(`Dependency review required: ${unapprovedDependencies.join(", ")}`);
  }

  if (proposal.risk === "high") {
    return {
      decision: "approved_with_conditions",
      reasons: ["High-risk proposal requires independent architecture and security review."],
      conflictingTaskIds: [],
      conditions: [
        ...conditions,
        "Create an ADR before implementation.",
        "Require architecture and security reviewer approval before merge.",
        "Run the complete regression suite.",
      ],
      updatedAllowedPaths: [...new Set([...contract.allowedPaths, ...proposal.requestedPaths])],
      updatedOwnedInterfaces: [...new Set([...contract.ownedInterfaces, ...proposal.affectedInterfaces])],
    };
  }

  if (
    contract.maxEstimatedCost !== undefined &&
    proposal.estimatedImplementationCost !== undefined &&
    proposal.estimatedImplementationCost > contract.maxEstimatedCost
  ) {
    return {
      decision: "rejected",
      reasons: ["Estimated implementation cost exceeds the task contract budget."],
      conflictingTaskIds: [],
      conditions: [],
      updatedAllowedPaths: contract.allowedPaths,
      updatedOwnedInterfaces: contract.ownedInterfaces,
    };
  }

  if ((proposal.estimatedMonthlyCostDelta ?? 0) > 0 && (proposal.estimatedSavingsPercent ?? 0) <= 0) {
    conditions.push("Obtain explicit cost-owner approval for the recurring cost increase.");
  }

  reasons.push("No active path or interface conflicts were detected.");
  if ((proposal.estimatedSavingsPercent ?? 0) > 0) reasons.push("Proposal reports measurable efficiency or cost savings.");

  return {
    decision: conditions.length > 0 ? "approved_with_conditions" : "approved",
    reasons,
    conflictingTaskIds: [],
    conditions,
    updatedAllowedPaths: [...new Set([...contract.allowedPaths, ...proposal.requestedPaths])],
    updatedOwnedInterfaces: [...new Set([...contract.ownedInterfaces, ...proposal.affectedInterfaces])],
  };
}

export function issueContractRevision(
  contract: TaskContract,
  assessment: ProposalAssessment,
): TaskContract {
  if (assessment.decision !== "approved" && assessment.decision !== "approved_with_conditions") {
    throw new Error(`Cannot revise contract for ${assessment.decision} proposal`);
  }

  return {
    ...contract,
    version: contract.version + 1,
    allowedPaths: assessment.updatedAllowedPaths,
    ownedInterfaces: assessment.updatedOwnedInterfaces,
    requiredChecks: [...new Set([...contract.requiredChecks, ...assessment.conditions])],
  };
}
