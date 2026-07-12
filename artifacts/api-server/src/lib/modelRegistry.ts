import { pool } from "@workspace/db";
import { logger } from "./logger";

export interface ModelProfile {
  provider: string;
  model: string;
  displayName: string;
  inputCostPerMillionTokens: number;
  outputCostPerMillionTokens: number;
  contextWindow: number;
  latency: "very_fast" | "fast" | "medium" | "slow";
  qualityTier: "economy" | "standard" | "premium";
  capabilities: string[];
  enabled: boolean;
}

const BUILT_IN_MODELS: ModelProfile[] = [
  {
    provider: "groq", model: "llama-3.3-70b-versatile", displayName: "Groq Llama 3.3 70B",
    inputCostPerMillionTokens: 0.59, outputCostPerMillionTokens: 0.79,
    contextWindow: 128000, latency: "very_fast", qualityTier: "economy",
    capabilities: ["reasoning", "coding", "summarisation", "research", "grammar", "rewriting"], enabled: true,
  },
  {
    provider: "groq", model: "llama-3.1-8b-instant", displayName: "Groq Llama 3.1 8B",
    inputCostPerMillionTokens: 0.05, outputCostPerMillionTokens: 0.08,
    contextWindow: 128000, latency: "very_fast", qualityTier: "economy",
    capabilities: ["grammar", "rewriting", "summarisation", "data_extraction", "code_formatting"], enabled: true,
  },
  {
    provider: "groq", model: "gemma2-9b-it", displayName: "Groq Gemma 2 9B",
    inputCostPerMillionTokens: 0.20, outputCostPerMillionTokens: 0.20,
    contextWindow: 8192, latency: "very_fast", qualityTier: "economy",
    capabilities: ["grammar", "rewriting", "summarisation"], enabled: true,
  },
  {
    provider: "openai", model: "gpt-4o-mini", displayName: "GPT-4o Mini",
    inputCostPerMillionTokens: 0.15, outputCostPerMillionTokens: 0.60,
    contextWindow: 128000, latency: "fast", qualityTier: "standard",
    capabilities: ["reasoning", "coding", "summarisation", "research", "grammar", "rewriting", "document_analysis", "vision"], enabled: true,
  },
  {
    provider: "openai", model: "gpt-4o", displayName: "GPT-4o",
    inputCostPerMillionTokens: 2.50, outputCostPerMillionTokens: 10.00,
    contextWindow: 128000, latency: "medium", qualityTier: "premium",
    capabilities: ["reasoning", "coding", "architecture", "business_strategy", "security_review", "document_analysis", "vision", "complex_reasoning"], enabled: true,
  },
  {
    provider: "openai", model: "o1-mini", displayName: "OpenAI o1 Mini",
    inputCostPerMillionTokens: 3.00, outputCostPerMillionTokens: 12.00,
    contextWindow: 128000, latency: "slow", qualityTier: "premium",
    capabilities: ["complex_reasoning", "architecture", "security_review", "bug_diagnosis"], enabled: true,
  },
  {
    provider: "anthropic", model: "claude-3-haiku-20240307", displayName: "Claude 3 Haiku",
    inputCostPerMillionTokens: 0.25, outputCostPerMillionTokens: 1.25,
    contextWindow: 200000, latency: "fast", qualityTier: "standard",
    capabilities: ["reasoning", "coding", "summarisation", "research", "document_analysis"], enabled: true,
  },
  {
    provider: "anthropic", model: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5",
    inputCostPerMillionTokens: 3.00, outputCostPerMillionTokens: 15.00,
    contextWindow: 200000, latency: "medium", qualityTier: "premium",
    capabilities: ["reasoning", "coding", "architecture", "business_strategy", "security_review", "code_review", "complex_reasoning", "creative_generation"], enabled: true,
  },
  {
    provider: "anthropic", model: "claude-opus-4-5", displayName: "Claude Opus 4.5",
    inputCostPerMillionTokens: 15.00, outputCostPerMillionTokens: 75.00,
    contextWindow: 200000, latency: "slow", qualityTier: "premium",
    capabilities: ["complex_reasoning", "architecture", "business_strategy", "security_review", "code_review", "research"], enabled: true,
  },
  {
    provider: "gemini", model: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash",
    inputCostPerMillionTokens: 0.10, outputCostPerMillionTokens: 0.40,
    contextWindow: 1048576, latency: "very_fast", qualityTier: "economy",
    capabilities: ["reasoning", "summarisation", "research", "grammar", "document_analysis", "vision", "rewriting"], enabled: true,
  },
  {
    provider: "gemini", model: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro",
    inputCostPerMillionTokens: 1.25, outputCostPerMillionTokens: 5.00,
    contextWindow: 1048576, latency: "medium", qualityTier: "premium",
    capabilities: ["reasoning", "coding", "architecture", "complex_reasoning", "document_analysis", "vision", "research"], enabled: true,
  },
  {
    provider: "perplexity", model: "sonar", displayName: "Perplexity Sonar",
    inputCostPerMillionTokens: 1.00, outputCostPerMillionTokens: 1.00,
    contextWindow: 127072, latency: "fast", qualityTier: "standard",
    capabilities: ["research", "summarisation"], enabled: true,
  },
  {
    provider: "ollama", model: "llama3.2", displayName: "Ollama Llama 3.2 (local)",
    inputCostPerMillionTokens: 0, outputCostPerMillionTokens: 0,
    contextWindow: 8192, latency: "medium", qualityTier: "economy",
    capabilities: ["grammar", "rewriting", "summarisation", "coding"], enabled: true,
  },
];

