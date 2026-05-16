import type { AnalyzeTaskRequest, TaskType } from "./types";
import type { ClassificationResult } from "./taskClassifier";

function rubricBlock(rubric?: string): string {
  return rubric?.trim()
    ? `\nRubric / Evaluation Criteria:\n${rubric}`
    : "\n(No rubric provided — flag any subjective choices or missing evaluation criteria in your review note.)";
}

function answerOptionsBlock(options?: string[]): string {
  if (!options || options.length === 0) return "";
  return `\nAvailable answer options: ${options.join(", ")}`;
}

const TASK_TYPE_GUIDANCE: Partial<Record<TaskType, string>> = {
  grammar_cleanup:
    "Focus on correctness, natural flow, and preserving the original meaning exactly.",
  classification:
    "Choose the single most appropriate category. Justify briefly with evidence from the text.",
  sentiment_labeling:
    "Identify the dominant tone and emotional register. Avoid over-labelling mixed content.",
  response_comparison:
    "Evaluate both responses on accuracy, helpfulness, and instruction-following. Do not invent facts to favour either side.",
  factuality_check:
    "Only assert what can be verified from the provided task content. Flag anything that requires external evidence not included here.",
  math_reasoning:
    "Show each reasoning step explicitly. Flag any step where an assumption is made.",
  coding:
    "Produce working, readable code. Explain any trade-offs or assumptions made.",
  expert_domain:
    "Note clearly where specialist judgment is required beyond what a general-purpose AI can reliably provide.",
  subjective_judgment:
    "Explain the trade-offs explicitly. Do not present a single subjective view as objectively correct.",
};

export function buildAnswerGenerationPrompt(
  input: AnalyzeTaskRequest,
  classification: ClassificationResult
): string {
  const typeGuidance = TASK_TYPE_GUIDANCE[classification.taskType];
  return `You are an AI assistant helping a human reviewer complete an AI-training task on the ${input.platform} platform.

Task type: ${classification.taskType}${typeGuidance ? `\nGuidance: ${typeGuidance}` : ""}

Instructions from the platform:
${input.instructions}
${rubricBlock(input.rubric)}${answerOptionsBlock(input.answerOptions)}

Task content to evaluate:
${input.taskContent}
${input.userNotes ? `\nReviewer notes: ${input.userNotes}` : ""}

Produce a draft answer. Strict rules:
- Follow the instructions and rubric exactly.
- Do NOT invent facts. If external evidence is required but not provided, state that explicitly.
- If the task is subjective, explain the trade-off between options rather than asserting one answer.
- Do NOT instruct the reviewer to auto-submit, log in, or bypass any platform control.
- End with a one-line human-review note flagging any areas of uncertainty.`;
}

export function buildRubricReviewPrompt(
  input: AnalyzeTaskRequest,
  draft: string
): string {
  return `You are a quality-control reviewer evaluating a draft answer against the task rubric.

Platform: ${input.platform}
Instructions: ${input.instructions}
${rubricBlock(input.rubric)}

Draft answer:
${draft}

Evaluate the draft on each dimension below:
1. Format compliance — does it match any specified format requirements?
2. Completeness — does it address all parts of the instructions?
3. Instruction match — does it follow every stated rule?
4. Hallucination risk — are any claims unverifiable from the provided task content?
5. Ambiguity — are there choices that require human judgment to resolve?
6. Missing evidence — is external information assumed but not provided?
7. Domain expertise risk — does this require specialist knowledge beyond general AI capability?
8. Answer-option consistency — if answer options were provided, is the answer one of them?

Respond ONLY with valid JSON (no prose outside the JSON block):
{
  "checklist": ["one pass/fail note per dimension"],
  "riskFlags": ["list specific concerns, or empty array if none"],
  "confidence": 0.0,
  "reviewNotes": "brief human-reviewer guidance"
}`;
}

export function buildRiskScoringPrompt(
  input: AnalyzeTaskRequest,
  draft: string,
  rubricReview: string
): string {
  return `You are a risk assessor for an AI-assisted human-review workflow.

Task type: ${input.taskType ?? "unknown"} | Platform: ${input.platform}

Draft answer:
${draft}

Rubric review result:
${rubricReview}

Score the overall risk level of accepting this draft without further expert review:
- "low": Safe to quick-review. High confidence, no significant flags.
- "medium": Needs careful human review. Some uncertainty or flags present.
- "high": Must have domain-expert review. Missing evidence, hallucination risk, or specialist domain.

Respond ONLY with valid JSON:
{ "riskLevel": "low" | "medium" | "high", "rationale": "brief reason" }`;
}

export function buildFinalFormattingPrompt(
  input: AnalyzeTaskRequest,
  draft: string,
  rubricReview: string,
  riskScore: string
): string {
  return `You are finalizing a recommended answer for a human reviewer. The reviewer will decide whether to accept, edit, or reject this answer before submitting it manually on the ${input.platform} platform.

Original instructions: ${input.instructions}
${rubricBlock(input.rubric)}${answerOptionsBlock(input.answerOptions)}

Draft answer:
${draft}

Rubric review: ${rubricReview}
Risk assessment: ${riskScore}

Produce the final recommended answer. Requirements:
- Clean, concise, ready to copy-paste.
- If an answer option was required, state only that option first, then a brief justification on the next line.
- Do NOT instruct the reviewer to log in, submit, or automate anything.
- Append a one-line human-review note if any uncertainty remains.`;
}
