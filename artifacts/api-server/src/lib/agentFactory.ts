import type { AgentAdapter } from "./adapters/interface";
import { OpenAIAdapter } from "./adapters/openai";
import { AnthropicAdapter } from "./adapters/anthropic";
import { GeminiAdapter } from "./adapters/gemini";
import { PerplexityAdapter } from "./adapters/perplexity";
import { MistralAdapter } from "./adapters/mistral";
import { DeepSeekAdapter } from "./adapters/deepseek";
import { RailwayAdapter } from "./adapters/railway";
import { GroqAdapter } from "./adapters/groq";
import { OllamaAdapter } from "./adapters/ollama";
import { VeniceAdapter } from "./adapters/venice";
import { CustomAIAdapter } from "./adapters/custom";
import {
  ChatGPTMockAdapter,
  ClaudeMockAdapter,
  GeminiMockAdapter,
  PerplexityMockAdapter,
  MistralMockAdapter,
  DeepSeekMockAdapter,
  RailwayMockAdapter,
  GroqMockAdapter,
  OllamaMockAdapter,
  VeniceMockAdapter,
  CustomAIMockAdapter,
} from "./adapters/mocks";
import type { Agent } from "@workspace/db";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { getVibaCredential } from "./vibaVault";

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

function providerUnavailable(provider: string, reason: string): never {
  const error = new Error(`LIVE_PROVIDER_UNAVAILABLE:${provider}:${reason}`);
  error.name = "LiveProviderUnavailableError";
  throw error;
}

export function buildMockAdapter(agent: Agent): AgentAdapter {
  const provider = agent.provider.toLowerCase();
  if (provider === "anthropic") return new ClaudeMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "google") return new GeminiMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "perplexity") return new PerplexityMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "railway") return new RailwayMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "groq") return new GroqMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "ollama") return new OllamaMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "venice") return new VeniceMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "mistral") return new MistralMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "deepseek") return new DeepSeekMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "custom") return new CustomAIMockAdapter(String(agent.id), agent.name, agent.role);
  return new ChatGPTMockAdapter(String(agent.id), agent.name, agent.role);
}

async function resolveApiKey(
  userId: number | null | undefined,
  provider: string,
  credentialLabel: string,
  settingKey: string,
  envKey: string = settingKey,
): Promise<string> {
  if (userId) {
    const vaultKey = await getVibaCredential({ userId, provider, kind: "api_key", label: credentialLabel });
    if (vaultKey) return vaultKey;
    if (credentialLabel !== "default") {
      logger.warn({ provider, credentialLabel }, "Requested credential label not found in vault — falling back to global settings");
      const defaultVaultKey = await getVibaCredential({ userId, provider, kind: "api_key", label: "default" });
      if (defaultVaultKey) return defaultVaultKey;
    }
  }
  const settingVal = await getSetting(settingKey);
  if (settingVal) return settingVal;
  return process.env[envKey] ?? "";
}

export function resolveProviderEnabledSetting(
  canonicalValue: string | null,
  legacyValue: string | null,
): boolean {
  const selected = canonicalValue ?? legacyValue;
  if (selected === null) return true;
  return selected === "true";
}

async function isProviderEnabled(provider: string): Promise<boolean> {
  const normalized = provider.toLowerCase();
  const [canonicalValue, legacyValue] = await Promise.all([
    getSetting(`PROVIDER_ENABLED__${normalized}`),
    getSetting(`${normalized.toUpperCase()}_ENABLED`),
  ]);
  return resolveProviderEnabledSetting(canonicalValue, legacyValue);
}

