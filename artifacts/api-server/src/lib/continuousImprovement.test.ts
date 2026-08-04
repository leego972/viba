import { describe, expect, it } from "vitest";
import { generateImprovementRecommendations, scoreSystem, scoreWorker } from "./continuousImprovement";

describe("continuous improvement scoring", () => {
  it("scores reliable workers above failing workers", () => {
    const strong = scoreWorker({
      agentId: 1,
      completedTasks: 9,
      reviewedTasks: 1,
      recoveredTasks: 1,
      blockedTasks: 0,
      averageCostUsd: 0.2,
      averageDurationMs: 5_000,
      qualitySignals: [0.9, 0.95, 0.88],
    });
    const weak = scoreWorker({
      agentId: 2,
      completedTasks: 2,
      reviewedTasks: 4,
      recoveredTasks: 0,
      blockedTasks: 4,
      averageCostUsd: 8,
      averageDurationMs: 180_000,
      qualitySignals: [0.3, 0.4],
    });
    expect(strong.reliabilityScore).toBeGreaterThan(weak.reliabilityScore);
    expect(strong.successRate).toBeGreaterThan(weak.successRate);
  });

  it("penalises conflicts, unresolved lessons and coordination failures", () => {
    const healthy = scoreSystem({
      totalTasks: 10, completedTasks: 9, reviewedTasks: 1, recoveries: 0, coordinationBlocks: 0,
      activeConflicts: 0, proposalsApproved: 4, proposalsRejected: 1, proposalsDeferred: 0,
      unresolvedHighSeverityLessons: 0, totalLessons: 2, activeArchitectureDecisions: 8,
      supersededArchitectureDecisions: 1, memoryEntriesUsed: 8, usageEvents: 10,
      successfulUsageEvents: 10, estimatedSpendUsd: 2, estimatedSpendWithoutOptimisationUsd: 5,
    });
    const unhealthy = scoreSystem({
      totalTasks: 10, completedTasks: 3, reviewedTasks: 5, recoveries: 3, coordinationBlocks: 4,
      activeConflicts: 3, proposalsApproved: 1, proposalsRejected: 3, proposalsDeferred: 2,
      unresolvedHighSeverityLessons: 3, totalLessons: 4, activeArchitectureDecisions: 2,
      supersededArchitectureDecisions: 5, memoryEntriesUsed: 1, usageEvents: 10,
      successfulUsageEvents: 5, estimatedSpendUsd: 9, estimatedSpendWithoutOptimisationUsd: 10,
    });
    expect(healthy.architectureHealthScore).toBeGreaterThan(unhealthy.architectureHealthScore);
    expect(healthy.coordinationHealthScore).toBeGreaterThan(unhealthy.coordinationHealthScore);
    expect(healthy.technicalDebtScore).toBeLessThan(unhealthy.technicalDebtScore);
  });

  it("prioritises evidence-backed remediation recommendations", () => {
    const worker = scoreWorker({
      agentId: 7, completedTasks: 1, reviewedTasks: 3, recoveredTasks: 0, blockedTasks: 4,
      averageCostUsd: 7, averageDurationMs: 200_000, qualitySignals: [0.2, 0.35],
    });
    const system = scoreSystem({
      totalTasks: 8, completedTasks: 2, reviewedTasks: 4, recoveries: 3, coordinationBlocks: 3,
      activeConflicts: 3, proposalsApproved: 1, proposalsRejected: 2, proposalsDeferred: 1,
      unresolvedHighSeverityLessons: 3, totalLessons: 4, activeArchitectureDecisions: 2,
      supersededArchitectureDecisions: 4, memoryEntriesUsed: 1, usageEvents: 8,
      successfulUsageEvents: 4, estimatedSpendUsd: 8, estimatedSpendWithoutOptimisationUsd: 9,
    });
    const recommendations = generateImprovementRecommendations({ workers: [worker], system, unresolvedHighSeverityLessons: 3, activeConflicts: 3 });
    expect(recommendations.length).toBeGreaterThan(3);
    expect(recommendations[0]?.priority).toBe("critical");
    expect(recommendations.some((item) => item.category === "technical_debt")).toBe(true);
    expect(recommendations.some((item) => item.category === "worker")).toBe(true);
  });
});
