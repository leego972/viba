import crypto from "node:crypto";
import { db, settingsTable } from "@workspace/db";
import type { AnalyzeTaskRequest, AnalyzeTaskResponse, ReviewLevel } from "./types";
import { validateWorkbenchRequest } from "./safety";
import { classifyTask } from "./taskClassifier";
import {
  buildAnswerGenerationPrompt,
  buildFinalFormattingPrompt,
  buildRiskScoringPrompt,
} from "./prompts";
import { checkRubric, type WorkbenchLLMCaller } from "./rubricChecker";
import { buildLogEntry, logWorkbenchTask } from "./storage";
import { logger } from "../lib/logger";

// ── API-key loading ───────────────────────────────────────────────────────────

interface ApiKeys {
  openai?: string;
  anthropic?: string;
  gemini?: string;
}

async function loadApiKeys(): Promise<ApiKeys> {
  const rows = await db
    .select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable);
  const m = new Map(rows.map((r) => [r.key, r.value ?? ""]));
  return {
    openai: m.get("OPENAI_API_KEY") || undefined,
    anthropic: m.get("ANTHROPIC_API_KEY") || undefined,
    gemini: m.get("GEMINI_API_KEY") || undefined,
  };
}

// ── Provider selection ────────────────────────────────────────────────────────

type Provider = "openai" | "anthropic" | "gemini" | "simulation";

function selectProvider(
  keys: ApiKeys,
  routingMode: string,
  modelStrength: string
): { provider: Provider; model: string } {
  const pick = (
    provider: Provider,
    model: string
  ): { provider: Provider; model: string } => ({ provider, model });

  if (routingMode === "quality" || modelStrength === "strong") {
    if (keys.anthropic) return pick("anthropic", "claude-3-5-haiku-20241022");
    if (keys.openai) return pick("openai", "gpt-4o-mini");
    if (keys.gemini) return pick("gemini", "gemini-2.0-flash");
  } else if (routingMode === "fast" || modelStrength === "cheap") {
    if (keys.gemini) return pick("gemini", "gemini-2.0-flash");
    if (keys.openai) return pick("openai", "gpt-4o-mini");
    if (keys.anthropic) return pick("anthropic", "claude-3-5-haiku-20241022");
  } else {
    // balanced
    if (keys.openai) return pick("openai", "gpt-4o-mini");
    if (keys.anthropic) return pick("anthropic", "claude-3-5-haiku-20241022");
    if (keys.gemini) return pick("gemini", "gemini-2.0-flash");
  }
  return pick("simulation", "mock");
}

// ── LLM call implementations ──────────────────────────────────────────────────

async function callOpenAI(apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1200,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content ?? "";
}

async function callAnthropic(apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  return data.content.find((b) => b.type === "text")?.text ?? "";
}

async function callGemini(apiKey: string, model: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1200 },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = (await res.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  return data.candidates[0]?.content?.parts[0]?.text ?? "";
}

function simulateResponse(prompt: string): string {
  if (/riskLevel|risk\s*level/i.test(prompt)) {
    return JSON.stringify({
      riskLevel: "medium",
      rationale: "Simulated — no API key configured.",
    });
  }
  if (/Evaluate the draft|rubric review/i.test(prompt)) {
    return JSON.stringify({
      checklist: ["[Simulated] Unable to evaluate without an API key"],
      riskFlags: ["No API key configured — human review required"],
      confidence: 0.3,
      reviewNotes:
        "No API key is configured. Add a key in Settings to enable real AI analysis.",
    });
  }
  return (
    "⚠️ [Simulated — no API key configured]\n\n" +
    "This is a placeholder response. Please configure an API key in Settings " +
    "to receive real AI-assisted analysis for your task.\n\n" +
    "Human review required: yes"
  );
}

// ── LLM caller factory ────────────────────────────────────────────────────────

function makeLLMCaller(
  provider: Provider,
  model: string,
  keys: ApiKeys
): WorkbenchLLMCaller & { simulated: boolean } {
  const simulated = provider === "simulation";

  const call = async (prompt: string): Promise<string> => {
    switch (provider) {
      case "openai":
        return callOpenAI(keys.openai!, model, prompt);
      case "anthropic":
        return callAnthropic(keys.anthropic!, model, prompt);
      case "gemini":
        return callGemini(keys.gemini!, model, prompt);
      default:
        return simulateResponse(prompt);
    }
  };

  return { call, simulated };
}

