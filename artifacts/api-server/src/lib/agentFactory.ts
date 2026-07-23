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

export class ProviderConfigurationError extends Error {
  readonly code = "PROVIDER_NOT_CONFIGURED";
  readonly provider: string;

  constructor(provider: string, message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
    this.provider = provider;
  }
}

export function isSimulationAllowed(): boolean {
  return process.env.NODE_ENV === "test" || process.env.ALLOW_SIMULATION_MODE === "true";
}

async function getSetting(uppercaseKey: string): Promise<string | null> {
  const [upper] = await db.select().from(settingsTable).where(eq(settingsTable.key, uppercaseKey));
  if (upper?.value) return upper.value;
  const legacyKey = uppercaseKey.toLowerCase();
  const [lower] = await db.select().from(settingsTable).where(eq(settingsTable.key, legacyKey));
  return lower?.value ?? null;
}

function isValidKey(key: string | null): key is string {
  return typeof key === "string" && key.trim().length > 10;
}

export function buildMockAdapter(agent: Agent): AgentAdapter {
  if (!isSimulationAllowed()) {
    throw new ProviderConfigurationError(
      agent.provider,
      `A live ${agent.provider} call failed or was unavailable. VIBA will not replace it with fabricated output.`,
    );
  }

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

function unavailable(agent: Agent, detail: string): AgentAdapter {
  if (isSimulationAllowed()) {
    logger.warn(
      { provider: agent.provider, agentId: agent.id },
      `${detail} Simulation was explicitly enabled, so a labelled mock adapter will be used.`,
    );
    return buildMockAdapter(agent);
  }

  throw new ProviderConfigurationError(
    agent.provider,
    `${detail} VIBA will not fabricate an AI response. Configure a live provider credential or endpoint.`,
  );
}

/**
 * Resolve an API key in this order:
 * 1. User-specific encrypted vault entry.
 * 2. Platform administrator setting.
 * 3. Render environment variable.
 */
async function resolveApiKey(
  userId: number | null | undefined,
  provider: string,
  credentialLabel: string,
  settingKey: string,
  envKey: string = settingKey,
): Promise<string> {
  if (userId) {
    const vaultKey = await getVibaCredential({
      userId,
      provider,
      kind: "api_key",
      label: credentialLabel,
    });
    if (vaultKey) return vaultKey;

    if (credentialLabel !== "default") {
      logger.warn({ provider, credentialLabel }, "Requested credential label was not found; checking the user's default credential");
      const defaultVaultKey = await getVibaCredential({
        userId,
        provider,
        kind: "api_key",
        label: "default",
      });
      if (defaultVaultKey) return defaultVaultKey;
    }
  }

  const settingValue = await getSetting(settingKey);
  if (settingValue) return settingValue;
  return process.env[envKey] ?? "";
}

async function isProviderEnabled(provider: string): Promise<boolean> {
  const enabledSetting = await getSetting(`${provider.toUpperCase()}_ENABLED`);
  if (enabledSetting === null) return true;
  return enabledSetting === "true";
}

export async function buildAdapter(agent: Agent, userId?: number | null): Promise<AgentAdapter> {
  const provider = agent.provider.toLowerCase();
  const credentialLabel = agent.credentialLabel ?? "default";

  if (agent.isMock && !isSimulationAllowed()) {
    throw new ProviderConfigurationError(
      provider,
      `Agent ${agent.name} is marked as a simulation agent, but simulation mode is disabled.`,
    );
  }

  if (!(await isProviderEnabled(provider))) {
    return unavailable(agent, `${provider} is disabled in Connections.`);
  }

  const [railwayToken, githubToken] = await Promise.all([
    getSetting("RAILWAY_TOKEN").then((value) => value ?? process.env["RAILWAY_TOKEN"] ?? null),
    getSetting("GITHUB_TOKEN").then((value) => value ?? process.env["GITHUB_TOKEN"] ?? null),
  ]);

  if (provider === "openai") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "OPENAI_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No OpenAI API key is configured.");
    const model = await getSetting("OPENAI_MODEL") ?? undefined;
    return new OpenAIAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "anthropic") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "ANTHROPIC_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No Anthropic API key is configured.");
    const model = await getSetting("ANTHROPIC_MODEL") ?? undefined;
    return new AnthropicAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "google") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "GEMINI_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No Gemini API key is configured.");
    const model = await getSetting("GEMINI_MODEL") ?? undefined;
    return new GeminiAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "perplexity") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "PERPLEXITY_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No Perplexity API key is configured.");
    const model = await getSetting("PERPLEXITY_MODEL") ?? undefined;
    return new PerplexityAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "mistral") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "MISTRAL_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No Mistral API key is configured.");
    const model = await getSetting("MISTRAL_MODEL") ?? undefined;
    return new MistralAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "groq") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "GROQ_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No Groq API key is configured.");
    const model = await getSetting("GROQ_MODEL") ?? undefined;
    return new GroqAdapter(
      String(agent.id),
      agent.name,
      agent.role,
      apiKey,
      model,
      agent.canUseTools,
      railwayToken ?? undefined,
      githubToken ?? undefined,
    );
  }

  if (provider === "ollama") {
    const baseUrl = await getSetting("OLLAMA_BASE_URL") ?? process.env["OLLAMA_BASE_URL"] ?? "";
    if (!baseUrl) return unavailable(agent, "No Ollama endpoint is configured.");
    const model = await getSetting("OLLAMA_MODEL") ?? process.env["OLLAMA_MODEL"] ?? "llama3.2";
    return new OllamaAdapter(
      String(agent.id),
      agent.name,
      agent.role,
      model,
      baseUrl,
      agent.canUseTools,
      githubToken ?? undefined,
    );
  }

  if (provider === "railway") {
    if (!isValidKey(railwayToken)) return unavailable(agent, "No Railway token is configured.");
    const openaiKey = await getSetting("OPENAI_API_KEY") ?? process.env["OPENAI_API_KEY"] ?? "";
    const anthropicKey = await getSetting("ANTHROPIC_API_KEY") ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    const reasoningKey = isValidKey(openaiKey) ? openaiKey : isValidKey(anthropicKey) ? anthropicKey : "";
    if (!reasoningKey) return unavailable(agent, "Railway has no configured reasoning-provider key.");
    const model = await getSetting("RAILWAY_REASONING_MODEL") ?? undefined;
    return new RailwayAdapter(String(agent.id), agent.name, agent.role, railwayToken, reasoningKey, model);
  }

  if (provider === "deepseek") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "DEEPSEEK_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No DeepSeek API key is configured.");
    const model = await getSetting("DEEPSEEK_MODEL") ?? undefined;
    return new DeepSeekAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "venice") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "VENICE_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No Venice API key is configured.");
    const model = await getSetting("VENICE_MODEL") ?? undefined;
    return new VeniceAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "custom") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "CUSTOM_API_KEY");
    const endpoint = await getSetting("CUSTOM_ENDPOINT") ?? process.env["CUSTOM_ENDPOINT"] ?? "";
    if (!endpoint) return unavailable(agent, "No custom AI endpoint is configured.");
    const model = await getSetting("CUSTOM_MODEL") ?? undefined;
    return new CustomAIAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools, endpoint);
  }

  return unavailable(agent, `Unknown provider '${agent.provider}'.`);
}
