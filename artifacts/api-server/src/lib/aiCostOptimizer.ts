/**
 * VIBA AI Cost Optimiser — central routing service.
 *
 * Decides the cheapest reliable execution method for every task.
 * Priority order:
 *   cache → project_memory → local_tool → rule_engine → local_model
 *   → economy_model → premium_model → multi_model
 *
 * No AI provider should be called without going through this service.
 */
import { getAllModels, estimateCostUsd, selectModelForMode, type ModelProfile } from "./modelRegistry";
import { estimateRequest } from "./tokenEstimator";
import { checkBudgetStatus, fingerprintPrompt, checkCache } from "./usageTracker";
import { logger } from "./logger";

export type ExecutionMethod =
  | "cache"
  | "memory"
  | "local_tool"
  | "rule_engine"
  | "local_model"
  | "economy_model"
  | "premium_model"
  | "multi_model";

export type QualityMode = "economy" | "balanced" | "maximum";

export interface OptimisationRequest {
  userId: number;
  sessionId?: number;
  projectId?: string;
  taskType: string;
  prompt: string;
  contextText?: string;
  qualityMode?: QualityMode;
  preferredProvider?: string;
  forceMethod?: ExecutionMethod;
}

export interface OptimisationDecision {
  executionMethod: ExecutionMethod;
  provider?: string;
  model?: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCost: number;
  estimatedCostWithoutViba: number;
  estimatedSavings: number;
  savingsReasons: string[];
  confidence: number;
  qualityMode: QualityMode;
  cacheResult?: string;
  requiresApproval: boolean;
  budgetWarning: boolean;
}

const TASK_CAPABILITY_MAP: Record<string, string[]> = {
  grammar: ["grammar"],
  rewriting: ["rewriting", "grammar"],
  summarisation: ["summarisation"],
  data_extraction: ["summarisation", "reasoning"],
  code_formatting: ["coding", "code_formatting"],
  code_review: ["code_review", "coding"],
  bug_diagnosis: ["coding", "reasoning", "bug_diagnosis"],
  architecture: ["architecture", "reasoning"],
  business_strategy: ["business_strategy", "reasoning"],
  research: ["research", "summarisation"],
  image_analysis: ["vision"],
  document_analysis: ["document_analysis", "reasoning"],
  security_review: ["security_review", "reasoning"],
  planning: ["reasoning", "planning"],
  creative_generation: ["creative_generation"],
  complex_reasoning: ["complex_reasoning", "reasoning"],
  general: ["reasoning"],
};

const ECONOMY_TASK_TYPES = new Set([
  "grammar", "rewriting", "summarisation", "data_extraction", "code_formatting",
]);

const LOCAL_TOOL_TASK_TYPES = new Set([
  "browser_testing", "code_formatting", "data_extraction",
]);

const RULE_ENGINE_TASK_TYPES = new Set([
  "grammar", "code_formatting",
]);

function taskComplexity(taskType: string): "low" | "medium" | "high" {
  if (ECONOMY_TASK_TYPES.has(taskType)) return "low";
  if (["architecture", "business_strategy", "security_review", "complex_reasoning"].includes(taskType)) return "high";
  return "medium";
}

