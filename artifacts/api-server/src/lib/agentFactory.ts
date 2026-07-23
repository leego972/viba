import type { AgentAdapter } from "./adapters/interface";
import { OpenAIAdapter } from "./adapters/openai";
import { AnthropicAdapter } from "./adapters/anthropic";
import { GeminiAdapter } from "./adapters/gemini";
import { PerplexityAdapter } from "./adapters/perplexity";
import { MistralAdapter } from "./adapters/mistral";
import { DeepSeekAdapter } from "./adapters/deepseek";
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
import { getProviderPreference } from "./providerPreferences";

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

async function getPlatformSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

function isValidKey(key: string | null): key is string {
  return typeof key === "string" && key.trim().length > 10;
}

function canonicalProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "gemini") return "google";
  return normalized;
}

function credentialAliases(provider: string): string[] {
  return provider === "google" ? ["google", "gemini"] : [provider];
}

export function buildMockAdapter(agent: Agent): AgentAdapter {
  if (!isSimulationAllowed()) {
    throw new ProviderConfigurationError(
      agent.provider,
      `A live ${agent.provider} call failed or was unavailable. VIBA will not replace it with fabricated output.`,
    );
  }

  const provider = canonicalProvider(agent.provider);
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

async function resolveApiKey(
  userId: number | null | undefined,
  provider: string,
  credentialLabel: string,
  envKey: string,
): Promise<string> {
  if (userId) {
    for (const alias of credentialAliases(provider)) {
      const labelled = await getVibaCredential({
        userId,
        provider: alias,
        kind: "api_key",
        label: credentialLabel,
      });
      if (labelled) return labelled;

      if (credentialLabel !== "default") {
        const fallback = await getVibaCredential({
          userId,
          provider: alias,
          kind: "api_key",
          label: "default",
        });
        if (fallback) return fallback;
      }
    }
  }

  return process.env[envKey]?.trim() ?? "";
}

async function providerEnabled(
  provider: string,
  userId: number | null | undefined,
): Promise<boolean> {
  const preference = await getProviderPreference(userId, provider);
  return preference?.enabled ?? true;
}

async function effectiveModel(
  provider: string,
  userId: number | null | undefined,
  settingKey: string,
  fallback?: string,
): Promise<string | undefined> {
  const preference = await getProviderPreference(userId, provider);
  return preference?.model ?? await getPlatformSetting(settingKey) ?? process.env[settingKey] ?? fallback;
}

async function effectiveEndpoint(
  provider: string,
  userId: number | null | undefined,
  settingKey: string,
  fallback = "",
): Promise<string> {
  const preference = await getProviderPreference(userId, provider);
  return preference?.endpoint ?? await getPlatformSetting(settingKey) ?? process.env[settingKey] ?? fallback;
}

export async function buildAdapter(agent: Agent, userId?: number | null): Promise<AgentAdapter> {
  const provider = canonicalProvider(agent.provider);
  const credentialLabel = agent.credentialLabel ?? "default";

  if (agent.isMock && !isSimulationAllowed()) {
    throw new ProviderConfigurationError(
      provider,
      `Agent ${agent.name} is marked as a simulation agent, but simulation mode is disabled.`,
    );
  }

  if (!(await providerEnabled(provider, userId))) {
    return unavailable(agent, `${provider} is disabled for this account.`);
  }

  const githubToken = await resolveApiKey(userId, "github", "default", "GITHUB_TOKEN");

  if (provider === "openai") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "OPENAI_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No OpenAI API key is configured.");
    const model = await effectiveModel(provider, userId, "OPENAI_MODEL");
    return new OpenAIAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "anthropic") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "ANTHROPIC_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No Anthropic API key is configured.");
    const model = await effectiveModel(provider, userId, "ANTHROPIC_MODEL");
    return new AnthropicAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "google") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "GEMINI_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No Gemini API key is configured.");
    const model = await effectiveModel(provider, userId, "GEMINI_MODEL");
    return new GeminiAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "perplexity") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "PERPLEXITY_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No Perplexity API key is configured.");
    const model = await effectiveModel(provider, userId, "PERPLEXITY_MODEL");
    return new PerplexityAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "mistral") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "MISTRAL_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No Mistral API key is configured.");
    const model = await effectiveModel(provider, userId, "MISTRAL_MODEL");
    return new MistralAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "groq") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "GROQ_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No Groq API key is configured.");
    const model = await effectiveModel(provider, userId, "GROQ_MODEL");
    return new GroqAdapter(
      String(agent.id),
      agent.name,
      agent.role,
      apiKey,
      model,
      agent.canUseTools,
      undefined,
      isValidKey(githubToken) ? githubToken : undefined,
    );
  }

  if (provider === "ollama") {
    const baseUrl = await effectiveEndpoint(provider, userId, "OLLAMA_BASE_URL");
    if (!baseUrl) return unavailable(agent, "No Ollama endpoint is configured.");
    const model = await effectiveModel(provider, userId, "OLLAMA_MODEL", "llama3.2") ?? "llama3.2";
    return new OllamaAdapter(
      String(agent.id),
      agent.name,
      agent.role,
      model,
      baseUrl,
      agent.canUseTools,
      isValidKey(githubToken) ? githubToken : undefined,
    );
  }

  if (provider === "railway") {
    return unavailable(agent, "The Railway agent has been retired from VIBA. Render is the supported deployment platform.");
  }

  if (provider === "deepseek") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "DEEPSEEK_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No DeepSeek API key is configured.");
    const model = await effectiveModel(provider, userId, "DEEPSEEK_MODEL");
    return new DeepSeekAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "venice") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "VENICE_API_KEY");
    if (!isValidKey(apiKey)) return unavailable(agent, "No Venice API key is configured.");
    const model = await effectiveModel(provider, userId, "VENICE_MODEL");
    return new VeniceAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  }

  if (provider === "custom") {
    const apiKey = await resolveApiKey(userId, provider, credentialLabel, "CUSTOM_API_KEY");
    const endpoint = await effectiveEndpoint(provider, userId, "CUSTOM_ENDPOINT");
    if (!endpoint) return unavailable(agent, "No custom AI endpoint is configured.");
    const model = await effectiveModel(provider, userId, "CUSTOM_MODEL");
    return new CustomAIAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools, endpoint);
  }

  return unavailable(agent, `Unknown provider '${agent.provider}'.`);
}
