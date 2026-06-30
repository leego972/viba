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

// ─── Task classifier (spec-compliant) ────────────────────────────────────────

export type RecommendedMode =
  | "simple_answer"
  | "research"
  | "code_patch"
  | "repo_audit"
  | "build_fix"
  | "deployment_fix"
  | "security_review"
  | "business_strategy"
  | "proof_report";

export type RecommendedProvider =
  | "groq"
  | "openai"
  | "anthropic"
  | "gemini"
  | "github"
  | "render"
  | "railway"
  | "local";

export interface TaskClassifierInput {
  input: string;
  context?: Record<string, unknown>;
}

export interface TaskClassifierResult {
  taskType: string;
  businessValueScore: number;
  urgencyScore: number;
  complexityScore: number;
  riskScore: number;
  recommendedMode: RecommendedMode;
  recommendedProvider: RecommendedProvider;
  requiredTools: string[];
  approvalRequired: boolean;
  reason: string;
}

interface ClassifierRule {
  pattern: RegExp;
  taskType: string;
  businessValueScore: number;
  urgencyScore: number;
  complexityScore: number;
  riskScore: number;
  recommendedMode: RecommendedMode;
  recommendedProvider: RecommendedProvider;
  requiredTools: string[];
  approvalRequired: boolean;
}

const CLASSIFIER_RULES: ClassifierRule[] = [
  {
    pattern: /deploy(ment)?\s*(fail|broke|error|crash|down|build)/i,
    taskType: "deployment_failure",
    businessValueScore: 95, urgencyScore: 98, complexityScore: 70, riskScore: 85,
    recommendedMode: "deployment_fix", recommendedProvider: "render",
    requiredTools: ["render.getLogs", "render.getDeploy", "github.getCommit"],
    approvalRequired: true,
  },
  {
    pattern: /build\s*(fail|broke|error)/i,
    taskType: "build_failure",
    businessValueScore: 90, urgencyScore: 95, complexityScore: 65, riskScore: 75,
    recommendedMode: "build_fix", recommendedProvider: "groq",
    requiredTools: ["render.getLogs", "github.getFile"],
    approvalRequired: false,
  },
  {
    pattern: /(patch|fix|repair|update)\s+(repo|file|code|source)/i,
    taskType: "repo_patch",
    businessValueScore: 80, urgencyScore: 60, complexityScore: 75, riskScore: 80,
    recommendedMode: "code_patch", recommendedProvider: "github",
    requiredTools: ["github.getFile", "github.updateFile", "github.createPR"],
    approvalRequired: true,
  },
  {
    pattern: /audit|self.?repair|self.?audit|security.?review|vuln/i,
    taskType: "security_audit",
    businessValueScore: 85, urgencyScore: 70, complexityScore: 80, riskScore: 90,
    recommendedMode: "security_review", recommendedProvider: "anthropic",
    requiredTools: ["github.getTree", "github.getFile"],
    approvalRequired: true,
  },
  {
    pattern: /research|summarize|summarise|compare|analyse|analyze|explain/i,
    taskType: "research",
    businessValueScore: 60, urgencyScore: 30, complexityScore: 40, riskScore: 10,
    recommendedMode: "research", recommendedProvider: "groq",
    requiredTools: [],
    approvalRequired: false,
  },
  {
    pattern: /business\s+plan|strategy|market|revenue|pricing|launch\s+plan|roadmap/i,
    taskType: "business_strategy",
    businessValueScore: 85, urgencyScore: 40, complexityScore: 50, riskScore: 20,
    recommendedMode: "business_strategy", recommendedProvider: "openai",
    requiredTools: [],
    approvalRequired: false,
  },
  {
    pattern: /proof\s+report|evidence|readiness|launch\s+check/i,
    taskType: "proof_report",
    businessValueScore: 75, urgencyScore: 50, complexityScore: 45, riskScore: 15,
    recommendedMode: "proof_report", recommendedProvider: "groq",
    requiredTools: ["render.getDeploy", "github.getCommit"],
    approvalRequired: false,
  },
  {
    pattern: /railway|render\s+(deploy|service|log)/i,
    taskType: "deployment_ops",
    businessValueScore: 80, urgencyScore: 65, complexityScore: 55, riskScore: 60,
    recommendedMode: "deployment_fix", recommendedProvider: "railway",
    requiredTools: ["railway.getLogs", "railway.getDeploy"],
    approvalRequired: true,
  },
];

