export interface WorkerOutcomeInput {
  agentId: number;
  completedTasks: number;
  reviewedTasks: number;
  recoveredTasks: number;
  blockedTasks: number;
  averageCostUsd: number;
  averageDurationMs: number;
  qualitySignals: number[];
}

export interface SystemOutcomeInput {
  totalTasks: number;
  completedTasks: number;
  reviewedTasks: number;
  recoveries: number;
  coordinationBlocks: number;
  activeConflicts: number;
  proposalsApproved: number;
  proposalsRejected: number;
  proposalsDeferred: number;
  unresolvedHighSeverityLessons: number;
  totalLessons: number;
  activeArchitectureDecisions: number;
  supersededArchitectureDecisions: number;
  memoryEntriesUsed: number;
  usageEvents: number;
  successfulUsageEvents: number;
  estimatedSpendUsd: number;
  estimatedSpendWithoutOptimisationUsd: number;
}

export interface WorkerScore {
  agentId: number;
  successRate: number;
  recoveryRate: number;
  qualityScore: number;
  efficiencyScore: number;
  reliabilityScore: number;
}

export interface SystemHealthScore {
  architectureHealthScore: number;
  coordinationHealthScore: number;
  memoryHealthScore: number;
  costEfficiencyScore: number;
  technicalDebtScore: number;
  proposalSuccessRate: number;
}

