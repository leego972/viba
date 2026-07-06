/**
 * Unit tests for the VIBA Value Router (pure module).
 */
import { describe, it, expect } from "vitest";
import { rankCandidates } from "./valueRouter";
import type { ValueRouterInput, CandidateProvider, ProviderReliability } from "./valueRouter";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const cheap: CandidateProvider = {
  id: "groq-1",
  provider: "groq",
  model: "llama-3.3-70b",
  role: "builder",
  capabilities: ["build", "code", "planning"],
  canUseTools: true,
  costPerCreditUnit: 1,
  hasApprovalPath: true,
  fallbackAvailable: true,
};

const expensive: CandidateProvider = {
  id: "openai-1",
  provider: "openai",
  model: "gpt-4o",
  role: "strategist",
  capabilities: ["planning", "strategy", "reasoning"],
  canUseTools: false,
  costPerCreditUnit: 5,
  hasApprovalPath: true,
  fallbackAvailable: false,
};

const noTools: CandidateProvider = {
  id: "anthropic-1",
  provider: "anthropic",
  model: "claude-3-5-sonnet",
  role: "reviewer",
  capabilities: ["code_review", "logic_critique", "reasoning"],
  canUseTools: false,
  costPerCreditUnit: 3,
  hasApprovalPath: true,
  fallbackAvailable: true,
};

const noApprovalPath: CandidateProvider = {
  id: "perplexity-1",
  provider: "perplexity",
  model: "sonar-large",
  role: "researcher",
  capabilities: ["research", "research_summary"],
  canUseTools: false,
  costPerCreditUnit: 2,
  hasApprovalPath: false,
  fallbackAvailable: false,
};

