import type { AnalyzeTaskRequest, TaskType, ReviewLevel } from "./types";

export interface ClassificationResult {
  taskType: TaskType;
  automationReliability: "high" | "medium" | "low";
  recommendedModelStrength: "cheap" | "standard" | "strong";
  humanReviewRequired: boolean;
  reviewLevel: ReviewLevel;
}

const TYPE_PATTERNS: Array<{ patterns: RegExp[]; taskType: TaskType }> = [
  {
    patterns: [/grammar|spelling|punctuat|proofread|cleanup|typo/i],
    taskType: "grammar_cleanup",
  },
  {
    patterns: [/sentiment|tone|emotion|feeling/i],
    taskType: "sentiment_labeling",
  },
  {
    patterns: [/classif|categor|(?<!\bsentiment\s)\blabel\b|tag/i],
    taskType: "classification",
  },
  {
    patterns: [
      /compare|comparison|response\s*[AB]|which\s*(is|answer|response)\s*(better|worse|prefer)/i,
    ],
    taskType: "response_comparison",
  },
  {
    patterns: [
      /fact.?check|fact.?verif|is\s*(this|it)\s*(true|accurate|correct)|verify\s*the\s*claim/i,
    ],
    taskType: "factuality_check",
  },
  {
    patterns: [/\bmath\b|equation|calculat|algebra|arithmetic|\bproof\b/i],
    taskType: "math_reasoning",
  },
  {
    patterns: [/\bcode\b|program|function|debug|script|algorithm|implement/i],
    taskType: "coding",
  },
  {
    patterns: [/medical|legal|financial|scientific|domain\s*expert|professional\s*knowledge/i],
    taskType: "expert_domain",
  },
  {
    patterns: [/subjective|opinion|preference|judgment|best\s*in\s*your\s*opinion/i],
    taskType: "subjective_judgment",
  },
];

function detectTaskType(input: AnalyzeTaskRequest): TaskType {
  if (input.taskType && input.taskType !== "unknown") return input.taskType;

  const combined = `${input.instructions} ${input.taskContent}`;
  for (const { patterns, taskType } of TYPE_PATTERNS) {
    if (patterns.some((p) => p.test(combined))) return taskType;
  }
  return "unknown";
}

export function classifyTask(input: AnalyzeTaskRequest): ClassificationResult {
  const taskType = detectTaskType(input);
  const hasRubric = !!(input.rubric?.trim());

  switch (taskType) {
    case "grammar_cleanup":
      return {
        taskType,
        automationReliability: "high",
        recommendedModelStrength: "cheap",
        humanReviewRequired: false,
        reviewLevel: "quick_review",
      };

    case "classification":
    case "sentiment_labeling":
      return {
        taskType,
        automationReliability: "high",
        recommendedModelStrength: "cheap",
        humanReviewRequired: false,
        reviewLevel: hasRubric ? "quick_review" : "careful_review",
      };

    case "response_comparison":
      return {
        taskType,
        automationReliability: "medium",
        recommendedModelStrength: "standard",
        humanReviewRequired: false,
        reviewLevel: "careful_review",
      };

    case "factuality_check":
      return {
        taskType,
        automationReliability: "medium",
        recommendedModelStrength: "standard",
        humanReviewRequired: !hasRubric,
        reviewLevel: hasRubric ? "careful_review" : "human_only",
      };

    case "coding":
      return {
        taskType,
        automationReliability: "medium",
        recommendedModelStrength: "strong",
        humanReviewRequired: false,
        reviewLevel: hasRubric ? "careful_review" : "human_only",
      };

    case "math_reasoning":
      return {
        taskType,
        automationReliability: hasRubric ? "medium" : "low",
        recommendedModelStrength: "strong",
        humanReviewRequired: !hasRubric,
        reviewLevel: hasRubric ? "careful_review" : "human_only",
      };

    case "expert_domain":
      return {
        taskType,
        automationReliability: "low",
        recommendedModelStrength: "strong",
        humanReviewRequired: true,
        reviewLevel: "human_only",
      };

    case "subjective_judgment":
      return {
        taskType,
        automationReliability: hasRubric ? "medium" : "low",
        recommendedModelStrength: "standard",
        humanReviewRequired: !hasRubric,
        reviewLevel: hasRubric ? "careful_review" : "human_only",
      };

    default:
      return {
        taskType: "unknown",
        automationReliability: "low",
        recommendedModelStrength: "standard",
        humanReviewRequired: true,
        reviewLevel: "human_only",
      };
  }
}
