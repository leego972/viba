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

type AdapterType =
  | "auto"
  | "openai"
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "groq"
  | "perplexity"
  | "ollama"
  | "replit"
  | "manus"
  | "railway"
  | "render"
  | "vercel"
  | "digitalocean"
  | "github"
  | "cloudflare"
  | "stripe"
  | "email-api"
  | "messaging-api"
  | "generic-rest"
  | "credential-only";

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

const KNOWN_PROVIDER_ADAPTER_TYPES: Record<string, AdapterType> = {
  openai: "openai",
  anthropic: "anthropic",
  claude: "anthropic",
  google: "gemini",
  gemini: "gemini",
  groq: "groq",
  perplexity: "perplexity",
  ollama: "ollama",
  local: "ollama",
  replit: "replit",
  manus: "manus",
  railway: "railway",
  render: "render",
  vercel: "vercel",
  digitalocean: "digitalocean",
  github: "github",
  cloudflare: "cloudflare",
  stripe: "stripe",
  resend: "email-api",
  sendgrid: "email-api",
  slack: "messaging-api",
  venice: "openai-compatible",
  openrouter: "openai-compatible",
  together: "openai-compatible",
  fireworks: "openai-compatible",
  deepseek: "openai-compatible",
  lmstudio: "openai-compatible",
  "lm-studio": "openai-compatible",
  localai: "openai-compatible",
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

function parseAdapterType(value: string | null | undefined, provider: string): AdapterType {
  const candidate = value?.trim().toLowerCase();
  if (
    candidate === "openai" ||
    candidate === "openai-compatible" ||
    candidate === "anthropic" ||
    candidate === "gemini" ||
    candidate === "groq" ||
    candidate === "perplexity" ||
    candidate === "ollama" ||
    candidate === "replit" ||
    candidate === "manus" ||
    candidate === "railway" ||
    candidate === "render" ||
    candidate === "vercel" ||
    candidate === "digitalocean" ||
    candidate === "github" ||
    candidate === "cloudflare" ||
    candidate === "stripe" ||
    candidate === "email-api" ||
    candidate === "messaging-api" ||
    candidate === "generic-rest" ||
    candidate === "credential-only"
  ) return candidate;
  return KNOWN_PROVIDER_ADAPTER_TYPES[provider] ?? "openai-compatible";
}

export function buildMockAdapter(agent: Agent): AgentAdapter {
  const provider = agent.provider.toLowerCase();
  if (provider === "anthropic") return new ClaudeMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "google" || provider === "gemini") return new GeminiMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "perplexity") return new PerplexityMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "replit") return new ReplitMockAdapter(String(agent.id), agent.name, agent.role, agent.canUseTools);
  if (provider === "manus") return new ManusMockAdapter(String(agent.id), agent.name, agent.role, agent.canUseTools);
  if (provider === "railway") return new RailwayMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "groq") return new GroqMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "ollama") return new OllamaMockAdapter(String(agent.id), agent.name, agent.role);
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

async function buildConfiguredAdapter(params: {
  agent: Agent;
  userId?: number | null;
  provider: string;
  settingPrefix: string;
  adapterType: AdapterType;
  defaultBaseUrl?: string;
  railwayToken?: string | null;
  githubToken?: string | null;
}): Promise<AgentAdapter | null> {
  const { agent, userId, provider, settingPrefix: prefix, adapterType, defaultBaseUrl, railwayToken, githubToken } = params;
  const credLabel = agent.credentialLabel ?? "default";
  const apiKey = await resolveApiKey(userId, provider, credLabel, `${prefix}_API_KEY`);
  const model = await getSetting(`${prefix}_MODEL`) ?? undefined;
  const baseUrl = cleanEndpoint(await getSetting(`${prefix}_ENDPOINT`)) ?? defaultBaseUrl;

  if (adapterType === "ollama") {
    const ollamaBaseUrl = baseUrl ?? "http://localhost:11434";
    return new OllamaAdapter(String(agent.id), agent.name, agent.role, model ?? "llama3.2", ollamaBaseUrl, agent.canUseTools, githubToken ?? undefined);
  }

  if (!isValidKey(apiKey)) return null;

  if (adapterType === "openai") return new OpenAIAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  if (adapterType === "anthropic") return new AnthropicAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  if (adapterType === "gemini") return new GeminiAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  if (adapterType === "groq") return new GroqAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools, railwayToken ?? undefined, githubToken ?? undefined);
  if (adapterType === "perplexity") return new PerplexityAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  if (adapterType === "replit") return new ReplitAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  if (adapterType === "manus") return new ManusAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
  if (adapterType === "railway") return new RailwayAdapter(String(agent.id), agent.name, agent.role, apiKey, "", model);
  if (adapterType === "openai-compatible") {
    if (!baseUrl) return null;
    return new OpenAICompatibleAdapter(String(agent.id), agent.name, agent.role, provider, apiKey, baseUrl, model, agent.canUseTools);
  }

  logger.warn({ provider, adapterType }, "Provider connection is registered but is not an AI agent runtime adapter. It is available to tool-specific code, not agent chat execution.");
  return null;
}

export async function buildAdapter(agent: Agent, userId?: number | null): Promise<AgentAdapter> {
  const provider = agent.provider.toLowerCase();
  const credLabel = agent.credentialLabel ?? "default";

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

  if (provider === "google" || provider === "gemini") {
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
    if (isValidKey(apiKey)) return new ReplitAdapter(String(agent.id), agent.name, agent.role, apiKey, undefined, agent.canUseTools);
    logger.warn({ provider, credLabel }, "No Replit API key found — using simulation mode");
    return new ReplitMockAdapter(String(agent.id), agent.name, agent.role, agent.canUseTools);
  }

  if (provider === "groq") {
    const apiKey = await resolveApiKey(userId, provider, credLabel, "GROQ_API_KEY");
    if (isValidKey(apiKey)) {
      const model = await getSetting("GROQ_MODEL") ?? undefined;
      return new GroqAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools, railwayToken ?? undefined, githubToken ?? undefined);
    }
    logger.warn({ provider, credLabel }, "No Groq API key found — using simulation mode");
    return new GroqMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "ollama") {
    const baseUrl = await getSetting("OLLAMA_BASE_URL") ?? process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
    const model = await getSetting("OLLAMA_MODEL") ?? process.env["OLLAMA_MODEL"] ?? "llama3.2";
    return new OllamaAdapter(String(agent.id), agent.name, agent.role, model, baseUrl, agent.canUseTools, githubToken ?? undefined);
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
    if (isValidKey(apiKey)) return new ManusAdapter(String(agent.id), agent.name, agent.role, apiKey, undefined, agent.canUseTools);
    logger.warn({ provider, credLabel }, "No Manus API key found — using simulation mode");
    return new ManusMockAdapter(String(agent.id), agent.name, agent.role, agent.canUseTools);
  }

  const prefix = settingPrefix(provider);
  const selectedAdapterType = parseAdapterType(await getSetting(`${prefix}_ADAPTER_TYPE`), provider);
  const built = await buildConfiguredAdapter({
    agent,
    userId,
    provider,
    settingPrefix: prefix,
    adapterType: selectedAdapterType,
    defaultBaseUrl: CUSTOM_COMPATIBLE_BASE_URLS[provider],
    railwayToken,
    githubToken,
  });

  if (built) return built;

  logger.warn({ provider, selectedAdapterType }, "Provider could not be used as an AI runtime adapter — using simulation mode");
  return new ChatGPTMockAdapter(String(agent.id), agent.name, agent.role);
}
