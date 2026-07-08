import type { AgentAdapter } from "./adapters/interface";
import { OpenAIAdapter } from "./adapters/openai";
import { OpenAICompatibleAdapter } from "./adapters/openaiCompatible";
import { AnthropicAdapter } from "./adapters/anthropic";
import { GeminiAdapter } from "./adapters/gemini";
import { PerplexityAdapter } from "./adapters/perplexity";
import { ReplitAdapter } from "./adapters/replit";
import { ManusAdapter } from "./adapters/manus";
import { RailwayAdapter } from "./adapters/railway";
import { GroqAdapter } from "./adapters/groq";
import { OllamaAdapter } from "./adapters/ollama";
import {
  ChatGPTMockAdapter,
  ClaudeMockAdapter,
  GeminiMockAdapter,
  PerplexityMockAdapter,
  ReplitMockAdapter,
  ManusMockAdapter,
  RailwayMockAdapter,
  GroqMockAdapter,
  OllamaMockAdapter,
} from "./adapters/mocks";
import type { Agent } from "@workspace/db";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { getVibaCredential } from "./vibaVault";

const CUSTOM_COMPATIBLE_BASE_URLS: Record<string, string> = {
  venice: "https://api.venice.ai/api/v1",
  openrouter: "https://openrouter.ai/api/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  deepseek: "https://api.deepseek.com",
  lmstudio: "http://localhost:1234/v1",
  "lm-studio": "http://localhost:1234/v1",
  localai: "http://localhost:8080/v1",
};

async function getSetting(uppercaseKey: string): Promise<string | null> {
  const [upper] = await db.select().from(settingsTable).where(eq(settingsTable.key, uppercaseKey));
  if (upper?.value) return upper.value;
  const legacyKey = uppercaseKey.toLowerCase();
  const [lower] = await db.select().from(settingsTable).where(eq(settingsTable.key, legacyKey));
  return lower?.value ?? null;
}

function isValidKey(key: string | null): key is string {
  return typeof key === "string" && key.length > 10;
}

function settingPrefix(provider: string): string {
  return provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function cleanEndpoint(endpoint: string | null | undefined): string | undefined {
  const value = endpoint?.trim().replace(/\/+$/, "");
  return value ? value : undefined;
}

export function buildMockAdapter(agent: Agent): AgentAdapter {
  const provider = agent.provider.toLowerCase();
  if (provider === "anthropic") return new ClaudeMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "google") return new GeminiMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "perplexity") return new PerplexityMockAdapter(String(agent.id), agent.name, agent.role);
  // Pass agent.canUseTools so simulation mode preserves the same handoff/capability semantics as live mode
  if (provider === "replit") return new ReplitMockAdapter(String(agent.id), agent.name, agent.role, agent.canUseTools);
  if (provider === "manus") return new ManusMockAdapter(String(agent.id), agent.name, agent.role, agent.canUseTools);
  if (provider === "railway") return new RailwayMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "groq") return new GroqMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "ollama") return new OllamaMockAdapter(String(agent.id), agent.name, agent.role);
  return new ChatGPTMockAdapter(String(agent.id), agent.name, agent.role);
}

/**
 * Resolves an API key for the given provider. Priority order:
 *   1. User-specific vault entry matching the agent's credentialLabel (multi-key support)
 *   2. Global admin settings table
 *   3. Environment variable
 */
async function resolveApiKey(
  userId: number | null | undefined,
  provider: string,
  credentialLabel: string,
  settingKey: string,
  envKey: string = settingKey,
): Promise<string> {
  // 1. User vault: check for the labeled credential first
  if (userId) {
    const vaultKey = await getVibaCredential({ userId, provider, kind: "api_key", label: credentialLabel });
    if (vaultKey) return vaultKey;
    // If a non-default label was requested but not found, log a warning
    if (credentialLabel !== "default") {
      logger.warn({ provider, credentialLabel }, "Requested credential label not found in vault — falling back to global settings");
    }
    // Also try the "default" label in vault before going to settingsTable
    if (credentialLabel !== "default") {
      const defaultVaultKey = await getVibaCredential({ userId, provider, kind: "api_key", label: "default" });
      if (defaultVaultKey) return defaultVaultKey;
    }
  }
  // 2. Admin settings table
  const settingVal = await getSetting(settingKey);
  if (settingVal) return settingVal;
  // 3. Environment variable
  return process.env[envKey] ?? "";
}

