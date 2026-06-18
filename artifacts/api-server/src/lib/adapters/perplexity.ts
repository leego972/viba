import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "./interface";
import { logger } from "../logger";
import { buildAdapterJsonSchema, parseAdapterJson } from "./shared";

export class PerplexityAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "perplexity";
  capabilities = ["research_summary", "fact_checking", "citation", "web_search"];
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
    this.model = model ?? process.env.PERPLEXITY_MODEL ?? "sonar";
    this.canUseTools = canUseTools;
  }

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const systemPrompt = `You are ${this.name}, an AI agent with the role of ${this.role} in a multi-agent collaboration platform called VIBA - Collaborative Multi-Agent Orchestration System.

Project Goal: ${input.projectGoal}

Shared Memory Summary: ${input.memorySummary || "No previous context."}

Your task: ${input.taskInstruction}
${buildAdapterJsonSchema(this.canUseTools, input.pendingQuestions)}`;

    const messages = input.previousMessages.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.agentName ? `[${m.agentName}]: ${m.content}` : m.content,
    }));

    messages.push({ role: "user", content: input.taskInstruction });

    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: "https://api.perplexity.ai",
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
      const inputCost = ((usage?.prompt_tokens ?? 0) / 1_000_000) * 1.00;
      const outputCost = ((usage?.completion_tokens ?? 0) / 1_000_000) * 1.00;
      const cost = inputCost + outputCost;

      return parseAdapterJson(text, cost);
    } catch (err) {
      logger.error({ err }, "Perplexity API call failed");
      throw err;
    }
  }

  async evaluateTask(goal: string, peers: Array<{ name: string; role: string }>): Promise<{ accepted: boolean; reason?: string }> {
    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: this.apiKey, baseURL: "https://api.perplexity.ai", timeout: 10_000 });
      const peerList = peers.map((p) => `${p.name} (${p.role})`).join(", ") || "none";
      const response = await client.chat.completions.create({
        model: this.model,
        max_tokens: 120,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `You are a safety evaluator. Reply ONLY with a JSON object: {"accepted": true} or {"accepted": false, "reason": "one sentence"}.`,
          },
          {
            role: "user",
            content: `Evaluate this project goal for safety compliance: "${goal}"\nOther agents: ${peerList}`,
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
      logger.warn({ err }, "PerplexityAdapter.evaluateTask failed — defaulting to accept");
    }
    return { accepted: true };
  }
}
