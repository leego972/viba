import type { AnalyzeTaskRequest, ReviewLevel } from "./types";
import { buildRubricReviewPrompt } from "./prompts";
import { logger } from "../lib/logger";

export interface RubricCheckResult {
  checklist: string[];
  riskFlags: string[];
  confidence: number;
  reviewLevel: ReviewLevel;
  reasoningSummary: string;
}

export interface WorkbenchLLMCaller {
  call(prompt: string): Promise<string>;
}

function confidenceToReviewLevel(confidence: number, isExpertDomain: boolean): ReviewLevel {
  if (isExpertDomain) return "human_only";
  if (confidence >= 0.8) return "quick_review";
  if (confidence >= 0.5) return "careful_review";
  return "human_only";
}

const CONSERVATIVE_FALLBACK: RubricCheckResult = {
  checklist: ["Rubric evaluation unavailable — LLM call failed"],
  riskFlags: ["Rubric evaluation could not complete; human review required"],
  confidence: 0.3,
  reviewLevel: "human_only",
  reasoningSummary: "Rubric check could not complete. Please review manually.",
};

export async function checkRubric({
  input,
  draft,
  llm,
}: {
  input: AnalyzeTaskRequest;
  draft: string;
  llm: WorkbenchLLMCaller;
}): Promise<RubricCheckResult> {
  const prompt = buildRubricReviewPrompt(input, draft);

  let raw: string;
  try {
    raw = await llm.call(prompt);
  } catch (err) {
    logger.warn({ err }, "workbench rubricChecker LLM call failed");
    return CONSERVATIVE_FALLBACK;
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      checklist: [raw.slice(0, 400)],
      riskFlags: [],
      confidence: 0.5,
      reviewLevel: "careful_review",
      reasoningSummary: raw.slice(0, 400),
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      checklist?: string[];
      riskFlags?: string[];
      confidence?: number;
      reviewNotes?: string;
    };

    const confidence =
      typeof parsed.confidence === "number"
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.5;

    const isExpertDomain = input.taskType === "expert_domain";
    const reviewLevel = confidenceToReviewLevel(confidence, isExpertDomain);

    return {
      checklist: Array.isArray(parsed.checklist) ? parsed.checklist : [],
      riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
      confidence,
      reviewLevel,
      reasoningSummary: typeof parsed.reviewNotes === "string" ? parsed.reviewNotes : "",
    };
  } catch {
    return {
      checklist: [raw.slice(0, 400)],
      riskFlags: [],
      confidence: 0.5,
      reviewLevel: "careful_review",
      reasoningSummary: raw.slice(0, 400),
    };
  }
}
