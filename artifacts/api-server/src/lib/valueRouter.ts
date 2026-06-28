/**
 * VIBA Value Router — Pure Module
 *
 * Ranks candidate agents/providers for a given task by value score.
 * No DB calls, no side effects — pure function, fully testable.
 *
 * Do NOT wire into live agentLoop until unit tests pass.
 */

// ─── Input types ─────────────────────────────────────────────────────────────

export interface ProviderReliability {
  provider: string;
  successRate: number;       // 0–1
  recentFailures: number;    // count of recent consecutive failures
  avgLatencyMs: number;      // average response time
  lastUsedAt?: number;       // unix ms
}

export interface ValueRouterInput {
  taskType: string;
  capabilityRequirements: string[];
  toolsRequired: boolean;
  estimatedCostCredits: number;
  remainingBudgetCredits: number;
  dataSensitivity: "low" | "medium" | "high";
  approvalRequired: boolean;
  fallbackAvailable: boolean;
  candidates: CandidateProvider[];
  reliabilityHistory?: ProviderReliability[];
}

export interface CandidateProvider {
  id: string;
  provider: string;
  model: string;
  role: string;
  capabilities: string[];
  canUseTools: boolean;
  costPerCreditUnit: number;   // relative cost (1 = cheapest)
  hasApprovalPath: boolean;    // can surface approvals to user
  fallbackAvailable: boolean;
}

// ─── Output types ────────────────────────────────────────────────────────────

export interface ScoredCandidate {
  candidate: CandidateProvider;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  reason: string;
}

export interface ScoreBreakdown {
  taskFit: number;
  toolAccess: number;
  reliability: number;
  costEfficiency: number;
  previousSuccess: number;
  fallbackBonus: number;
  penalties: number;
}

export interface ValueRouterResult {
  selected: CandidateProvider | null;
  ranked: ScoredCandidate[];
  reason: string;
  budgetWarning: boolean;
}

// ─── Scoring constants ────────────────────────────────────────────────────────

const WEIGHTS = {
  taskFit:           10,
  toolAccess:        8,
  reliability:       6,
  costEfficiency:    5,
  previousSuccess:   4,
  fallbackBonus:     3,
  penaltyMissingTool:       -12,
  penaltyHighCostUnnecessary: -8,
  penaltyPoorReliability:    -10,
  penaltyExpensiveModel:     -6,
  penaltySensitiveNoApproval: -15,
} as const;

// ─── Capability affinity map ──────────────────────────────────────────────────

const TASK_CAPABILITY_MAP: Record<string, string[]> = {
  planning:            ["planning", "strategy", "reasoning"],
  research:            ["research", "research_summary", "data_gathering"],
  creative_direction:  ["creative_direction", "creative", "summarization"],
  build:               ["build", "code", "implementation", "deployment"],
  code_review:         ["code_review", "logic_critique"],
  ux_review:           ["ux_review", "multimodal"],
  final_qa:            ["final_qa", "planning", "reasoning"],
  deployment_approval: ["deployment", "planning", "build"],
  doctor:              ["analysis", "reasoning", "planning", "code_review"],
  repair:              ["build", "code", "implementation"],
};

// ─── Pure scoring function ────────────────────────────────────────────────────

