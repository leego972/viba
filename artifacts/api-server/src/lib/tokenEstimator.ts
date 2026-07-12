/**
 * Token estimation — before and after execution.
 * Uses tiktoken-style approximation (4 chars ≈ 1 token for English text).
 * Actual provider-reported counts always override estimates when available.
 */

export interface TokenEstimate {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  isEstimated: boolean;
}

export interface ActualTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  isEstimated: false;
}

const CHARS_PER_TOKEN = 4;
const AVG_COMPLETION_RATIO = 0.3;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimatePromptTokens(parts: {
  systemPrompt?: string;
  userMessage: string;
  context?: string;
  history?: Array<{ role: string; content: string }>;
}): number {
  const system = estimateTokens(parts.systemPrompt ?? "");
  const user = estimateTokens(parts.userMessage);
  const ctx = estimateTokens(parts.context ?? "");
  const hist = (parts.history ?? []).reduce((acc, m) => acc + estimateTokens(m.content) + 4, 0);
  return system + user + ctx + hist + 3;
}

export function estimateRequest(prompt: string, contextText = ""): TokenEstimate {
  const promptTokens = estimateTokens(prompt) + estimateTokens(contextText);
  const completionTokens = Math.ceil(promptTokens * AVG_COMPLETION_RATIO);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    isEstimated: true,
  };
}

export function parseProviderUsage(raw: unknown): ActualTokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const prompt = Number(
    r["prompt_tokens"] ?? r["promptTokens"] ?? r["input_tokens"] ?? r["inputTokens"] ?? 0,
  );
  const completion = Number(
    r["completion_tokens"] ?? r["completionTokens"] ?? r["output_tokens"] ?? r["outputTokens"] ?? 0,
  );

  if (prompt === 0 && completion === 0) return null;

  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion,
    isEstimated: false,
  };
}

export function compressContext(text: string, maxTokens: number): { compressed: string; tokensAvoided: number } {
  const originalTokens = estimateTokens(text);
  if (originalTokens <= maxTokens) return { compressed: text, tokensAvoided: 0 };

  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const compressed = text.slice(0, maxChars) + "\n[Context truncated to fit token budget]";
  return {
    compressed,
    tokensAvoided: originalTokens - estimateTokens(compressed),
  };
}

export function deduplicateContext(messages: Array<{ role: string; content: string }>): {
  deduplicated: Array<{ role: string; content: string }>;
  tokensAvoided: number;
} {
  const seen = new Set<string>();
  const result: Array<{ role: string; content: string }> = [];
  let tokensAvoided = 0;

  for (const msg of messages) {
    const fingerprint = `${msg.role}:${msg.content.slice(0, 200)}`;
    if (seen.has(fingerprint)) {
      tokensAvoided += estimateTokens(msg.content);
      continue;
    }
    seen.add(fingerprint);
    result.push(msg);
  }

  return { deduplicated: result, tokensAvoided };
}