const DEFAULT_RULE: Omit<ClassifierRule, "pattern"> = {
  taskType: "general_question",
  businessValueScore: 40, urgencyScore: 20, complexityScore: 25, riskScore: 10,
  recommendedMode: "simple_answer", recommendedProvider: "groq",
  requiredTools: [],
  approvalRequired: false,
};

/**
 * Classify a free-text task/input and return a structured routing decision.
 * Pure function — no side effects, no DB calls.
 */
export function classifyTask(input: TaskClassifierInput): TaskClassifierResult {
  const text = input.input;

  // Credential/secret-sensitive override — always require approval
  const credentialSensitive = /secret|credential|api.?key|token|password|env.?var/i.test(text);

  for (const rule of CLASSIFIER_RULES) {
    if (rule.pattern.test(text)) {
      const approvalRequired = rule.approvalRequired || credentialSensitive;
      const riskScore = credentialSensitive ? Math.min(rule.riskScore + 10, 100) : rule.riskScore;
      return {
        taskType: rule.taskType,
        businessValueScore: rule.businessValueScore,
        urgencyScore: rule.urgencyScore,
        complexityScore: rule.complexityScore,
        riskScore,
        recommendedMode: rule.recommendedMode,
        recommendedProvider: rule.recommendedProvider,
        requiredTools: rule.requiredTools,
        approvalRequired,
        reason: `Matched pattern for task type "${rule.taskType}". Mode: ${rule.recommendedMode}. Provider: ${rule.recommendedProvider}.${approvalRequired ? " Approval required." : ""}`,
      };
    }
  }

  const approvalRequired = credentialSensitive;
  return {
    ...DEFAULT_RULE,
    approvalRequired,
    reason: `No specific pattern matched. Defaulting to simple_answer via groq.${credentialSensitive ? " Credential sensitivity detected — approval required." : ""}`,
  };
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

  // BUG 8 FIX: if the best score is non-positive, no candidate clears the acceptance threshold.
  // Return selected: null so the caller can route to human review / fallback instead of
  // silently using an unsuitable agent.
  if (best.score <= 0) {
    const reason = `No acceptable candidate — all scores non-positive. Best was ${best.candidate.provider}/${best.candidate.model} (score ${best.score}). ${rejectedSummary ? `Also considered: ${rejectedSummary}.` : ""} Route to human review or wait for a capable agent.`;
    return {
      selected: null,
      ranked: scored,
      reason,
      budgetWarning,
    };
  }

  const reason = `${best.reason}${rejectedSummary ? ` Rejected lower-scoring options: ${rejectedSummary}.` : ""}`;

  return {
    selected: best.candidate,
    ranked: scored,
    reason,
    budgetWarning,
  };
}

// ─── Spec-required export (T07) ──────────────────────────────────────────────

export interface RoutedTaskValue {
  taskType: string;
  businessValueScore: number;
  urgencyScore: number;
  complexityScore: number;
  riskScore: number;
  recommendedMode: RecommendedMode;
  recommendedProvider: RecommendedProvider;
  requiredTools: string[];
  approvalRequired: boolean;
  reason: string;
}

export interface RouteTaskValueInput {
  task: string;
  context?: string;
  requestedAction?: string;
  userConfirmed?: boolean;
}

/**
 * Classify a task description and return a structured value-routing decision.
 * Deterministic and JSON-serialisable. Uses classifyTask internally.
 */
export function routeTaskValue(input: RouteTaskValueInput): RoutedTaskValue {
  const classified = classifyTask({ input: input.task });

  const riskKeywords = /deploy|secret|credential|delete|merge|production|patch|write|repo/i;
  const urgencyKeywords = /fail|broken|crash|error|down|urgent|fix|repair/i;
  const complexityKeywords = /audit|orchestrat|multi.agent|full.stack|migration|architecture/i;

  const urgencyScore = urgencyKeywords.test(input.task) ? 8 : 4;
  const complexityScore = complexityKeywords.test(input.task) ? 7 : 3;
  const riskScore = riskKeywords.test(input.task) ? 7 : 2;
  const businessValueScore = Math.round((urgencyScore + complexityScore) / 2);

  const approvalRequired =
    (input.userConfirmed !== true) &&
    (riskScore >= 7 || /repo|deploy|credential|secret|delete|merge/i.test(input.requestedAction ?? ""));

  return {
    taskType: classified.taskType,
    businessValueScore,
    urgencyScore,
    complexityScore,
    riskScore,
    recommendedMode: classified.recommendedMode,
    recommendedProvider: classified.recommendedProvider,
    requiredTools: classified.requiredTools,
    approvalRequired,
    reason: classified.reason,
  };
}