function scoreCandidate(
  candidate: CandidateProvider,
  input: ValueRouterInput,
  reliability: ProviderReliability | undefined,
): ScoredCandidate {
  const breakdown: ScoreBreakdown = {
    taskFit: 0,
    toolAccess: 0,
    reliability: 0,
    costEfficiency: 0,
    previousSuccess: 0,
    fallbackBonus: 0,
    penalties: 0,
  };

  const reasons: string[] = [];

  // — Task fit: capability overlap
  const taskCaps = TASK_CAPABILITY_MAP[input.taskType] ?? input.capabilityRequirements;
  const capHits = taskCaps.filter((c) => candidate.capabilities.includes(c)).length;
  const capRatio = taskCaps.length > 0 ? capHits / taskCaps.length : 0;
  breakdown.taskFit = Math.round(capRatio * WEIGHTS.taskFit);
  if (capHits > 0) reasons.push(`matches ${capHits}/${taskCaps.length} required capabilities`);

  // — Tool access
  if (input.toolsRequired) {
    if (candidate.canUseTools) {
      breakdown.toolAccess = WEIGHTS.toolAccess;
      reasons.push("has tool access (required)");
    } else {
      breakdown.penalties += WEIGHTS.penaltyMissingTool;
      reasons.push("MISSING required tool access (−12)");
    }
  }

  // — Reliability
  if (reliability) {
    const { successRate, recentFailures } = reliability;
    if (successRate >= 0.9 && recentFailures === 0) {
      breakdown.reliability = WEIGHTS.reliability;
      reasons.push(`reliable (${Math.round(successRate * 100)}% success rate)`);
    } else if (successRate < 0.6 || recentFailures >= 3) {
      breakdown.penalties += WEIGHTS.penaltyPoorReliability;
      reasons.push(`poor reliability (${Math.round(successRate * 100)}% success, ${recentFailures} recent failures) (−10)`);
    } else {
      breakdown.reliability = Math.round(successRate * WEIGHTS.reliability);
    }

    // Penalise expensive models when reliability is already low
    if (successRate < 0.7 && candidate.costPerCreditUnit > 2) {
      breakdown.penalties += WEIGHTS.penaltyExpensiveModel;
      reasons.push("expensive AND unreliable model (−6)");
    }
  }

  // — Cost efficiency
  const costRatio = input.remainingBudgetCredits > 0
    ? input.estimatedCostCredits / input.remainingBudgetCredits
    : 1;
  const costScore = costRatio < 0.1
    ? WEIGHTS.costEfficiency
    : costRatio < 0.3
    ? Math.round(WEIGHTS.costEfficiency * 0.6)
    : 0;
  breakdown.costEfficiency = costScore;

  // Penalise unnecessary expensive model use
  if (!input.toolsRequired && candidate.costPerCreditUnit > 3) {
    breakdown.penalties += WEIGHTS.penaltyHighCostUnnecessary;
    reasons.push("expensive model not justified by task complexity (−8)");
  }

  // — Previous success bonus (from reliability history)
  if (reliability && reliability.successRate >= 0.85 && (reliability.lastUsedAt ?? 0) > Date.now() - 7 * 24 * 3600 * 1000) {
    breakdown.previousSuccess = WEIGHTS.previousSuccess;
    reasons.push("recently successful");
  }

  // — Fallback bonus
  if (input.fallbackAvailable && candidate.fallbackAvailable) {
    breakdown.fallbackBonus = WEIGHTS.fallbackBonus;
    reasons.push("fallback available");
  }

  // — Sensitive task without approval path
  if (input.dataSensitivity === "high" && input.approvalRequired && !candidate.hasApprovalPath) {
    breakdown.penalties += WEIGHTS.penaltySensitiveNoApproval;
    reasons.push("sensitive task but no approval path (−15)");
  }

  const score =
    breakdown.taskFit +
    breakdown.toolAccess +
    breakdown.reliability +
    breakdown.costEfficiency +
    breakdown.previousSuccess +
    breakdown.fallbackBonus +
    breakdown.penalties;

  const reason = reasons.length > 0
    ? `Selected ${candidate.provider}/${candidate.model}: ${reasons.join("; ")}.`
    : `${candidate.provider}/${candidate.model} scored ${score} with no specific capability matches.`;

  return { candidate, score, scoreBreakdown: breakdown, reason };
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Rank candidates by value score and return the top pick with full explanation.
 */
export function rankCandidates(input: ValueRouterInput): ValueRouterResult {
  if (input.candidates.length === 0) {
    return {
      selected: null,
      ranked: [],
      reason: "No candidates provided.",
      budgetWarning: false,
    };
  }

  const reliabilityMap = new Map<string, ProviderReliability>(
    (input.reliabilityHistory ?? []).map((r) => [r.provider, r]),
  );

  const scored = input.candidates
    .map((c) => scoreCandidate(c, input, reliabilityMap.get(c.provider)))
    .sort((a, b) => b.score - a.score);

  const best = scored[0]!;
  const budgetWarning = input.estimatedCostCredits > input.remainingBudgetCredits * 0.5;

  // Build a rejection explanation for non-selected candidates
  const rejectedSummary = scored
    .slice(1)
    .map((s) => `${s.candidate.provider}/${s.candidate.model} (score ${s.score})`)
    .join(", ");

  const reason = best.score <= 0
    ? `All candidates have non-positive scores. Best available: ${best.candidate.provider}/${best.candidate.model} (score ${best.score}). ${rejectedSummary ? `Rejected: ${rejectedSummary}.` : ""}`
    : `${best.reason}${rejectedSummary ? ` Rejected lower-scoring options: ${rejectedSummary}.` : ""}`;

  return {
    selected: best.candidate,
    ranked: scored,
    reason,
    budgetWarning,
  };
}
