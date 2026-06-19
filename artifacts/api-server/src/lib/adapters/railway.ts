import type { AgentAdapter, AgentTaskInput, AgentTaskResult, ToolOutput } from "./interface";
import { getRailwayMcpClient, mcpToolsToOpenAiFunctions } from "../railwayMcp";
import { buildAdapterJsonSchema, parseAdapterJson } from "./shared";
import { logger } from "../logger";

const MAX_TOOL_ROUNDS = 6;

/**
 * RailwayAdapter — tool-capable agent that controls Railway deployments.
 *
 * Execution path:
 *   1. Connect to Railway MCP (https://railway.com/mcp) with RAILWAY_TOKEN.
 *   2. Discover available Railway tools via MCP tools/list.
 *   3. Use OpenAI function calling (gpt-4.1-mini) to reason about which
 *      Railway tools to invoke for the given task.
 *   4. Execute tool calls via Railway MCP in an agentic loop (up to 6 rounds).
 *   5. Summarise results and return structured ToolOutputs.
 *
 * Falls back to LLM-only mode (no Railway execution) if RAILWAY_TOKEN is
 * missing or if the OpenAI reasoning key is unavailable.
 */
export class RailwayAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "railway";
  capabilities = ["deployment", "infrastructure", "monitoring", "environment_management", "rollback"];
  role: string;
  isMock = false;
  canUseTools = true;
  model: string;

  private railwayToken: string;
  private reasoningApiKey: string;

  constructor(
    id: string,
    name: string,
    role: string,
    railwayToken: string,
    reasoningApiKey: string,
    model?: string,
  ) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.railwayToken = railwayToken;
    this.reasoningApiKey = reasoningApiKey;
    this.model = model ?? "gpt-4.1-mini";
  }

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const mcpClient = getRailwayMcpClient(this.railwayToken);

    // ── Real execution: Railway MCP + OpenAI function calling ─────────────────
    if (mcpClient && this.reasoningApiKey) {
      try {
        return await this.runWithRailwayMcp(mcpClient, input);
      } catch (err) {
        logger.warn({ err }, "RailwayAdapter: MCP execution failed — falling back to LLM-only");
      }
    }

    // ── Fallback: LLM-only (no Railway execution) ──────────────────────────
    logger.warn(
      { hasToken: !!mcpClient, hasKey: !!this.reasoningApiKey },
      "RailwayAdapter: running in LLM-only mode (no Railway execution)",
    );
    return this.runLlmOnly(input);
  }

  private async runWithRailwayMcp(
    mcpClient: Awaited<ReturnType<typeof getRailwayMcpClient>>,
    input: AgentTaskInput,
  ): Promise<AgentTaskResult> {
    if (!mcpClient) throw new Error("No Railway MCP client");

    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: this.reasoningApiKey, timeout: 30_000 });

    const railwayTools = await mcpClient.listTools();
    const functions = mcpToolsToOpenAiFunctions(railwayTools);

    const systemPrompt = `You are ${this.name}, a Railway deployment agent with the role of ${this.role} inside VIBA — Collaborative Multi-Agent Orchestration System.

You have full access to Railway via MCP tools. Use them to accomplish the task.

Project Goal: ${input.projectGoal}
Shared Memory: ${input.memorySummary || "No previous context."}
Task: ${input.taskInstruction}

Guidelines:
- Use Railway tools to perform actual operations (deploy, rollback, get logs, set env vars, etc.).
- Be precise: check project/service lists before acting if IDs are needed.
- After completing all Railway operations, summarise exactly what was done and what the outcome is.
- If a tool returns an error, diagnose and retry with corrected parameters or report the blocker clearly.`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: input.taskInstruction },
    ];

    const collectedToolOutputs: ToolOutput[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await openai.chat.completions.create({
        model: this.model,
        messages,
        tools: functions.length > 0 ? functions : undefined,
        tool_choice: functions.length > 0 ? "auto" : undefined,
        max_tokens: 2048,
        temperature: 0.2,
      });

      const usage = response.usage;
      totalInputTokens += usage?.prompt_tokens ?? 0;
      totalOutputTokens += usage?.completion_tokens ?? 0;

      const choice = response.choices[0];
      const msg = choice?.message;

      if (!msg) break;

      messages.push({
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: msg.tool_calls,
      });

      // No more tool calls — done
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const finalText = msg.content ?? "Railway operations completed.";
        const inputCost = (totalInputTokens / 1_000_000) * 0.40;
        const outputCost = (totalOutputTokens / 1_000_000) * 1.60;

        const result = parseAdapterJson(finalText, inputCost + outputCost);
        result.toolOutputs = collectedToolOutputs;
        return result;
      }

      // Execute all tool calls in this round
      for (const tc of msg.tool_calls) {
        if (tc.type !== "function") continue;
        const toolName = tc.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          // keep empty args
        }

        input.onPollCycle?.({
          attempt: round,
          maxAttempts: MAX_TOOL_ROUNDS,
          status: `calling ${toolName}`,
          elapsedMs: 0,
        });

        const toolResult = await mcpClient.callTool(toolName, args);
        const resultText = toolResult.content.map((c) => c.text).join("\n");

        // Collect as ToolOutput for the session feed
        collectedToolOutputs.push({
          type: "command_output",
          title: `Railway: ${toolName}`,
          content: resultText,
          metadata: { tool: toolName, args, isError: toolResult.isError ?? false },
        });

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: toolName,
          content: resultText,
        });
      }
    }

    // Ran out of rounds — summarise what we have
    const inputCost = (totalInputTokens / 1_000_000) * 0.40;
    const outputCost = (totalOutputTokens / 1_000_000) * 1.60;
    const summaryText = collectedToolOutputs.length > 0
      ? `⚠️ Reached Railway tool call limit (${MAX_TOOL_ROUNDS} rounds). Partial work:\n\n${collectedToolOutputs.map((o) => `**${o.title}**\n${o.content}`).join("\n\n")}`
      : "Railway operations completed (no tool output available).";

    return {
      messageText: summaryText,
      suggestedNextTasks: [],
      completionStatus: "in_progress",
      confidence: 0.6,
      estimatedCost: inputCost + outputCost,
      toolOutputs: collectedToolOutputs,
    };
  }

  private async runLlmOnly(input: AgentTaskInput): Promise<AgentTaskResult> {
    const systemPrompt = `You are ${this.name}, a Railway deployment specialist with the role of ${this.role} in VIBA — Collaborative Multi-Agent Orchestration System.

Note: Railway MCP is not connected (RAILWAY_TOKEN not configured). You are operating in advisory mode — provide deployment plans and configurations but cannot execute real Railway operations.

Project Goal: ${input.projectGoal}
Shared Memory: ${input.memorySummary || "No previous context."}
Task: ${input.taskInstruction}
${buildAdapterJsonSchema(false, input.pendingQuestions)}`;

    const messages = input.previousMessages.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.agentName ? `[${m.agentName}]: ${m.content}` : m.content,
    }));
    messages.push({ role: "user", content: input.taskInstruction });

    if (!this.reasoningApiKey) {
      return {
        messageText:
          "Railway agent is in simulation mode. Neither RAILWAY_TOKEN nor a reasoning API key (OPENAI_API_KEY / ANTHROPIC_API_KEY) is configured. Add RAILWAY_TOKEN in the admin settings to enable real Railway control.",
        suggestedNextTasks: [],
        completionStatus: "needs_review",
        confidence: 0.3,
        estimatedCost: 0,
      };
    }

    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: this.reasoningApiKey, timeout: 30_000 });
    const response = await client.chat.completions.create({
      model: this.model,
      messages: [{ role: "system", content: systemPrompt }, ...messages.slice(-15)],
      max_tokens: 2048,
      temperature: 0.7,
    });
    const text = response.choices[0]?.message?.content ?? "";
    const usage = response.usage;
    const cost = ((usage?.prompt_tokens ?? 0) / 1_000_000) * 0.40 + ((usage?.completion_tokens ?? 0) / 1_000_000) * 1.60;
    return parseAdapterJson(text, cost);
  }

  async evaluateTask(
    goal: string,
    _peers: Array<{ name: string; role: string }>,
  ): Promise<{ accepted: boolean; reason?: string }> {
    const HARMFUL =
      /\b(malware|ransomware|ddos|delete\s+all\s+(?:data|services|projects)|wipe\s+(?:all\s+)?(?:production|prod)\s+(?:services|data|projects))\b/i;
    if (HARMFUL.test(goal)) {
      return {
        accepted: false,
        reason:
          "This goal involves potentially destructive Railway operations that could cause irreversible data or service loss. I will not execute it.",
      };
    }
    return { accepted: true };
  }
}
