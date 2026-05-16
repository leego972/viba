export type Platform =
  | "alignerr"
  | "outlier"
  | "dataannotation"
  | "toloka"
  | "remotasks"
  | "mindrift"
  | "other";

export type TaskType =
  | "grammar_cleanup"
  | "classification"
  | "sentiment_labeling"
  | "response_comparison"
  | "factuality_check"
  | "math_reasoning"
  | "coding"
  | "expert_domain"
  | "subjective_judgment"
  | "unknown";

export type ReviewLevel = "quick_review" | "careful_review" | "human_only";

export interface AnalyzeTaskRequest {
  platform: Platform;
  taskType?: TaskType;
  instructions: string;
  rubric?: string;
  taskContent: string;
  answerOptions?: string[];
  userNotes?: string;
  budgetLimitUsd?: number;
  routingMode?: "fast" | "balanced" | "quality";
}

export interface AnalyzeTaskResponse {
  taskId: string;
  platform: Platform;
  taskType: TaskType;
  recommendedAnswer: string;
  confidence: number;
  reasoningSummary: string;
  riskFlags: string[];
  rubricChecklist: string[];
  reviewLevel: ReviewLevel;
  humanReviewRequired: boolean;
  routingReceipt?: unknown;
}
