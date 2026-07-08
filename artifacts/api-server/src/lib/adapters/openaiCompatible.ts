import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "./interface";
import { logger } from "../logger";
import { buildAdapterJsonSchema, parseAdapterJson } from "./shared";

export class OpenAICompatibleAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider: string;
  capabilities = ["planning", "reasoning", "creative_direction", "code_review", "final_qa"];
  role: string;
  isMock = false;
  canUseTools: boolean;
  model: string;

  private apiKey: string;
  private baseURL: string;

  constructor(
    id: string,
    name: string,
    role: string,
    provider: string,
    apiKey: string,
    baseURL: string,
    model?: string,
    canUseTools = false,
  ) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.provider = provider;
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.model = model || "default";
    this.canUseTools = canUseTools;
  }

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const systemPrompt = `You are ${this.name}, an AI agent with the role of ${this.role} in VIBA, a collaborative multi-agent orchestration system.

Project Goal: ${input.projectGoal}

Shared Memory Summary: ${input.memorySummary || "No previous context."}

Your task: ${input.taskInstruction}
${buildAdapterJsonSchema(this.canUseTools, input.pendingQuestions)}`;

    const messages = input.previousMessages.map((message) => ({
      role: (message.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: message.agentName ? `[${message.agentName}]: ${message.content}` : message.content,
    }));

    messages.push({ role: "user", content: input.taskInstruction });

    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseURL, timeout: 30_000 });

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
      return parseAdapterJson(text, 0);
    } catch (err) {
      logger.error({ err, provider: this.provider, baseURL: this.baseURL }, "OpenAI-compatible API call failed");
      throw err;
    }
  }

  async evaluateTask(goal: string, peers: Array<{ name: string; role: string }>): Promise<{ accepted: boolean; reason?: string }> {
    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseURL, timeout: 10_000 });
      const peerList = peers.map((peer) => `${peer.name} (${peer.role})`).join(", ") || "none";
      const response = await client.chat.completions.create({
        model: this.model,
        max_tokens: 120,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `You are a safety evaluator for VIBA, a multi-agent AI orchestration system. Evaluate project goals for policy compliance. Reply ONLY with a JSON object: {"accepted": true} or {"accepted": false, "reason": "one sentence"}.`,
          },
          {
            role: "user",
            content: `Project goal: "${goal}"\nOther agents: ${peerList}\n\nDo you accept this goal?`,
          },
        ],
      });
      const text = response.choices[0]?.message?.content ?? "";
      const match = text.match(/\{[\s\S]*?\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as { accepted?: boolean; reason?: string };
        return {
          accepted: parsed.accepted !== false,
          reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        };
      }
    } catch (err) {
      logger.warn({ err, provider: this.provider }, "OpenAICompatibleAdapter.evaluateTask failed — defaulting to accept");
    }
    return { accepted: true };
  }
}