// ── Main orchestration ────────────────────────────────────────────────────────

export class WorkbenchRefusalError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "WorkbenchRefusalError";
  }
}

function reviewLevelToHumanRequired(level: ReviewLevel): boolean {
  return level === "human_only";
}

export async function analyzeTask(input: AnalyzeTaskRequest): Promise<AnalyzeTaskResponse> {
  const startedAt = Date.now();
  const taskId = crypto.randomUUID();

  // 1. Safety gate
  const safety = validateWorkbenchRequest({
    instructions: input.instructions,
    taskContent: input.taskContent,
    userNotes: input.userNotes,
  });
  if (!safety.allowed) {
    throw new WorkbenchRefusalError(safety.reason ?? "Request refused by safety policy.");
  }

  // 2. Classify task
  const classification = classifyTask(input);
  logger.info(
    { taskId, taskType: classification.taskType, platform: input.platform },
    "workbench task classified"
  );

  // 3. Load keys & build LLM caller
  const keys = await loadApiKeys();
  const { provider, model } = selectProvider(
    keys,
    input.routingMode ?? "balanced",
    classification.recommendedModelStrength
  );
  const llm = makeLLMCaller(provider, model, keys);

  logger.info(
    { taskId, provider, model, simulated: llm.simulated },
    "workbench LLM provider selected"
  );

  // 4. Generate draft answer
  const draftPrompt = buildAnswerGenerationPrompt(input, classification);
  let draft: string;
  try {
    draft = await llm.call(draftPrompt);
  } catch (err) {
    logger.warn({ taskId, err }, "workbench draft generation failed; falling back to simulation");
    draft = simulateResponse(draftPrompt);
  }

  // 5. Rubric check
  const rubricResult = await checkRubric({ input, draft, llm });

  // 6. Risk scoring
  const riskPrompt = buildRiskScoringPrompt(input, draft, JSON.stringify(rubricResult.checklist));
  let riskRaw: string;
  try {
    riskRaw = await llm.call(riskPrompt);
  } catch {
    riskRaw = simulateResponse(riskPrompt);
  }

  // 7. Final formatting pass
  const finalPrompt = buildFinalFormattingPrompt(input, draft, riskRaw, riskRaw);
  let finalAnswer: string;
  try {
    finalAnswer = await llm.call(finalPrompt);
  } catch {
    finalAnswer = draft;
  }

  // Merge review level: take the stricter of classification vs rubric check
  const levelRank: Record<ReviewLevel, number> = {
    quick_review: 0,
    careful_review: 1,
    human_only: 2,
  };
  const mergedLevel: ReviewLevel =
    levelRank[rubricResult.reviewLevel] >= levelRank[classification.reviewLevel]
      ? rubricResult.reviewLevel
      : classification.reviewLevel;

  const humanReviewRequired =
    classification.humanReviewRequired || reviewLevelToHumanRequired(mergedLevel);

  // 8. Audit log (fire and forget)
  logWorkbenchTask(
    buildLogEntry({
      taskId,
      platform: input.platform,
      taskType: classification.taskType,
      instructions: input.instructions,
      rubric: input.rubric,
      taskContent: input.taskContent,
      confidence: rubricResult.confidence,
      riskFlags: rubricResult.riskFlags,
      reviewLevel: mergedLevel,
      simulated: llm.simulated,
      startedAt,
    })
  ).catch((err) => logger.error({ taskId, err }, "workbench audit log failed"));

  return {
    taskId,
    platform: input.platform,
    taskType: classification.taskType,
    recommendedAnswer: finalAnswer,
    confidence: rubricResult.confidence,
    reasoningSummary: rubricResult.reasoningSummary,
    riskFlags: rubricResult.riskFlags,
    rubricChecklist: rubricResult.checklist,
    reviewLevel: mergedLevel,
    humanReviewRequired,
    routingReceipt: {
      provider,
      model,
      simulated: llm.simulated,
    },
  };
}