export async function buildAdapter(agent: Agent, userId?: number | null): Promise<AgentAdapter> {
  const provider = agent.provider.toLowerCase();
  const credLabel = agent.credentialLabel ?? "default";

  // Simulation is allowed only for agents explicitly stored as mock agents.
  // Missing or disabled live providers throw so retry/fallback logic records the
  // failure instead of reporting a mock response as a successful live call.
  if (agent.isMock) return buildMockAdapter(agent);

  if (!(await isProviderEnabled(provider))) {
    logger.error({ provider, agentId: agent.id }, "Live provider is disabled in Connections");
    providerUnavailable(provider, "provider_disabled");
  }

  const [railwayToken, githubToken] = await Promise.all([
    getSetting("RAILWAY_TOKEN").then((v) => v ?? process.env["RAILWAY_TOKEN"] ?? null),
    getSetting("GITHUB_TOKEN").then((v) => v ?? process.env["GITHUB_TOKEN"] ?? null),
  ]);

  if (provider === "openai") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "OPENAI_API_KEY");
    if (!isValidKey(apiKey)) providerUnavailable(provider, "missing_api_key");
    const model = await getSetting("OPENAI_MODEL") ?? undefined;
    return new OpenAIAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "anthropic") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "ANTHROPIC_API_KEY");
    if (!isValidKey(apiKey)) providerUnavailable(provider, "missing_api_key");
    const model = await getSetting("ANTHROPIC_MODEL") ?? undefined;
    return new AnthropicAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "google") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "GEMINI_API_KEY");
    if (!isValidKey(apiKey)) providerUnavailable(provider, "missing_api_key");
    const model = await getSetting("GEMINI_MODEL") ?? undefined;
    return new GeminiAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "perplexity") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "PERPLEXITY_API_KEY");
    if (!isValidKey(apiKey)) providerUnavailable(provider, "missing_api_key");
    const model = await getSetting("PERPLEXITY_MODEL") ?? undefined;
    return new PerplexityAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "mistral") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "MISTRAL_API_KEY");
    if (!isValidKey(apiKey)) providerUnavailable(provider, "missing_api_key");
    const model = await getSetting("MISTRAL_MODEL") ?? undefined;
    return new MistralAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "groq") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "GROQ_API_KEY");
    if (!isValidKey(apiKey)) providerUnavailable(provider, "missing_api_key");
    const model = await getSetting("GROQ_MODEL") ?? undefined;
    return new GroqAdapter(
      String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools,
      railwayToken ?? undefined,
      githubToken ?? undefined,
    );
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
    if (!isValidKey(railwayToken)) providerUnavailable(provider, "missing_railway_token");
    const openaiKey = await getSetting("OPENAI_API_KEY") ?? process.env["OPENAI_API_KEY"] ?? "";
    const anthropicKey = await getSetting("ANTHROPIC_API_KEY") ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    const reasoningKey = isValidKey(openaiKey) ? openaiKey : (isValidKey(anthropicKey) ? anthropicKey : "");
    if (!reasoningKey) providerUnavailable(provider, "missing_reasoning_key");
    const model = await getSetting("RAILWAY_REASONING_MODEL") ?? undefined;
    return new RailwayAdapter(String(agent.id), agent.name, agent.role, railwayToken, reasoningKey, model);
  }

  if (provider === "deepseek") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "DEEPSEEK_API_KEY");
    if (!isValidKey(apiKey)) providerUnavailable(provider, "missing_api_key");
    const model = await getSetting("DEEPSEEK_MODEL") ?? undefined;
    return new DeepSeekAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "venice") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "VENICE_API_KEY");
    if (!isValidKey(apiKey)) providerUnavailable(provider, "missing_api_key");
    const model = await getSetting("VENICE_MODEL") ?? undefined;
    return new VeniceAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "custom") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "CUSTOM_API_KEY");
    const endpoint = await getSetting("CUSTOM_ENDPOINT") ?? process.env["CUSTOM_ENDPOINT"] ?? "";
    if (!endpoint) providerUnavailable(provider, "missing_endpoint");
    const model = await getSetting("CUSTOM_MODEL") ?? undefined;
    return new CustomAIAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools, endpoint);
  }

  providerUnavailable(provider, "unknown_provider");
}
