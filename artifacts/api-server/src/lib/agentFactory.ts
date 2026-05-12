import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "./adapters/interface";
import { OpenAIAdapter } from "./adapters/openai";
import {
  ChatGPTMockAdapter,
  ClaudeMockAdapter,
  GeminiMockAdapter,
  PerplexityMockAdapter,
  ReplitMockAdapter,
  ManusMockAdapter,
} from "./adapters/mocks";
import type { Agent } from "@workspace/db";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

class AnthropicAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "anthropic";
  capabilities = ["code_review", "writing", "logic_critique", "ux_review"];
  role: string;
  isMock = false;
  private apiKey: string;
  private model: string;
  constructor(id: string, name: string, role: string, apiKey: string, model?: string) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.apiKey = apiKey;
    this.model = model ?? process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-20241022";
  }
  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const systemPrompt = `You are ${this.name}, an AI agent with the role of ${this.role} in a multi-agent collaboration platform called BridgeAI.\n\nProject Goal: ${input.projectGoal}\n\nShared Memory Summary: ${input.memorySummary || "No previous context."}\n\nYour task: ${input.taskInstruction}\n\nRespond in character as your role. Be specific, actionable, and concise. At the end of your response, include a JSON block (surrounded by \`\`\`json ... \`\`\`) with this structure:\n{\n  "suggestedNextTasks": ["string"],\n  "completionStatus": "in_progress" | "complete" | "needs_review" | "approval_required",\n  "confidence": 0.0-1.0\n}`;
    const messages = input.previousMessages.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.agentName ? `[${m.agentName}]: ${m.content}` : m.content,
    }));
    messages.push({ role: "user", content: input.taskInstruction });
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: this.apiKey });
      const response = await client.messages.create({
        model: this.model,
        max_tokens: 800,
        system: systemPrompt,
        messages: messages.slice(-10),
      });
      const block = response.content[0];
      const text = block?.type === "text" ? block.text : "";
      const inputCost = ((response.usage?.input_tokens ?? 0) / 1_000_000) * 0.80;
      const outputCost = ((response.usage?.output_tokens ?? 0) / 1_000_000) * 4.00;
      const cost = inputCost + outputCost;
      let suggestedNextTasks: string[] = [];
      let completionStatus: AgentTaskResult["completionStatus"] = "in_progress";
      let confidence = 0.7;
      let messageText = text;
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          suggestedNextTasks = parsed.suggestedNextTasks ?? [];
          completionStatus = parsed.completionStatus ?? "in_progress";
          confidence = parsed.confidence ?? 0.7;
          messageText = text.replace(/```json\n[\s\S]*?\n```/, "").trim();
        } catch { }
      }
      return { messageText, suggestedNextTasks, completionStatus, confidence, estimatedCost: cost };
    } catch (err) {
      logger.error({ err }, "Anthropic API call failed");
      throw err;
    }
  }
}

class GeminiAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "google";
  capabilities = ["multimodal", "contextual_analysis", "summarization", "creative"];
  role: string;
  isMock = false;
  private apiKey: string;
  private model: string;
  constructor(id: string, name: string, role: string, apiKey: string, model?: string) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.apiKey = apiKey;
    this.model = model ?? process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
  }
  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const systemPrompt = `You are ${this.name}, an AI agent with the role of ${this.role} in a multi-agent collaboration platform called BridgeAI.\n\nProject Goal: ${input.projectGoal}\n\nShared Memory Summary: ${input.memorySummary || "No previous context."}\n\nYour task: ${input.taskInstruction}\n\nRespond in character as your role. Be specific, actionable, and concise. At the end of your response, include a JSON block (surrounded by \`\`\`json ... \`\`\`) with this structure:\n{\n  "suggestedNextTasks": ["string"],\n  "completionStatus": "in_progress" | "complete" | "needs_review" | "approval_required",\n  "confidence": 0.0-1.0\n}`;
    const messages = input.previousMessages.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.agentName ? `[${m.agentName}]: ${m.content}` : m.content,
    }));
    messages.push({ role: "user", content: input.taskInstruction });
    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: this.apiKey, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" });
      const response = await client.chat.completions.create({
        model: this.model,
        messages: [{ role: "system", content: systemPrompt }, ...messages.slice(-10)],
        max_tokens: 800,
        temperature: 0.7,
      });
      const text = response.choices[0]?.message?.content ?? "";
      const usage = response.usage;
      const cost = ((usage?.prompt_tokens ?? 0) / 1_000_000) * 0.10 + ((usage?.completion_tokens ?? 0) / 1_000_000) * 0.40;
      let suggestedNextTasks: string[] = [];
      let completionStatus: AgentTaskResult["completionStatus"] = "in_progress";
      let confidence = 0.7;
      let messageText = text;
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          suggestedNextTasks = parsed.suggestedNextTasks ?? [];
          completionStatus = parsed.completionStatus ?? "in_progress";
          confidence = parsed.confidence ?? 0.7;
          messageText = text.replace(/```json\n[\s\S]*?\n```/, "").trim();
        } catch { }
      }
      return { messageText, suggestedNextTasks, completionStatus, confidence, estimatedCost: cost };
    } catch (err) {
      logger.error({ err }, "Gemini API call failed");
      throw err;
    }
  }
}

class PerplexityAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "perplexity";
  capabilities = ["research_summary", "fact_checking", "citation", "web_search"];
  role: string;
  isMock = false;
  private apiKey: string;
  private model: string;
  constructor(id: string, name: string, role: string, apiKey: string, model?: string) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.apiKey = apiKey;
    this.model = model ?? process.env.PERPLEXITY_MODEL ?? "sonar";
  }
  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const systemPrompt = `You are ${this.name}, an AI agent with the role of ${this.role} in a multi-agent collaboration platform called BridgeAI.\n\nProject Goal: ${input.projectGoal}\n\nShared Memory Summary: ${input.memorySummary || "No previous context."}\n\nYour task: ${input.taskInstruction}\n\nRespond in character as your role. Be specific, actionable, and concise. At the end of your response, include a JSON block (surrounded by \`\`\`json ... \`\`\`) with this structure:\n{\n  "suggestedNextTasks": ["string"],\n  "completionStatus": "in_progress" | "complete" | "needs_review" | "approval_required",\n  "confidence": 0.0-1.0\n}`;
    const messages = input.previousMessages.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.agentName ? `[${m.agentName}]: ${m.content}` : m.content,
    }));
    messages.push({ role: "user", content: input.taskInstruction });
    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: this.apiKey, baseURL: "https://api.perplexity.ai" });
      const response = await client.chat.completions.create({
        model: this.model,
        messages: [{ role: "system", content: systemPrompt }, ...messages.slice(-10)],
        max_tokens: 800,
        temperature: 0.7,
      });
      const text = response.choices[0]?.message?.content ?? "";
      const usage = response.usage;
      const cost = ((usage?.prompt_tokens ?? 0) / 1_000_000) * 1.00 + ((usage?.completion_tokens ?? 0) / 1_000_000) * 1.00;
      let suggestedNextTasks: string[] = [];
      let completionStatus: AgentTaskResult["completionStatus"] = "in_progress";
      let confidence = 0.7;
      let messageText = text;
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          suggestedNextTasks = parsed.suggestedNextTasks ?? [];
          completionStatus = parsed.completionStatus ?? "in_progress";
          confidence = parsed.confidence ?? 0.7;
          messageText = text.replace(/```json\n[\s\S]*?\n```/, "").trim();
        } catch { }
      }
      return { messageText, suggestedNextTasks, completionStatus, confidence, estimatedCost: cost };
    } catch (err) {
      logger.error({ err }, "Perplexity API call failed");
      throw err;
    }
  }
}

class ReplitAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "replit";
  capabilities = ["build", "code", "deployment", "implementation"];
  role: string;
  isMock = false;
  private apiKey: string;
  private model: string;
  constructor(id: string, name: string, role: string, apiKey: string, model?: string) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.apiKey = apiKey;
    this.model = model ?? process.env.REPLIT_MODEL ?? "replit-code-v1-3b";
  }
  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const systemPrompt = `You are ${this.name}, an AI agent with the role of ${this.role} in a multi-agent collaboration platform called BridgeAI.\n\nProject Goal: ${input.projectGoal}\n\nShared Memory Summary: ${input.memorySummary || "No previous context."}\n\nYour task: ${input.taskInstruction}\n\nRespond in character as your role. Be specific, actionable, and concise. At the end of your response, include a JSON block (surrounded by \`\`\`json ... \`\`\`) with this structure:\n{\n  "suggestedNextTasks": ["string"],\n  "completionStatus": "in_progress" | "complete" | "needs_review" | "approval_required",\n  "confidence": 0.0-1.0\n}`;
    const messages = input.previousMessages.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.agentName ? `[${m.agentName}]: ${m.content}` : m.content,
    }));
    messages.push({ role: "user", content: input.taskInstruction });
    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: this.apiKey, baseURL: "https://replit.com/ai/v1" });
      const response = await client.chat.completions.create({
        model: this.model,
        messages: [{ role: "system", content: systemPrompt }, ...messages.slice(-10)],
        max_tokens: 800,
        temperature: 0.7,
      });
      const text = response.choices[0]?.message?.content ?? "";
      const usage = response.usage;
      const cost = ((usage?.prompt_tokens ?? 0) / 1_000_000) * 0.10 + ((usage?.completion_tokens ?? 0) / 1_000_000) * 0.40;
      let suggestedNextTasks: string[] = [];
      let completionStatus: AgentTaskResult["completionStatus"] = "in_progress";
      let confidence = 0.7;
      let messageText = text;
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          suggestedNextTasks = parsed.suggestedNextTasks ?? [];
          completionStatus = parsed.completionStatus ?? "in_progress";
          confidence = parsed.confidence ?? 0.7;
          messageText = text.replace(/```json\n[\s\S]*?\n```/, "").trim();
        } catch { }
      }
      return { messageText, suggestedNextTasks, completionStatus, confidence, estimatedCost: cost };
    } catch (err) {
      logger.error({ err }, "Replit AI API call failed");
      throw err;
    }
  }
}

class ManusAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "manus";
  capabilities = ["research", "execution", "data_gathering", "analysis"];
  role: string;
  isMock = false;
  private apiKey: string;
  private model: string;
  constructor(id: string, name: string, role: string, apiKey: string, model?: string) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.apiKey = apiKey;
    this.model = model ?? process.env.MANUS_MODEL ?? "manus-deep-research-1";
  }
  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const systemPrompt = `You are ${this.name}, an AI agent with the role of ${this.role} in a multi-agent collaboration platform called BridgeAI.\n\nProject Goal: ${input.projectGoal}\n\nShared Memory Summary: ${input.memorySummary || "No previous context."}\n\nYour task: ${input.taskInstruction}\n\nRespond in character as your role. Be specific, actionable, and concise. At the end of your response, include a JSON block (surrounded by \`\`\`json ... \`\`\`) with this structure:\n{\n  "suggestedNextTasks": ["string"],\n  "completionStatus": "in_progress" | "complete" | "needs_review" | "approval_required",\n  "confidence": 0.0-1.0\n}`;
    const messages = input.previousMessages.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.agentName ? `[${m.agentName}]: ${m.content}` : m.content,
    }));
    messages.push({ role: "user", content: input.taskInstruction });
    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: this.apiKey, baseURL: "https://api.manus.im/v1" });
      const response = await client.chat.completions.create({
        model: this.model,
        messages: [{ role: "system", content: systemPrompt }, ...messages.slice(-10)],
        max_tokens: 800,
        temperature: 0.7,
      });
      const text = response.choices[0]?.message?.content ?? "";
      const usage = response.usage;
      const cost = ((usage?.prompt_tokens ?? 0) / 1_000_000) * 0.50 + ((usage?.completion_tokens ?? 0) / 1_000_000) * 2.00;
      let suggestedNextTasks: string[] = [];
      let completionStatus: AgentTaskResult["completionStatus"] = "in_progress";
      let confidence = 0.7;
      let messageText = text;
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          suggestedNextTasks = parsed.suggestedNextTasks ?? [];
          completionStatus = parsed.completionStatus ?? "in_progress";
          confidence = parsed.confidence ?? 0.7;
          messageText = text.replace(/```json\n[\s\S]*?\n```/, "").trim();
        } catch { }
      }
      return { messageText, suggestedNextTasks, completionStatus, confidence, estimatedCost: cost };
    } catch (err) {
      logger.error({ err }, "Manus API call failed");
      throw err;
    }
  }
}

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
  return new ChatGPTMockAdapter(String(agent.id), agent.name, agent.role);
}

export async function buildAdapter(agent: Agent): Promise<AgentAdapter> {
  const provider = agent.provider.toLowerCase();

  if (provider === "openai") {
    const apiKey = await getSetting("OPENAI_API_KEY") ?? process.env.OPENAI_API_KEY ?? "";
    if (isValidKey(apiKey)) {
      const model = await getSetting("OPENAI_MODEL") ?? undefined;
      return new OpenAIAdapter(String(agent.id), agent.name, agent.role, apiKey, model);
    }
    return new ChatGPTMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "anthropic") {
    const apiKey = await getSetting("ANTHROPIC_API_KEY") ?? process.env.ANTHROPIC_API_KEY ?? "";
    if (isValidKey(apiKey)) {
      const model = await getSetting("ANTHROPIC_MODEL") ?? undefined;
      return new AnthropicAdapter(String(agent.id), agent.name, agent.role, apiKey, model);
    }
    return new ClaudeMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "google") {
    const apiKey = await getSetting("GEMINI_API_KEY") ?? process.env.GEMINI_API_KEY ?? "";
    if (isValidKey(apiKey)) {
      const model = await getSetting("GEMINI_MODEL") ?? undefined;
      return new GeminiAdapter(String(agent.id), agent.name, agent.role, apiKey, model);
    }
    return new GeminiMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "perplexity") {
    const apiKey = await getSetting("PERPLEXITY_API_KEY") ?? process.env.PERPLEXITY_API_KEY ?? "";
    if (isValidKey(apiKey)) {
      const model = await getSetting("PERPLEXITY_MODEL") ?? undefined;
      return new PerplexityAdapter(String(agent.id), agent.name, agent.role, apiKey, model);
    }
    return new PerplexityMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "replit") {
    const apiKey = await getSetting("REPLIT_API_KEY") ?? process.env.REPLIT_API_KEY ?? "";
    if (isValidKey(apiKey)) {
      return new ReplitAdapter(String(agent.id), agent.name, agent.role, apiKey);
    }
    return new ReplitMockAdapter(String(agent.id), agent.name, agent.role);
  }

  if (provider === "manus") {
    const apiKey = await getSetting("MANUS_API_KEY") ?? process.env.MANUS_API_KEY ?? "";
    if (isValidKey(apiKey)) {
      return new ManusAdapter(String(agent.id), agent.name, agent.role, apiKey);
    }
    return new ManusMockAdapter(String(agent.id), agent.name, agent.role);
  }

  return new ChatGPTMockAdapter(String(agent.id), agent.name, agent.role);
}