export async function buildAdapter(agent: Agent, userId?: number | null): Promise<AgentAdapter> {
  const provider = agent.provider.toLowerCase();
  const credLabel = agent.credentialLabel ?? "default";

  // Shared tool tokens — loaded once and reused across tool-capable adapters
  // For tool tokens, always use admin settings / env (they are global infrastructure tokens)
  const [railwayToken, githubToken] = await Promise.all([
    getSetting("RAILWAY_TOKEN").then((v) => v ?? process.env["RAILWAY_TOKEN"] ?? null),
    getSetting("GITHUB_TOKEN").then((v) => v ?? process.env["GITHUB_TOKEN"] ?? null),
  ]);

  if (provider === "openai") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "OPENAI_API_KEY");
    if (isValidKey(apiKey)) {
      const model = await getSetting("OPENAI_MODEL") ?? undefined;
      return new OpenAIAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
    }
    logger.warn({ provider, credLabel }, "No OpenAI API key found — using simulation mode");
    return new ChatGPTMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "anthropic") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "ANTHROPIC_API_KEY");
    if (isValidKey(apiKey)) {
      const model = await getSetting("ANTHROPIC_MODEL") ?? undefined;
      return new AnthropicAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
    }
    logger.warn({ provider, credLabel }, "No Anthropic API key found — using simulation mode");
    return new ClaudeMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "google") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "GEMINI_API_KEY");
    if (isValidKey(apiKey)) {
      const model = await getSetting("GEMINI_MODEL") ?? undefined;
      return new GeminiAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
    }
    logger.warn({ provider, credLabel }, "No Gemini API key found — using simulation mode");
    return new GeminiMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "perplexity") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "PERPLEXITY_API_KEY");
    if (isValidKey(apiKey)) {
      const model = await getSetting("PERPLEXITY_MODEL") ?? undefined;
      return new PerplexityAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
    }
    logger.warn({ provider, credLabel }, "No Perplexity API key found — using simulation mode");
    return new PerplexityMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "replit") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "REPLIT_API_KEY");
    if (isValidKey(apiKey)) {
      return new ReplitAdapter(String(agent.id), agent.name, agent.role, apiKey, undefined, agent.canUseTools);
    }
    logger.warn({ provider, credLabel }, "No Replit API key found — using simulation mode");
    return new ReplitMockAdapter(String(agent.id), agent.name, agent.role, agent.canUseTools);
  }

  if (provider === "groq") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "GROQ_API_KEY");
    if (isValidKey(apiKey)) {
      const model = await getSetting("GROQ_MODEL") ?? undefined;
      return new GroqAdapter(
        String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools,
        railwayToken ?? undefined,
        githubToken ?? undefined,
      );
    }
    logger.warn({ provider, credLabel }, "No Groq API key found — using simulation mode");
    return new GroqMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "ollama") {
    const baseUrl = await getSetting("OLLAMA_BASE_URL") ?? process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
    const model = await getSetting("OLLAMA_MODEL") ?? process.env["OLLAMA_MODEL"] ?? "llama3.2";
    return new OllamaAdapter(
      String(agent.id), agent.name, agent.role, model, baseUrl, agent.canUseTools,
      githubToken ?? undefined,
    );
  }

  if (provider === "railway") {
    if (isValidKey(railwayToken)) {
      const openaiKey = await getSetting("OPENAI_API_KEY") ?? process.env["OPENAI_API_KEY"] ?? "";
      const anthropicKey = await getSetting("ANTHROPIC_API_KEY") ?? process.env["ANTHROPIC_API_KEY"] ?? "";
      const reasoningKey = isValidKey(openaiKey) ? openaiKey : (isValidKey(anthropicKey) ? anthropicKey : "");
      const model = await getSetting("RAILWAY_REASONING_MODEL") ?? undefined;
      return new RailwayAdapter(String(agent.id), agent.name, agent.role, railwayToken, reasoningKey, model);
    }
    logger.warn({ provider }, "No RAILWAY_TOKEN found — using simulation mode");
    return new RailwayMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "manus") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "MANUS_API_KEY");
    if (isValidKey(apiKey)) {
      return new ManusAdapter(String(agent.id), agent.name, agent.role, apiKey, undefined, agent.canUseTools);
    }
    logger.warn({ provider, credLabel }, "No Manus API key found — using simulation mode");
    return new ManusMockAdapter(String(agent.id), agent.name, agent.role, agent.canUseTools);
  }

  const prefix = settingPrefix(provider);
  const apiKey = await resolveApiKey(userId, provider, credLabel, `${prefix}_API_KEY`);
  const baseUrl = cleanEndpoint(await getSetting(`${prefix}_ENDPOINT`)) ?? CUSTOM_COMPATIBLE_BASE_URLS[provider];
  const model = await getSetting(`${prefix}_MODEL`) ?? undefined;

  if (isValidKey(apiKey) && baseUrl) {
    return new OpenAICompatibleAdapter(
      String(agent.id),
      agent.name,
      agent.role,
      provider,
      apiKey,
      baseUrl,
      model,
      agent.canUseTools,
    );
  }

  logger.warn({ provider, hasKey: isValidKey(apiKey), hasBaseUrl: Boolean(baseUrl) }, "Unknown provider could not be routed through generic OpenAI-compatible adapter — using simulation mode");
  return new ChatGPTMockAdapter(String(agent.id), agent.name, agent.role);
}
