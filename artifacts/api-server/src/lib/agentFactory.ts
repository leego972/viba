import type { AgentAdapter } from "./adapters/interface";
import { OpenAIAdapter } from "./adapters/openai";
import {
  ClaudeMockAdapter,
  ManusMockAdapter,
  ReplitMockAdapter,
  GeminiMockAdapter,
  PerplexityMockAdapter,
  ChatGPTMockAdapter,
} from "./adapters/mocks";
import type { Agent } from "@workspace/db";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function buildAdapter(agent: Agent): Promise<AgentAdapter> {
  const provider = agent.provider.toLowerCase();

  if (provider === "openai") {
    // Check for real OpenAI key in settings or env
    const [setting] = await db.select().from(settingsTable).where(eq(settingsTable.key, "openai_api_key"));
    const apiKey = setting?.value || process.env.OPENAI_API_KEY || "";
    if (apiKey && apiKey.length > 10) {
      return new OpenAIAdapter(String(agent.id), agent.name, agent.role, apiKey);
    }
    // Fall back to mock
    return new ChatGPTMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "anthropic") {
    return new ClaudeMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "manus") {
    return new ManusMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "replit") {
    return new ReplitMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "google") {
    return new GeminiMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "perplexity") {
    return new PerplexityMockAdapter(String(agent.id), agent.name, agent.role);
  }

  // Default: ChatGPT mock
  return new ChatGPTMockAdapter(String(agent.id), agent.name, agent.role);
}