let _cache: ModelProfile[] | null = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function ensureModelRegistryTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_model_registry (
      id SERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      display_name TEXT NOT NULL,
      input_cost_per_million_tokens REAL NOT NULL DEFAULT 0,
      output_cost_per_million_tokens REAL NOT NULL DEFAULT 0,
      context_window INTEGER NOT NULL DEFAULT 8192,
      latency TEXT NOT NULL DEFAULT 'medium',
      quality_tier TEXT NOT NULL DEFAULT 'standard',
      capabilities TEXT[] NOT NULL DEFAULT '{}',
      enabled BOOLEAN NOT NULL DEFAULT true,
      notes TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(provider, model)
    )
  `);

  for (const m of BUILT_IN_MODELS) {
    await pool.query(
      `INSERT INTO ai_model_registry
         (provider, model, display_name, input_cost_per_million_tokens, output_cost_per_million_tokens,
          context_window, latency, quality_tier, capabilities, enabled, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (provider, model) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             input_cost_per_million_tokens = EXCLUDED.input_cost_per_million_tokens,
             output_cost_per_million_tokens = EXCLUDED.output_cost_per_million_tokens,
             context_window = EXCLUDED.context_window,
             latency = EXCLUDED.latency,
             quality_tier = EXCLUDED.quality_tier,
             capabilities = EXCLUDED.capabilities,
             updated_at = NOW()
       WHERE ai_model_registry.updated_at < NOW() - INTERVAL '1 day'`,
      [m.provider, m.model, m.displayName, m.inputCostPerMillionTokens, m.outputCostPerMillionTokens,
       m.contextWindow, m.latency, m.qualityTier, m.capabilities, m.enabled],
    );
  }
}

export async function getAllModels(): Promise<ModelProfile[]> {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;

  try {
    const { rows } = await pool.query<{
      provider: string; model: string; display_name: string;
      input_cost_per_million_tokens: number; output_cost_per_million_tokens: number;
      context_window: number; latency: string; quality_tier: string;
      capabilities: string[]; enabled: boolean;
    }>(`SELECT * FROM ai_model_registry ORDER BY quality_tier, provider, model`);

    _cache = rows.map((r) => ({
      provider: r.provider, model: r.model, displayName: r.display_name,
      inputCostPerMillionTokens: r.input_cost_per_million_tokens,
      outputCostPerMillionTokens: r.output_cost_per_million_tokens,
      contextWindow: r.context_window, latency: r.latency as ModelProfile["latency"],
      qualityTier: r.quality_tier as ModelProfile["qualityTier"],
      capabilities: r.capabilities, enabled: r.enabled,
    }));
    _cacheAt = Date.now();
    return _cache;
  } catch {
    logger.warn("modelRegistry: DB unavailable, using built-in list");
    return BUILT_IN_MODELS;
  }
}

export function invalidateModelCache(): void { _cache = null; }

export function estimateCostUsd(model: ModelProfile, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * model.inputCostPerMillionTokens +
    (outputTokens / 1_000_000) * model.outputCostPerMillionTokens
  );
}

export function selectModelForMode(
  models: ModelProfile[],
  qualityMode: "economy" | "balanced" | "maximum",
  taskCapabilities: string[],
): ModelProfile | null {
  const enabled = models.filter((m) => m.enabled);
  const capable = enabled.filter((m) =>
    taskCapabilities.length === 0 || taskCapabilities.some((c) => m.capabilities.includes(c)),
  );
  const pool_ = capable.length > 0 ? capable : enabled;

  if (qualityMode === "economy") {
    return pool_.filter((m) => m.qualityTier === "economy")[0]
      ?? pool_.filter((m) => m.qualityTier === "standard")[0]
      ?? pool_[0]
      ?? null;
  }
  if (qualityMode === "maximum") {
    return pool_.filter((m) => m.qualityTier === "premium").sort((a, b) =>
      b.outputCostPerMillionTokens - a.outputCostPerMillionTokens,
    )[0] ?? pool_[0] ?? null;
  }
  return pool_.filter((m) => m.qualityTier === "standard")[0]
    ?? pool_.filter((m) => m.qualityTier === "economy")[0]
    ?? pool_[0]
    ?? null;
}
