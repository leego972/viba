import type { AgentAdapter, AgentTaskInput, AgentTaskResult, ToolOutput } from "./interface";
import { buildAdapterJsonSchema, parseAdapterJson } from "./shared";
import { getToolDefinitions, executeTool, type ToolContext } from "../tools/registry";
import { logger } from "../logger";

const MAX_TOOL_ROUNDS = 8;

/**
 * OllamaAdapter — runs fully local open-source models via Ollama.
 *
 * Ollama is 100% free. No API key, no cloud calls, no cost per token.
 * Users install Ollama from https://ollama.com, pull a model, and point
 * OLLAMA_BASE_URL at it (defaults to http://localhost:11434).
 *
 * Tool-calling is supported on these models (pull with `ollama pull <name>`):
 *   - llama3.1:8b       ← recommended for tools
 *   - qwen2.5:7b        ← excellent coder + tool calling
 *   - mistral:7b        ← solid all-rounder
 *   - llama3.2          (3B — fast but limited tool calling)
 *   - deepseek-r1:8b    ← strong reasoning
 *
 * Available tools (same registry as Groq):
 *   - GitHub tools (repos, files, branches, PRs, issues) — when GITHUB_TOKEN set
 *   - Web tools (fetch URL, npm search, npm package info) — always available
 *
 * Falls back gracefully to plain chat if the model doesn't support tool calling.
 */
export class OllamaAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "ollama";
  capabilities = ["planning", "reasoning", "code_review", "build", "implementation", "research"];
  role: string;
  isMock = false;
  canUseTools: boolean;
  model: string;

  private baseUrl: string;
  private githubToken: string | null;

  constructor(
    id: string,
    name: string,
    role: string,
    model?: string,
    baseUrl?: string,
    canUseTools = true,
    githubToken?: string,
  ) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.model = model ?? process.env["OLLAMA_MODEL"] ?? "llama3.2";
    this.baseUrl = (baseUrl ?? process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434").replace(/\/$/, "");
    this.canUseTools = canUseTools;
    this.githubToken = githubToken ?? process.env["GITHUB_TOKEN"] ?? null;
  }

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({
      apiKey: "ollama",
      baseURL: `${this.baseUrl}/v1`,
      timeout: 120_000,
    });

    const toolCtx: ToolContext = { githubToken: this.githubToken ?? undefined };
    const functions = this.canUseTools ? getToolDefinitions(toolCtx) : [];

    const toolNames = functions.map((f) => f.function.name);
    const systemPrompt = `You are ${this.name}, an AI agent with the role of ${this.role} in VIBA — Collaborative Multi-Agent Orchestration System.

Project Goal: ${input.projectGoal}

Shared Memory Summary: ${input.memorySummary || "No previous context."}

Your task: ${input.taskInstruction}
${functions.length > 0
  ? `\nYou have ${functions.length} tools available: ${toolNames.join(", ")}.\n\nTool guidance:\n- Use web_fetch to read documentation, README files, or any public URL\n- Use npm_search / npm_package_info to research packages\n- Use github_* tools to create repos, read/write files, open PRs, manage issues\n\nCall tools as needed to complete the task. Summarise what was done after all operations.`
  : buildAdapterJsonSchema(this.canUseTools, input.pendingQuestions)}`;

    const historyMessages = input.previousMessages.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.agentName ? `[${m.agentName}]: ${m.content}` : m.content,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [
      { role: "system", content: systemPrompt },
      ...historyMessages.slice(-15),
      { role: "user", content: input.taskInstruction },
    ];

    if (functions.length > 0) {
      return await this.runWithTools(client, messages, functions, toolCtx, input);
    }
    return await this.runPlainChat(client, messages);
  }

  private async runWithTools(
    client: InstanceType<Awaited<typeof import("openai")>["default"]>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    functions: any[],
    toolCtx: ToolContext,
    input: AgentTaskInput,
  ): Promise<AgentTaskResult> {
    const collectedToolOutputs: ToolOutput[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let response;
      try {
        response = await client.chat.completions.create({
          model: this.model,
          messages,
          tools: functions,
          tool_choice: "auto",
          max_tokens: 2048,
          temperature: 0.3,
        });
      } catch (err) {
        // Some Ollama models don't support function calling — fall back to plain chat
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("does not support tools") || errMsg.includes("tool") || round === 0) {
          logger.warn({ model: this.model, err: errMsg }, "OllamaAdapter: model may not support tools — falling back to plain chat");
          return await this.runPlainChat(client, messages);
        }
        throw err;
      }

      const choice = response.choices[0];
      const msg = choice?.message;
      if (!msg) break;

      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });

      // No tool calls — LLM is done
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const finalText = msg.content ?? "Operations completed.";
        const result = parseAdapterJson(finalText, 0); // Ollama is free
        result.toolOutputs = collectedToolOutputs;
        return result;
      }

      // Execute each requested tool
      for (const tc of msg.tool_calls) {
        if (tc.type !== "function") continue;
        const toolName = tc.function.name;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* keep empty */ }

        input.onPollCycle?.({ attempt: round, maxAttempts: MAX_TOOL_ROUNDS, status: `calling ${toolName}`, elapsedMs: 0 });

        const res = await executeTool(toolName, args, toolCtx);

        collectedToolOutputs.push({
          type: "command_output",
          title: toolName,
          content: res.result,
          metadata: { tool: toolName, args, isError: res.isError },
        });

        messages.push({ role: "tool", tool_call_id: tc.id, name: toolName, content: res.result });
        logger.info({ tool: toolName, isError: res.isError }, "OllamaAdapter: tool call complete");
      }
    }

    // Hit round limit
    const summaryText = collectedToolOutputs.length > 0
      ? `⚠️ Reached tool call limit (${MAX_TOOL_ROUNDS} rounds). Partial work:\n\n${collectedToolOutputs.map((o) => `**${o.title}**\n${o.content}`).join("\n\n")}`
      : "Operations completed (no tool output captured).";

    return {
      messageText: summaryText,
      suggestedNextTasks: [],
      completionStatus: "in_progress",
      confidence: 0.6,
      estimatedCost: 0,
      toolOutputs: collectedToolOutputs,
    };
  }

  private async runPlainChat(
    client: InstanceType<Awaited<typeof import("openai")>["default"]>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: any[],
  ): Promise<AgentTaskResult> {
    try {
      const response = await client.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: 2048,
        temperature: 0.7,
      });
      const text = response.choices[0]?.message?.content ?? "";
      return parseAdapterJson(text, 0);
    } catch (err) {
      logger.error({ err, baseUrl: this.baseUrl, model: this.model }, "OllamaAdapter: API call failed");
      throw err;
    }
  }

  async evaluateTask(_goal: string, _peers: Array<{ name: string; role: string }>): Promise<{ accepted: boolean; reason?: string }> {
    return { accepted: true };
  }
}
