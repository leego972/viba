import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "./interface";
import { logger } from "../logger";

export class ManusAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "manus";
  capabilities = ["research", "execution", "data_gathering", "analysis"];
  role: string;
  isMock = false;
  canUseTools = true;

  private apiKey: string;
  model: string;

  constructor(id: string, name: string, role: string, apiKey: string, model?: string) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.apiKey = apiKey;
    this.model = model ?? process.env["MANUS_MODEL"] ?? "manus-deep-research-1";
  }

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const workspaceBlock = input.repoUrl
      ? `\nWorkspace context:\n- Repo: ${input.repoUrl}\n- Branch: ${input.repoBranch ?? "main"}\n- Environment: ${input.workspaceEnv ?? "development"}\n`
      : "";

    const questionsBlock = ( input.pendingQuestions ?? []).length > 0
      ? `\nQuestions from other agents you must answer FIRST (task-scoped only):\n${(input.pendingQuestions ?? []).map((q, i) => `${i + 1}. [from ${q.fromAgent}] ${q.question}`).join("\n")}\n`
      : "";

    const systemPrompt = `You are ${this.name}, a tool-capable AI agent with the role of ${this.role} in VIBA — Collaborative Multi-Agent Orchestration System.

You CAN use tools: browse the web, run code, gather data, call external APIs, and execute multi-step research workflows. You are trusted to take real action on behalf of the team.

Project Goal: ${input.projectGoal}
${workspaceBlock}
Shared Memory Summary: ${input.memorySummary || "No previous context."}
${questionsBlock}
Your task: ${input.taskInstruction}

Instructions:
- If there are questions above from other agents, answer each one concisely in your JSON block (answersToQuestions).
- Complete the task fully using your capabilities.
- If you need input from a specific agent, add to outboundQuestions (max 3, strictly task-related).
- Be specific and cite sources or findings when relevant.

At the end of your response, include a JSON block (surrounded by \`\`\`json ... \`\`\`) with this structure:
{
  "suggestedNextTasks": ["string"],
  "completionStatus": "in_progress" | "complete" | "needs_review" | "approval_required",
  "confidence": 0.0-1.0,
  "outboundQuestions": [{"toAgentName": "...", "question": "..."}],
  "answersToQuestions": [{"messageId": 0, "answer": "..."}]
}`;

    const messages = input.previousMessages.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.agentName ? `[${m.agentName}]: ${m.content}` : m.content,
    }));

    messages.push({ role: "user", content: input.taskInstruction });

    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: "https://api.manus.im/v1",
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
      const inputCost = ((usage?.prompt_tokens ?? 0) / 1_000_000) * 0.50;
      const outputCost = ((usage?.completion_tokens ?? 0) / 1_000_000) * 2.00;
      const cost = inputCost + outputCost;

      let suggestedNextTasks: string[] = [];
      let completionStatus: AgentTaskResult["completionStatus"] = "in_progress";
      let confidence = 0.7;
      let outboundQuestions: AgentTaskResult["outboundQuestions"] = [];
      let answersToQuestions: AgentTaskResult["answersToQuestions"] = [];
      let messageText = text;

      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch?.[1]) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          suggestedNextTasks = parsed.suggestedNextTasks ?? [];
          completionStatus = parsed.completionStatus ?? "in_progress";
          confidence = parsed.confidence ?? 0.7;
          outboundQuestions = (parsed.outboundQuestions ?? []).slice(0, 3);
          answersToQuestions = parsed.answersToQuestions ?? [];
          messageText = text.replace(/```json\n[\s\S]*?\n```/, "").trim();
        } catch {
          // ignore parse errors
        }
      }

      return { messageText, suggestedNextTasks, completionStatus, confidence, estimatedCost: cost, outboundQuestions, answersToQuestions };
    } catch (err) {
      logger.error({ err }, "Manus API call failed");
      throw err;
    }
  }
}
