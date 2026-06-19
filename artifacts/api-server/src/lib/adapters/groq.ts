import type { AgentAdapter, AgentTaskInput, AgentTaskResult, ToolOutput } from "./interface";
import { getRailwayMcpClient, mcpToolsToOpenAiFunctions } from "../railwayMcp";
import { buildAdapterJsonSchema, parseAdapterJson } from "./shared";
import { getToolDefinitions, executeTool, type ToolContext } from "../tools/registry";
import { logger } from "../logger";

const MAX_TOOL_ROUNDS = 8;

/**
 * GroqAdapter — free, tool-capable agent backed by Groq's inference API.
 *
 * Free API at console.groq.com — no credit card required.
 * Default model: llama-3.3-70b-versatile (full function/tool calling support).
 *
 * Available tools:
 *   - Railway MCP tools (deploy, rollback, logs, env vars, scale) — when RAILWAY_TOKEN set
 *   - GitHub tools (repos, files, branches, PRs, issues) — when GITHUB_TOKEN set
 *   - Web tools (fetch URL, npm search, npm package info) — always available
 */
export class GroqAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "groq";
  capabilities = ["planning", "reasoning", "code_review", "build", "implementation", "research", "deployment", "infrastructure"];
  role: string;
  isMock = false;
  canUseTools: boolean;
  model: string;

  private apiKey: string;
  private railwayToken: string | null;
  private githubToken: string | null;

  constructor(
    id: string,
    name: string,
    role: string,
    apiKey: string,
    model?: string,
    canUseTools = true,
    railwayToken?: string,
    githubToken?: string,
  ) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.apiKey = apiKey;
    this.model = model ?? process.env["GROQ_MODEL"] ?? "llama-3.3-70b-versatile";
    this.canUseTools = canUseTools;
    this.railwayToken = railwayToken ?? process.env["RAILWAY_TOKEN"] ?? null;
    this.githubToken = githubToken ?? process.env["GITHUB_TOKEN"] ?? null;
  }

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const { default: OpenAI } = await import("openai");
    const groq = new OpenAI({
      apiKey: this.apiKey,
      baseURL: "https://api.groq.com/openai/v1",
      timeout: 45_000,
    });

    const toolCtx: ToolContext = { githubToken: this.githubToken ?? undefined };

    // ── Collect all available tools ──────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const functions: any[] = [];
    const mcpClient = this.railwayToken ? getRailwayMcpClient(this.railwayToken) : null;

    if (this.canUseTools) {
      // Registry tools (GitHub + web) — always try
      const registryDefs = getToolDefinitions(toolCtx);
      functions.push(...registryDefs);

      // Railway MCP tools
      if (mcpClient) {
        try {
          const railwayTools = await mcpClient.listTools();
          functions.push(...mcpToolsToOpenAiFunctions(railwayTools));
          logger.info({ count: railwayTools.length }, "GroqAdapter: Railway MCP tools loaded");
        } catch (err) {
          logger.warn({ err }, "GroqAdapter: failed to load Railway MCP tools — running without them");
        }
      }

      logger.info({ total: functions.length, github: !!this.githubToken, railway: !!mcpClient }, "GroqAdapter: tools loaded");
    }

    // ── System prompt ─────────────────────────────────────────────────────────
    const toolNames = functions.map((f: { function: { name: string } }) => f.function.name);
    const systemPrompt = `You are ${this.name}, an AI agent with the role of ${this.role} in VIBA — Collaborative Multi-Agent Orchestration System.

Project Goal: ${input.projectGoal}
Shared Memory: ${input.memorySummary || "No previous context."}
Task: ${input.taskInstruction}
${functions.length > 0
  ? `\nYou have ${functions.length} tools available: ${toolNames.join(", ")}.\n\nTool guidance:\n- Use web_fetch to read documentation pages, GitHub READMEs, or any URL\n- Use npm_search / npm_package_info to find and evaluate packages\n- Use github_* tools to create repos, read/write files, open PRs, manage issues\n- Use railway_* tools to deploy services, view logs, manage environment variables\n\nCall tools as needed to complete the task. After all operations, summarise clearly what was done and what the outcomes were.`
  : buildAdapterJsonSchema(this.canUseTools, input.pendingQuestions)}`;

    const historyMessages = input.previousMessages.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.agentName ? `[${m.agentName}]: ${m.content}` : m.content,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [
      { role: "system", content: systemPrompt },
      ...historyMessages.slice(-12),
      { role: "user", content: input.taskInstruction },
    ];

    if (functions.length > 0) {
      return await this.runWithTools(groq, messages, functions, mcpClient, toolCtx, input);
    }
    return await this.runPlainChat(groq, messages, input);
  }

  private async runWithTools(
    groq: InstanceType<Awaited<typeof import("openai")>["default"]>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    functions: any[],
    mcpClient: ReturnType<typeof getRailwayMcpClient> | null,
    toolCtx: ToolContext,
    input: AgentTaskInput,
  ): Promise<AgentTaskResult> {
    const collectedToolOutputs: ToolOutput[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await groq.chat.completions.create({
        model: this.model,
        messages,
        tools: functions,
        tool_choice: "auto",
        max_tokens: 2048,
        temperature: 0.2,
      });

      const usage = response.usage;
      totalInputTokens += usage?.prompt_tokens ?? 0;
      totalOutputTokens += usage?.completion_tokens ?? 0;

      const choice = response.choices[0];
      const msg = choice?.message;
      if (!msg) break;

      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const finalText = msg.content ?? "Operations completed.";
        const cost = this.calcCost(totalInputTokens, totalOutputTokens);
        const result = parseAdapterJson(finalText, cost);
        result.toolOutputs = collectedToolOutputs;
        return result;
      }

      for (const tc of msg.tool_calls) {
        if (tc.type !== "function") continue;
        const toolName = tc.function.name;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* keep empty */ }

        input.onPollCycle?.({ attempt: round, maxAttempts: MAX_TOOL_ROUNDS, status: `calling ${toolName}`, elapsedMs: 0 });

        let resultText = "";
        let isError = false;

        // Try registry tools first, then Railway MCP
        const registryToolNames = getToolDefinitions(toolCtx).map((d) => d.function.name);
        if (registryToolNames.includes(toolName)) {
          const res = await executeTool(toolName, args, toolCtx);
          resultText = res.result;
          isError = res.isError;
        } else if (mcpClient) {
          try {
            const toolResult = await mcpClient.callTool(toolName, args);
            resultText = toolResult.content.map((c) => c.text).join("\n");
            isError = toolResult.isError ?? false;
          } catch (err) {
            resultText = `Railway tool "${toolName}" failed: ${err instanceof Error ? err.message : String(err)}`;
            isError = true;
          }
        } else {
          resultText = `Tool "${toolName}" is not available — no executor found.`;
          isError = true;
        }

        collectedToolOutputs.push({
          type: "command_output",
          title: toolName,
          content: resultText,
          metadata: { tool: toolName, args, isError },
        });

        messages.push({ role: "tool", tool_call_id: tc.id, name: toolName, content: resultText });
        logger.info({ tool: toolName, isError }, "GroqAdapter: tool call complete");
      }
    }

    const cost = this.calcCost(totalInputTokens, totalOutputTokens);
    const summaryText = collectedToolOutputs.length > 0
      ? `⚠️ Reached tool call limit (${MAX_TOOL_ROUNDS} rounds). Partial work:\n\n${collectedToolOutputs.map((o) => `**${o.title}**\n${o.content}`).join("\n\n")}`
      : "Operations completed (no tool output captured).";

    return {
      messageText: summaryText,
      suggestedNextTasks: [],
      completionStatus: "in_progress",
      confidence: 0.6,
      estimatedCost: cost,
      toolOutputs: collectedToolOutputs,
    };
  }

  private async runPlainChat(
    groq: InstanceType<Awaited<typeof import("openai")>["default"]>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: any[],
    _input: AgentTaskInput,
  ): Promise<AgentTaskResult> {
    const response = await groq.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: 2048,
      temperature: 0.7,
    });
    const text = response.choices[0]?.message?.content ?? "";
    const usage = response.usage;
    return parseAdapterJson(text, this.calcCost(usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0));
  }

  /** Groq pricing (llama-3.3-70b-versatile): $0.59/M input, $0.79/M output */
  private calcCost(inputTokens: number, outputTokens: number): number {
    return (inputTokens / 1_000_000) * 0.59 + (outputTokens / 1_000_000) * 0.79;
  }

  async evaluateTask(goal: string, _peers: Array<{ name: string; role: string }>): Promise<{ accepted: boolean; reason?: string }> {
    const HARMFUL = /\b(malware|ransomware|ddos|phishing|csam|bioweapon|terrorism\s+plot)\b/i;
    if (HARMFUL.test(goal)) {
      return { accepted: false, reason: "This goal conflicts with my operational safety constraints." };
    }
    return { accepted: true };
  }
}