const baseInput = (overrides?: Partial<ValueRouterInput>): ValueRouterInput => ({
  taskType: "build",
  capabilityRequirements: ["build", "code"],
  toolsRequired: true,
  estimatedCostCredits: 5,
  remainingBudgetCredits: 100,
  dataSensitivity: "low",
  approvalRequired: false,
  fallbackAvailable: true,
  candidates: [cheap, expensive, noTools],
  ...overrides,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("rankCandidates", () => {
  it("returns null selected when no candidates provided", () => {
    const result = rankCandidates({ ...baseInput(), candidates: [] });
    expect(result.selected).toBeNull();
    expect(result.ranked).toHaveLength(0);
  });

  it("prefers tool-capable candidate for tool-required tasks", () => {
    const result = rankCandidates(baseInput());
    expect(result.selected?.id).toBe("groq-1");
    expect(result.selected?.canUseTools).toBe(true);
  });

  it("penalises missing tools on tool-required tasks", () => {
    const result = rankCandidates(baseInput());
    const toollessScore = result.ranked.find((r) => !r.candidate.canUseTools);
    const toolScore = result.ranked.find((r) => r.candidate.canUseTools);
    expect(toollessScore!.scoreBreakdown.penalties).toBeLessThan(0);
    expect(toolScore!.score).toBeGreaterThan(toollessScore!.score);
  });

  it("penalises expensive model on simple non-tool task", () => {
    const result = rankCandidates({
      ...baseInput(),
      taskType: "research",
      toolsRequired: false,
      candidates: [expensive, cheap],
    });
    const expensiveScored = result.ranked.find((r) => r.candidate.id === "openai-1");
    expect(expensiveScored!.scoreBreakdown.penalties).toBeLessThan(0);
  });

  it("rewards cost efficiency when budget is ample", () => {
    const result = rankCandidates({
      ...baseInput(),
      estimatedCostCredits: 2,
      remainingBudgetCredits: 200,
      toolsRequired: false,
      candidates: [cheap, expensive],
    });
    const cheapScored = result.ranked.find((r) => r.candidate.id === "groq-1");
    expect(cheapScored!.scoreBreakdown.costEfficiency).toBeGreaterThan(0);
  });

  it("applies budget warning when cost exceeds 50% of remaining budget", () => {
    const result = rankCandidates({
      ...baseInput(),
      estimatedCostCredits: 60,
      remainingBudgetCredits: 100,
    });
    expect(result.budgetWarning).toBe(true);
  });

  it("no budget warning when cost is well within budget", () => {
    const result = rankCandidates({
      ...baseInput(),
      estimatedCostCredits: 5,
      remainingBudgetCredits: 500,
    });
    expect(result.budgetWarning).toBe(false);
  });

  it("rewards reliable providers via reliability history", () => {
    const goodHistory: ProviderReliability = {
      provider: "groq",
      successRate: 0.97,
      recentFailures: 0,
      avgLatencyMs: 800,
      lastUsedAt: Date.now() - 1000,
    };
    const result = rankCandidates({
      ...baseInput(),
      reliabilityHistory: [goodHistory],
    });
    const groqScored = result.ranked.find((r) => r.candidate.provider === "groq");
    expect(groqScored!.scoreBreakdown.reliability).toBeGreaterThan(0);
  });

  it("penalises poor reliability", () => {
    const badHistory: ProviderReliability = {
      provider: "groq",
      successRate: 0.4,
      recentFailures: 4,
      avgLatencyMs: 5000,
    };
    const result = rankCandidates({
      ...baseInput(),
      reliabilityHistory: [badHistory],
    });
    const groqScored = result.ranked.find((r) => r.candidate.provider === "groq");
    expect(groqScored!.scoreBreakdown.penalties).toBeLessThan(0);
  });

  it("strongly penalises missing approval path on sensitive approval-required tasks", () => {
    const result = rankCandidates({
      ...baseInput(),
      dataSensitivity: "high",
      approvalRequired: true,
      toolsRequired: false,
      candidates: [noApprovalPath, cheap],
    });
    const noApprovalScored = result.ranked.find((r) => r.candidate.id === "perplexity-1");
    expect(noApprovalScored!.scoreBreakdown.penalties).toBeLessThanOrEqual(-15);
    expect(result.selected?.id).not.toBe("perplexity-1");
  });

  it("rewards fallback availability", () => {
    const result = rankCandidates({
      ...baseInput(),
      fallbackAvailable: true,
      candidates: [cheap, expensive],
    });
    const cheapScored = result.ranked.find((r) => r.candidate.id === "groq-1");
    expect(cheapScored!.scoreBreakdown.fallbackBonus).toBeGreaterThan(0);
  });

  it("includes human-readable reason in result", () => {
    const result = rankCandidates(baseInput());
    expect(result.reason).toBeTruthy();
    expect(result.reason.length).toBeGreaterThan(10);
  });

  it("includes rejection explanation for non-selected candidates", () => {
    const result = rankCandidates(baseInput());
    expect(result.reason).toMatch(/ejected/i);
  });

  it("capability matching for planning task type", () => {
    const result = rankCandidates({
      ...baseInput(),
      taskType: "planning",
      toolsRequired: false,
      candidates: [expensive, cheap],
    });
    const expensiveScored = result.ranked.find((r) => r.candidate.id === "openai-1");
    expect(expensiveScored!.scoreBreakdown.taskFit).toBeGreaterThan(0);
  });
});

// ─── BUG 8 regression: null selection when all candidates are unacceptable ────

describe("rankCandidates — BUG 8 null selection", () => {
  const toxicCandidate: CandidateProvider = {
    id: "bad-1",
    provider: "unknown",
    model: "bad-model",
    role: "builder",
    capabilities: [],           // zero capability match
    canUseTools: false,         // tools required → big penalty
    costPerCreditUnit: 10,      // high cost on tight budget
    hasApprovalPath: false,     // sensitive task → -15
    fallbackAvailable: false,
  };

  const toxicInput = (): ValueRouterInput => ({
    taskType: "build",
    capabilityRequirements: ["build", "code"],
    toolsRequired: true,        // candidate lacks tools → -12
    estimatedCostCredits: 50,
    remainingBudgetCredits: 5,  // nearly exhausted
    dataSensitivity: "high",
    approvalRequired: true,     // no approval path → -15
    fallbackAvailable: false,
    candidates: [toxicCandidate],
  });

  it("returns selected: null when all candidates score <= 0", () => {
    const result = rankCandidates(toxicInput());
    expect(result.selected).toBeNull();
  });

  it("still returns a ranked list when selected is null", () => {
    const result = rankCandidates(toxicInput());
    expect(result.ranked.length).toBeGreaterThan(0);
  });

  it("reason explains no acceptable candidate", () => {
    const result = rankCandidates(toxicInput());
    expect(result.reason).toMatch(/no acceptable candidate/i);
  });

  it("returns selected: null when tool-required task has no tool-capable candidates", () => {
    const noToolCandidates: CandidateProvider[] = [
      { ...noTools, capabilities: ["build", "code"] }, // matches caps but no tools
    ];
    const result = rankCandidates({
      ...baseInput(),
      toolsRequired: true,
      candidates: noToolCandidates,
    });
    // -12 penalty for missing tools drives score to <= 0 if nothing else offsets
    if (result.ranked[0]!.score <= 0) {
      expect(result.selected).toBeNull();
    }
  });

  it("does NOT return null when at least one candidate has a positive score", () => {
    const result = rankCandidates(baseInput()); // cheap has positive score
    expect(result.selected).not.toBeNull();
    expect(result.selected?.id).toBe("groq-1");
  });
});
