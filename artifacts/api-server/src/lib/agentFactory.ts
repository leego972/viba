import type { AgentAdapter } from "./adapters/interface";
import { OpenAIAdapter } from "./adapters/openai";
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

export function buildMockAdapter(agent: Agent): AgentAdapter {
  const provider = agent.provider.toLowerCase();
  if (provider === "anthropic") return new ClaudeMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "google") return new GeminiMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "perplexity") return new PerplexityMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "replit") return new ReplitMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "manus") return new ManusMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "railway") return new RailwayMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "groq") return new GroqMockAdapter(String(agent.id), agent.name, agent.role);
  if (provider === "ollama") return new OllamaMockAdapter(String(agent.id), agent.name, agent.role);
  return new ChatGPTMockAdapter(String(agent.id), agent.name, agent.role);
}

export async function buildAdapter(agent: Agent): Promise<AgentAdapter> {
  const provider = agent.provider.toLowerCase();

  // Shared tool tokens — loaded once and reused across tool-capable adapters
  const [railwayToken, githubToken] = await Promise.all([
    getSetting("RAILWAY_TOKEN").then((v) => v ?? process.env["RAILWAY_TOKEN"] ?? null),
    getSetting("GITHUB_TOKEN").then((v) => v ?? process.env["GITHUB_TOKEN"] ?? null),
  ]);

  if (provider === "openai") {
    const apiKey = await getSetting("OPENAI_API_KEY") ?? process.env["OPENAI_API_KEY"] ?? "";
    if (isValidKey(apiKey)) {
      const model = await getSetting("OPENAI_MODEL") ?? undefined;
      return new OpenAIAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
    }
    logger.warn({ provider }, "No OpenAI API key found — using simulation mode");
    return new ChatGPTMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "anthropic") {
    const apiKey = await getSetting("ANTHROPIC_API_KEY") ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    if (isValidKey(apiKey)) {
      const model = await getSetting("ANTHROPIC_MODEL") ?? undefined;
      return new AnthropicAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
    }
    logger.warn({ provider }, "No Anthropic API key found — using simulation mode");
    return new ClaudeMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "google") {
    const apiKey = await getSetting("GEMINI_API_KEY") ?? process.env["GEMINI_API_KEY"] ?? "";
    if (isValidKey(apiKey)) {
      const model = await getSetting("GEMINI_MODEL") ?? undefined;
      return new GeminiAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
    }
    logger.warn({ provider }, "No Gemini API key found — using simulation mode");
    return new GeminiMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "perplexity") {
    const apiKey = await getSetting("PERPLEXITY_API_KEY") ?? process.env["PERPLEXITY_API_KEY"] ?? "";
    if (isValidKey(apiKey)) {
      const model = await getSetting("PERPLEXITY_MODEL") ?? undefined;
      return new PerplexityAdapter(String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools);
    }
    logger.warn({ provider }, "No Perplexity API key found — using simulation mode");
    return new PerplexityMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "replit") {
    const apiKey = await getSetting("REPLIT_API_KEY") ?? process.env["REPLIT_API_KEY"] ?? "";
    if (isValidKey(apiKey)) {
      return new ReplitAdapter(String(agent.id), agent.name, agent.role, apiKey);
    }
    logger.warn({ provider }, "No Replit API key found — using simulation mode");
    return new ReplitMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "groq") {
    const apiKey = await getSetting("GROQ_API_KEY") ?? process.env["GROQ_API_KEY"] ?? "";
    if (isValidKey(apiKey)) {
      const model = await getSetting("GROQ_MODEL") ?? undefined;
      return new GroqAdapter(
        String(agent.id), agent.name, agent.role, apiKey, model, agent.canUseTools,
        railwayToken ?? undefined,
        githubToken ?? undefined,
      );
    }
    logger.warn({ provider }, "No Groq API key found — using simulation mode");
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
    const apiKey = await getSetting("MANUS_API_KEY") ?? process.env["MANUS_API_KEY"] ?? "";
    if (isValidKey(apiKey)) {
      return new ManusAdapter(String(agent.id), agent.name, agent.role, apiKey);
    }
    logger.warn({ provider }, "No Manus API key found — using simulation mode");
    return new ManusMockAdapter(String(agent.id), agent.name, agent.role);
  }

  logger.warn({ provider }, "Unknown provider — using simulation mode");
  return new ChatGPTMockAdapter(String(agent.id), agent.name, agent.role);
}