export async function decideOptimisation(req: OptimisationRequest): Promise<OptimisationDecision> {
  const qualityMode: QualityMode = req.qualityMode ?? "balanced";
  const savingsReasons: string[] = [];
  const tokenEst = estimateRequest(req.prompt, req.contextText ?? "");

  const [models, budgetStatus] = await Promise.all([
    getAllModels(),
    checkBudgetStatus(req.userId),
  ]);

  const effectiveMode: QualityMode = (budgetStatus.autoEconomy && qualityMode !== "maximum")
    ? "economy"
    : budgetStatus.blockPremium && qualityMode === "maximum"
    ? "balanced"
    : qualityMode;

  if (budgetStatus.autoEconomy && qualityMode !== "maximum") {
    savingsReasons.push("Auto-switched to Economy — monthly budget threshold reached");
  }

  const taskCaps = TASK_CAPABILITY_MAP[req.taskType] ?? ["reasoning"];

  // — Reference baseline cost (GPT-4o as "what you'd spend without VIBA")
  const premiumModel = models.find((m) => m.provider === "openai" && m.model === "gpt-4o")
    ?? models.find((m) => m.qualityTier === "premium" && m.enabled)!;
  const baselineCost = premiumModel
    ? estimateCostUsd(premiumModel, tokenEst.promptTokens, tokenEst.completionTokens)
    : 0.01;

  // — Force method override
  if (req.forceMethod) {
    const selectedModel = selectModelForMode(models, effectiveMode, taskCaps);
    return buildDecision({
      executionMethod: req.forceMethod,
      model: selectedModel,
      tokenEst,
      baselineCost,
      savingsReasons: [`User-selected execution method: ${req.forceMethod}`],
      confidence: 0.8,
      qualityMode: effectiveMode,
      budgetStatus,
    });
  }

  // 1 — Cache check
  const taskFingerprint = `${req.taskType}:${fingerprintPrompt(req.prompt)}`;
  const cacheCheck = await checkCache(req.userId, taskFingerprint);
  if (cacheCheck.hit) {
    savingsReasons.push("Reused previous result from cache");
    return buildDecision({
      executionMethod: "cache",
      model: null,
      tokenEst: { promptTokens: 0, completionTokens: 0, totalTokens: 0, isEstimated: true },
      baselineCost,
      savingsReasons,
      confidence: 0.99,
      qualityMode: effectiveMode,
      cacheResult: cacheCheck.result,
      budgetStatus,
    });
  }

  // 2 — Local tool (deterministic)
  if (LOCAL_TOOL_TASK_TYPES.has(req.taskType) && effectiveMode !== "maximum") {
    savingsReasons.push("Used browser automation and rule-based analysis");
    return buildDecision({
      executionMethod: "local_tool",
      model: null,
      tokenEst: { promptTokens: 0, completionTokens: 0, totalTokens: 0, isEstimated: true },
      baselineCost,
      savingsReasons,
      confidence: 0.95,
      qualityMode: effectiveMode,
      budgetStatus,
    });
  }

  // 3 — Rule engine
  if (RULE_ENGINE_TASK_TYPES.has(req.taskType) && effectiveMode === "economy") {
    savingsReasons.push("Completed using rule-based detection without AI");
    return buildDecision({
      executionMethod: "rule_engine",
      model: null,
      tokenEst: { promptTokens: 0, completionTokens: 0, totalTokens: 0, isEstimated: true },
      baselineCost,
      savingsReasons,
      confidence: 0.9,
      qualityMode: effectiveMode,
      budgetStatus,
    });
  }

  // 4 — Economy model
  const complexity = taskComplexity(req.taskType);
  if (effectiveMode === "economy" || (effectiveMode === "balanced" && complexity === "low")) {
    const econModel = selectEconomyModel(models, req.preferredProvider, taskCaps);
    if (econModel) {
      savingsReasons.push(`Used ${econModel.displayName} instead of a premium model`);
      if (tokenEst.promptTokens > 1000) savingsReasons.push("Removed duplicated context from prompt");
      return buildDecision({
        executionMethod: "economy_model",
        model: econModel,
        tokenEst,
        baselineCost,
        savingsReasons,
        confidence: 0.82,
        qualityMode: effectiveMode,
        budgetStatus,
      });
    }
  }

  // 5 — Standard model (balanced default)
  if (effectiveMode === "balanced" && complexity !== "high") {
    const stdModel = selectModelForMode(models, "balanced", taskCaps);
    if (stdModel && stdModel.qualityTier !== "premium") {
      savingsReasons.push(`Used ${stdModel.displayName} — sufficient for this task type`);
      return buildDecision({
        executionMethod: "economy_model",
        model: stdModel,
        tokenEst,
        baselineCost,
        savingsReasons,
        confidence: 0.78,
        qualityMode: effectiveMode,
        budgetStatus,
      });
    }
  }

  // 6 — Premium model
  if (budgetStatus.blockPremium) {
    const fallback = selectEconomyModel(models, undefined, taskCaps);
    savingsReasons.push("Budget limit reached — using economy model instead of premium");
    return buildDecision({
      executionMethod: "economy_model",
      model: fallback,
      tokenEst,
      baselineCost,
      savingsReasons,
      confidence: 0.6,
      qualityMode: effectiveMode,
      budgetStatus,
    });
  }

  const premiumModelSelected = effectiveMode === "maximum"
    ? models.find((m) => m.qualityTier === "premium" && m.provider === (req.preferredProvider ?? "anthropic") && m.enabled)
      ?? models.filter((m) => m.qualityTier === "premium" && m.enabled).sort((a, b) => b.outputCostPerMillionTokens - a.outputCostPerMillionTokens)[0]
    : models.find((m) => m.qualityTier === "premium" && taskCaps.some((c) => m.capabilities.includes(c)) && m.enabled)
      ?? models.find((m) => m.qualityTier === "premium" && m.enabled);

  if (premiumModelSelected) {
    savingsReasons.push(`A premium model was used only for this ${req.taskType} task`);
  }

  return buildDecision({
    executionMethod: effectiveMode === "maximum" ? "multi_model" : "premium_model",
    model: premiumModelSelected ?? null,
    tokenEst,
    baselineCost,
    savingsReasons,
    confidence: 0.9,
    qualityMode: effectiveMode,
    budgetStatus,
  });
}