export interface ImprovementRecommendation {
  key: string;
  category: "worker" | "architecture" | "coordination" | "memory" | "cost" | "technical_debt";
  priority: "low" | "medium" | "high" | "critical";
  title: string;
  rationale: string;
  expectedBenefit: string;
  confidence: number;
  evidence: Record<string, number>;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function scoreWorker(input: WorkerOutcomeInput): WorkerScore {
  const attempted = input.completedTasks + input.reviewedTasks + input.blockedTasks;
  const successRate = clamp(ratio(input.completedTasks, attempted) * 100);
  const recoveryRate = clamp(ratio(input.recoveredTasks, Math.max(1, input.recoveredTasks + input.blockedTasks)) * 100);
  const qualityScore = clamp(average(input.qualitySignals) * 100);
  const costPenalty = Math.min(45, Math.log10(1 + Math.max(0, input.averageCostUsd)) * 22);
  const durationPenalty = Math.min(35, Math.log10(1 + Math.max(0, input.averageDurationMs) / 1_000) * 12);
  const efficiencyScore = clamp(100 - costPenalty - durationPenalty);
  const reliabilityScore = clamp(successRate * 0.5 + qualityScore * 0.3 + recoveryRate * 0.1 + efficiencyScore * 0.1);
  return { agentId: input.agentId, successRate, recoveryRate, qualityScore, efficiencyScore, reliabilityScore };
}

export function scoreSystem(input: SystemOutcomeInput): SystemHealthScore {
  const decisionStability = ratio(input.activeArchitectureDecisions, input.activeArchitectureDecisions + input.supersededArchitectureDecisions);
  const architectureHealthScore = clamp(100 - input.activeConflicts * 18 - input.unresolvedHighSeverityLessons * 12 + decisionStability * 15);
  const completionRate = ratio(input.completedTasks, input.totalTasks);
  const coordinationPenalty = ratio(input.coordinationBlocks + input.recoveries, Math.max(1, input.totalTasks));
  const coordinationHealthScore = clamp(completionRate * 100 - coordinationPenalty * 55);
  const memoryUtilisation = ratio(input.memoryEntriesUsed, Math.max(1, input.totalTasks));
  const unresolvedLessonRatio = ratio(input.unresolvedHighSeverityLessons, Math.max(1, input.totalLessons));
  const memoryHealthScore = clamp(memoryUtilisation * 85 + (1 - unresolvedLessonRatio) * 15);
  const savingsRate = ratio(input.estimatedSpendWithoutOptimisationUsd - input.estimatedSpendUsd, Math.max(0.000001, input.estimatedSpendWithoutOptimisationUsd));
  const usageSuccessRate = ratio(input.successfulUsageEvents, Math.max(1, input.usageEvents));
  const costEfficiencyScore = clamp(savingsRate * 65 + usageSuccessRate * 35);
  const technicalDebtScore = clamp(input.unresolvedHighSeverityLessons * 15 + input.activeConflicts * 12 + ratio(input.reviewedTasks, Math.max(1, input.totalTasks)) * 35);
  const decidedProposals = input.proposalsApproved + input.proposalsRejected + input.proposalsDeferred;
  const proposalSuccessRate = clamp(ratio(input.proposalsApproved, decidedProposals) * 100);
  return { architectureHealthScore, coordinationHealthScore, memoryHealthScore, costEfficiencyScore, technicalDebtScore, proposalSuccessRate };
}

export function generateImprovementRecommendations(input: {
  workers: WorkerScore[];
  system: SystemHealthScore;
  unresolvedHighSeverityLessons: number;
  activeConflicts: number;
}): ImprovementRecommendation[] {
  const recommendations: ImprovementRecommendation[] = [];
  for (const worker of input.workers) {
    if (worker.reliabilityScore < 60) {
      recommendations.push({
        key: `worker:${worker.agentId}:routing`,
        category: "worker",
        priority: worker.reliabilityScore < 35 ? "critical" : "high",
        title: `Adjust AI worker ${worker.agentId} routing`,
        rationale: `Measured reliability is ${worker.reliabilityScore.toFixed(1)}%.`,
        expectedBenefit: "Route critical tasks to higher-performing AI workers and reduce recovery overhead.",
        confidence: clamp(70 + (60 - worker.reliabilityScore) * 0.5) / 100,
        evidence: { reliabilityScore: worker.reliabilityScore, successRate: worker.successRate, qualityScore: worker.qualityScore, efficiencyScore: worker.efficiencyScore },
      });
    }
  }
  if (input.system.architectureHealthScore < 70 || input.activeConflicts > 0) recommendations.push({ key: "architecture:conflict-reduction", category: "architecture", priority: input.activeConflicts > 2 ? "critical" : "high", title: "Resolve architecture conflicts before increasing parallelism", rationale: `Architecture health is ${input.system.architectureHealthScore.toFixed(1)} with ${input.activeConflicts} active conflicts.`, expectedBenefit: "Reduce incompatible changes, rework, and merge risk.", confidence: 0.9, evidence: { architectureHealthScore: input.system.architectureHealthScore, activeConflicts: input.activeConflicts } });
  if (input.system.coordinationHealthScore < 70) recommendations.push({ key: "coordination:reduce-blocking", category: "coordination", priority: input.system.coordinationHealthScore < 45 ? "high" : "medium", title: "Rebalance task decomposition and dependency order", rationale: `Coordination health is ${input.system.coordinationHealthScore.toFixed(1)}%.`, expectedBenefit: "Increase runnable parallel work and reduce stalled-task recovery.", confidence: 0.82, evidence: { coordinationHealthScore: input.system.coordinationHealthScore } });
  if (input.system.memoryHealthScore < 60) recommendations.push({ key: "memory:increase-reuse", category: "memory", priority: "medium", title: "Increase engineering-memory reuse", rationale: `Engineering-memory health is ${input.system.memoryHealthScore.toFixed(1)}%.`, expectedBenefit: "Prevent repeated design debates and recurrence of known defects.", confidence: 0.78, evidence: { memoryHealthScore: input.system.memoryHealthScore } });
  if (input.system.costEfficiencyScore < 65) recommendations.push({ key: "cost:improve-routing", category: "cost", priority: input.system.costEfficiencyScore < 35 ? "high" : "medium", title: "Tune quality-adjusted model routing and cache reuse", rationale: `Cost efficiency is ${input.system.costEfficiencyScore.toFixed(1)}%.`, expectedBenefit: "Lower model spend without routing critical work below its quality threshold.", confidence: 0.84, evidence: { costEfficiencyScore: input.system.costEfficiencyScore } });
  if (input.system.technicalDebtScore > 40 || input.unresolvedHighSeverityLessons > 0) recommendations.push({ key: "technical-debt:remediation", category: "technical_debt", priority: input.system.technicalDebtScore > 70 ? "critical" : "high", title: "Schedule a technical-debt remediation batch", rationale: `Technical-debt pressure is ${input.system.technicalDebtScore.toFixed(1)} with ${input.unresolvedHighSeverityLessons} unresolved high-severity lessons.`, expectedBenefit: "Remove recurring failure causes before they compound across future modules.", confidence: 0.92, evidence: { technicalDebtScore: input.system.technicalDebtScore, unresolvedHighSeverityLessons: input.unresolvedHighSeverityLessons } });
  const priority = { critical: 4, high: 3, medium: 2, low: 1 } as const;
  return recommendations.sort((left, right) => priority[right.priority] - priority[left.priority] || right.confidence - left.confidence);
}
