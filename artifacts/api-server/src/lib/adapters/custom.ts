import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "./interface";
import { logger } from "../logger";
import { buildAdapterJsonSchema, parseAdapterJson } from "./shared";

export class CustomAIAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "custom";
  capabilities = ["planning", "reasoning", "build", "research", "code_review"];
  role: string;
  isMock = false;
  canUseTools: boolean;

  private apiKey: string;
  model: string;
  private baseURL: string;

  constructor(
    id: string,
    name: string,
    role: string,
    apiKey: string,
    model?: string,
    canUseTools = false,
    baseURL?: string,
  ) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.apiKey = apiKey;
    this.model = model ?? process.env["CUSTOM_MODEL"] ?? "default";
    this.baseURL = (baseURL ?? process.env["CUSTOM_ENDPOINT"] ?? "").replace(/\/$/, "");
    this.canUseTools = canUseTools;
  }

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    if (!this.baseURL) {
      throw new Error("Custom AI endpoint URL is not configured. Set CUSTOM_ENDPOINT in settings.");
    }

    const systemPrompt = `You are ${this.name}, an AI agent with the role of ${this.role} in a multi-agent collaboration platform called VIBA - Collaborative Multi-Agent Orchestration System.

Project Goal: ${input.projectGoal}

Shared Memory Summary: ${input.memorySummary || "No previous context."}

Your task: ${input.taskInstruction}
${buildAdapterJsonSchema(this.canUseTools, input.pendingQuestions, this.canUseTools)}`;

    const messages = input.previousMessages.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.agentName ? `[${m.agentName}]: ${m.content}` : m.content,
    }));

    messages.push({ role: "user", content: input.taskInstruction });

    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({
        apiKey: this.apiKey || "no-key",
        baseURL: this.baseURL,
        timeout: 60_000,
      });

      const response = await client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.slice(-15),
        ],
        max_tokens: 2048,
        temperature: 0.7,
      });

      const text = response.choices[0]?.message?.content ?? "";
      const usage = response.usage;
      const inputCost = ((usage?.prompt_tokens ?? 0) / 1_000_000) * 0.10;
      const outputCost = ((usage?.completion_tokens ?? 0) / 1_000_000) * 0.30;
      const cost = inputCost + outputCost;

      return parseAdapterJson(text, cost);
    } catch (err) {
      logger.error({ err }, "Custom AI API call failed");
      throw err;
    }
  }

  async evaluateTask(goal: string, peers: Array<{ name: string; role: string }>): Promise<{ accepted: boolean; reason?: string }> {
    if (!this.baseURL) return { accepted: true };
    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: this.apiKey || "no-key", baseURL: this.baseURL, timeout: 10_000 });
      const peerList = peers.map((p) => `${p.name} (${p.role})`).join(", ") || "none";
      const response = await client.chat.completions.create({
        model: this.model,
        max_tokens: 120,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `You are ${this.name} (${this.role}). Evaluate whether you should accept this task.`,
          },
          {
            role: "user",
            content: `Goal: ${goal}\nTeam: ${peerList}\nYour role: ${this.role}\nReply with JSON: {"accepted": true/false, "reason": "..."}`,
          },
        ],
      });
      const raw = response.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { accepted?: boolean; reason?: string };
      return { accepted: parsed.accepted !== false, reason: parsed.reason };
    } catch {
      return { accepted: true };
    }
  }
}
