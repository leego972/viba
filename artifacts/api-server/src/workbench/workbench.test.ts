import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateWorkbenchRequest, refuseCheck, REFUSAL_MESSAGE } from "./safety";
import { classifyTask } from "./taskClassifier";
import { checkRubric } from "./rubricChecker";
import type { AnalyzeTaskRequest } from "./types";

// ── Safety tests ──────────────────────────────────────────────────────────────

describe("validateWorkbenchRequest", () => {
  it("allows a normal labelling task", () => {
    const result = validateWorkbenchRequest({
      instructions: "Label the sentiment of this tweet as positive, negative, or neutral.",
      taskContent: "I love this product!",
    });
    expect(result.allowed).toBe(true);
  });

  it("allows a coding task", () => {
    const result = validateWorkbenchRequest({
      instructions: "Review this Python function for correctness.",
      taskContent: "def add(a, b):\n  return a + b",
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks auto-login language", () => {
    const result = validateWorkbenchRequest({
      instructions: "auto-login to the platform and submit the answer",
      taskContent: "task content",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(REFUSAL_MESSAGE);
  });

  it("blocks CAPTCHA bypass language", () => {
    const result = validateWorkbenchRequest({
      instructions: "fill in the task",
      taskContent: "bypass captcha on submission",
    });
    expect(result.allowed).toBe(false);
  });

  it("blocks auto-submit in userNotes", () => {
    const result = validateWorkbenchRequest({
      instructions: "classify this text",
      taskContent: "some text",
      userNotes: "use auto_submit after the answer",
    });
    expect(result.allowed).toBe(false);
  });

  it("blocks IP rotation language", () => {
    const result = validateWorkbenchRequest({
      instructions: "use IP rotation to avoid detection",
      taskContent: "",
    });
    expect(result.allowed).toBe(false);
  });

  it("blocks credential capture language", () => {
    const result = validateWorkbenchRequest({
      instructions: "credential capture the session cookies",
      taskContent: "",
    });
    expect(result.allowed).toBe(false);
  });

  it("blocks stealth automation language", () => {
    const result = validateWorkbenchRequest({
      instructions: "use stealth browser to submit",
      taskContent: "",
    });
    expect(result.allowed).toBe(false);
  });
});

describe("refuseCheck", () => {
  it("allows benign text", () => {
    const result = refuseCheck("Please classify this sentence.");
    expect(result.allowed).toBe(true);
  });

  it("blocks auto-login", () => {
    const result = refuseCheck("Can you auto login for me?");
    expect(result.allowed).toBe(false);
  });
});

// ── Task classification tests ─────────────────────────────────────────────────

describe("classifyTask", () => {
  const base: AnalyzeTaskRequest = {
    platform: "alignerr",
    instructions: "",
    taskContent: "",
  };

  it("detects grammar_cleanup", () => {
    const r = classifyTask({
      ...base,
      instructions: "Fix all grammar and spelling mistakes.",
      taskContent: "She go to school everyday.",
    });
    expect(r.taskType).toBe("grammar_cleanup");
    expect(r.automationReliability).toBe("high");
    expect(r.humanReviewRequired).toBe(false);
  });

  it("detects sentiment_labeling", () => {
    const r = classifyTask({
      ...base,
      instructions: "Label the sentiment as positive, negative, or neutral.",
      taskContent: "The product is great!",
    });
    expect(r.taskType).toBe("sentiment_labeling");
  });

  it("detects coding task", () => {
    const r = classifyTask({
      ...base,
      instructions: "Debug the following Python function.",
      taskContent: "def foo(): pass",
    });
    expect(r.taskType).toBe("coding");
    expect(r.recommendedModelStrength).toBe("strong");
  });

  it("detects expert_domain and requires human review", () => {
    const r = classifyTask({
      ...base,
      instructions: "Review this medical diagnosis for accuracy.",
      taskContent: "Patient has hypertension.",
    });
    expect(r.taskType).toBe("expert_domain");
    expect(r.humanReviewRequired).toBe(true);
    expect(r.reviewLevel).toBe("human_only");
  });

  it("detects math_reasoning without rubric → human_only", () => {
    const r = classifyTask({
      ...base,
      instructions: "Verify this algebra proof.",
      taskContent: "x^2 + 2x + 1 = (x+1)^2",
    });
    expect(r.taskType).toBe("math_reasoning");
    expect(r.humanReviewRequired).toBe(true);
    expect(r.reviewLevel).toBe("human_only");
  });

  it("detects math_reasoning with rubric → careful_review", () => {
    const r = classifyTask({
      ...base,
      instructions: "Verify this algebra proof.",
      taskContent: "x^2 + 2x + 1 = (x+1)^2",
      rubric: "Award 1 point per correct step.",
    });
    expect(r.taskType).toBe("math_reasoning");
    expect(r.humanReviewRequired).toBe(false);
    expect(r.reviewLevel).toBe("careful_review");
  });

  it("uses explicitly supplied taskType over detection", () => {
    const r = classifyTask({
      ...base,
      taskType: "response_comparison",
      instructions: "Do something completely unrelated.",
      taskContent: "Content here.",
    });
    expect(r.taskType).toBe("response_comparison");
  });

  it("returns unknown with human_only for unrecognised tasks", () => {
    const r = classifyTask({
      ...base,
      instructions: "Do something unusual.",
      taskContent: "xyz",
    });
    expect(r.taskType).toBe("unknown");
    expect(r.humanReviewRequired).toBe(true);
    expect(r.reviewLevel).toBe("human_only");
  });
});

// ── Rubric checker tests ──────────────────────────────────────────────────────

describe("checkRubric", () => {
  const baseInput: AnalyzeTaskRequest = {
    platform: "outlier",
    instructions: "Classify the sentiment.",
    taskContent: "This movie is fantastic!",
  };

  it("returns conservative defaults when LLM throws", async () => {
    const llm = { call: vi.fn().mockRejectedValue(new Error("network error")) };
    const result = await checkRubric({ input: baseInput, draft: "positive", llm });
    expect(result.reviewLevel).toBe("human_only");
    expect(result.confidence).toBe(0.3);
    expect(result.riskFlags.length).toBeGreaterThan(0);
  });

  it("parses a well-formed JSON response", async () => {
    const mockResponse = JSON.stringify({
      checklist: ["Format: pass", "Completeness: pass"],
      riskFlags: [],
      confidence: 0.9,
      reviewNotes: "Looks good.",
    });
    const llm = { call: vi.fn().mockResolvedValue(mockResponse) };
    const result = await checkRubric({ input: baseInput, draft: "positive", llm });
    expect(result.confidence).toBe(0.9);
    expect(result.reviewLevel).toBe("quick_review");
    expect(result.checklist).toHaveLength(2);
  });

  it("caps confidence to [0, 1]", async () => {
    const mockResponse = JSON.stringify({
      checklist: [],
      riskFlags: [],
      confidence: 1.5,
      reviewNotes: "",
    });
    const llm = { call: vi.fn().mockResolvedValue(mockResponse) };
    const result = await checkRubric({ input: baseInput, draft: "positive", llm });
    expect(result.confidence).toBe(1.0);
  });

  it("returns human_only for expert_domain regardless of confidence", async () => {
    const mockResponse = JSON.stringify({
      checklist: ["pass"],
      riskFlags: [],
      confidence: 0.95,
      reviewNotes: "",
    });
    const llm = { call: vi.fn().mockResolvedValue(mockResponse) };
    const result = await checkRubric({
      input: { ...baseInput, taskType: "expert_domain" },
      draft: "medical content",
      llm,
    });
    expect(result.reviewLevel).toBe("human_only");
  });

  it("handles non-JSON LLM response gracefully", async () => {
    const llm = { call: vi.fn().mockResolvedValue("I cannot evaluate this.") };
    const result = await checkRubric({ input: baseInput, draft: "positive", llm });
    expect(result.reviewLevel).toBe("careful_review");
    expect(result.confidence).toBe(0.5);
  });
});
