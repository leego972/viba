import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "./interface";
import { logger } from "../logger";

export class OpenAIAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "openai";
  capabilities = ["planning", "reasoning", "creative_direction", "code_review", "final_qa"];
  role: string;
  isMock = false;
  canUseTools = false;

  private apiKey: string;
  model: string;

  constructor(id: string, name: string, role: string, apiKey: string, model?: string) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.apiKey = apiKey;
    this.model = model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  }

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const systemPrompt = `You are ${this.name}, an AI agent with the role of ${this.role} in a multi-agent collaboration platform called VIBA - Collaborative Multi-Agent Orchestration System.

Project Goal: ${input.projectGoal}

Shared Memory Summary: ${input.memorySummary || "No previous context."}

Your task: ${input.taskInstruction}

Respond in character as your role. Be specific, actionable, and concise. At the end of your response, include a JSON block (surrounded by \`\`\`json ... \`\`\`) with this structure:
{
  "suggestedNextTasks": ["string"],
  "completionStatus": "in_progress" | "complete" | "needs_review" | "approval_required",
  "confidence": 0.0-1.0
}`;

    const messages = input.previousMessages.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.agentName ? `[${m.agentName}]: ${m.content}` : m.content,
    }));

    messages.push({ role: "user", content: input.taskInstruction });

    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: this.apiKey, timeout: 30_000 });

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
      const inputCost = ((usage?.prompt_tokens ?? 0) / 1_000_000) * 0.15;
      const outputCost = ((usage?.completion_tokens ?? 0) / 1_000_000) * 0.60;
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
        } catch {
          // ignore parse errors
        }
      }

      return { messageText, suggestedNextTasks, completionStatus, confidence, estimatedCost: cost };
    } catch (err) {
      logger.error({ err }, "OpenAI API call failed");
      throw err;
    }
  }
}
