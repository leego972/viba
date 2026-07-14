import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "./interface";
import { logger } from "../logger";
import { buildAdapterJsonSchema, parseAdapterJson } from "./shared";

export class AnthropicAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "anthropic";
  capabilities = ["code_review", "writing", "logic_critique", "ux_review"];
  role: string;
  isMock = false;
  canUseTools: boolean;

  private apiKey: string;
  model: string;

  constructor(id: string, name: string, role: string, apiKey: string, model?: string, canUseTools = false) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.apiKey = apiKey;
    this.model = model ?? process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-20241022";
    this.canUseTools = canUseTools;
  }

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
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
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: this.apiKey, timeout: 30_000 });

      const response = await client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: messages.slice(-15),
      });

      const block = response.content[0];
      const text = block?.type === "text" ? block.text : "";

      const inputCost = ((response.usage?.input_tokens ?? 0) / 1_000_000) * 0.80;
      const outputCost = ((response.usage?.output_tokens ?? 0) / 1_000_000) * 4.00;
      const cost = inputCost + outputCost;

      return parseAdapterJson(text, cost);
    } catch (err) {
      logger.error({ err }, "Anthropic API call failed");
      throw err;
    }
  }

  async evaluateTask(goal: string, peers: Array<{ name: string; role: string }>): Promise<{ accepted: boolean; reason?: string }> {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: this.apiKey, timeout: 10_000 });
      const peerList = peers.map((p) => `${p.name} (${p.role})`).join(", ") || "none";
      const prompt = `You are a safety evaluator for VIBA, a multi-agent AI orchestration system. Before execution begins, each agent votes on whether the project goal is acceptable.

Project goal: "${goal}"
Other agents: ${peerList}

Evaluate the goal against your usage policies and ethical guidelines.
Reply ONLY with a JSON object — no other text:
{"accepted": true} to participate, or {"accepted": false, "reason": "one sentence"} to decline.`;

      const response = await client.messages.create({
        model: this.model,
        max_tokens: 120,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content[0]?.type === "text" ? response.content[0].text : "";
      const match = text.match(/\{[\s\S]*?\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as { accepted?: boolean; reason?: string };
        return {
          accepted: parsed.accepted !== false,
          reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        };
      }
    } catch (err) {
      logger.warn({ err }, "AnthropicAdapter.evaluateTask failed — defaulting to accept");
    }
    return { accepted: true };
  }
}