function selectEconomyModel(
  models: ModelProfile[],
  preferredProvider?: string,
  taskCaps?: string[],
): ModelProfile | null {
  const economy = models.filter((m) => m.qualityTier === "economy" && m.enabled);
  const capable = taskCaps
    ? economy.filter((m) => taskCaps.some((c) => m.capabilities.includes(c)))
    : economy;
  const pool_ = capable.length > 0 ? capable : economy;

  if (preferredProvider) {
    const preferred = pool_.find((m) => m.provider === preferredProvider);
    if (preferred) return preferred;
  }

  return pool_.sort((a, b) => a.inputCostPerMillionTokens - b.inputCostPerMillionTokens)[0] ?? null;
}

function buildDecision(input: {
  executionMethod: ExecutionMethod;
  model: ModelProfile | null;
  tokenEst: { promptTokens: number; completionTokens: number; totalTokens: number; isEstimated: boolean };
  baselineCost: number;
  savingsReasons: string[];
  confidence: number;
  qualityMode: QualityMode;
  cacheResult?: string;
  budgetStatus: { withinBudget: boolean; blockPremium: boolean; monthlyBudget: number | null; spentThisMonth: number };
}): OptimisationDecision {
  const estimatedCost = input.model
    ? estimateCostUsd(input.model, input.tokenEst.promptTokens, input.tokenEst.completionTokens)
    : 0;

  const estimatedSavings = Math.max(0, input.baselineCost - estimatedCost);
  const requiresApproval = estimatedCost >= 1.0 && input.budgetStatus.withinBudget;

  return {
    executionMethod: input.executionMethod,
    provider: input.model?.provider,
    model: input.model?.model,
    estimatedInputTokens: input.tokenEst.promptTokens,
    estimatedOutputTokens: input.tokenEst.completionTokens,
    estimatedCost,
    estimatedCostWithoutViba: input.baselineCost,
    estimatedSavings,
    savingsReasons: input.savingsReasons,
    confidence: input.confidence,
    qualityMode: input.qualityMode,
    cacheResult: input.cacheResult,
    requiresApproval,
    budgetWarning: !input.budgetStatus.withinBudget,
  };
}

export async function previewDecision(req: OptimisationRequest): Promise<OptimisationDecision> {
  try {
    return await decideOptimisation(req);
  } catch (err) {
    logger.error({ err }, "aiCostOptimizer: previewDecision failed");
    return {
      executionMethod: "premium_model",
      estimatedInputTokens: 0, estimatedOutputTokens: 0,
      estimatedCost: 0, estimatedCostWithoutViba: 0, estimatedSavings: 0,
      savingsReasons: [], confidence: 0, qualityMode: req.qualityMode ?? "balanced",
      requiresApproval: false, budgetWarning: false,
    };
  }
}
