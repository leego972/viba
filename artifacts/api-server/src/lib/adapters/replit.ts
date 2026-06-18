import type { AgentAdapter, AgentTaskInput, AgentTaskResult, ToolOutput } from "./interface";
import { buildAdapterJsonSchema, parseAdapterJson, normalizeToolOutputs } from "./shared";
import { logger } from "../logger";

const AGENT_POLL_INTERVAL_MS = 4_000;

function getMaxAttempts(): number {
  const budgetMs = parseInt(process.env["REPLIT_AGENT_TIMEOUT_MS"] ?? "60000", 10);
  return Math.max(1, Math.ceil(budgetMs / AGENT_POLL_INTERVAL_MS));
}

interface ReplitAgentTask {
  taskId: string;
  status: "queued" | "running" | "complete" | "failed";
  outputs?: Array<{
    type: string;
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
  }>;
  summary?: string;
  error?: string;
}

/**
 * Submits a task to the Replit Agent API and polls until complete.
 * Returns structured tool outputs and a summary text.
 * On timeout, returns the partial result accumulated so far rather than throwing.
 */
async function runReplitAgentTask(
  agentUrl: string,
  apiKey: string,
  input: AgentTaskInput,
): Promise<{ summary: string; toolOutputs: ToolOutput[]; timedOut?: boolean }> {
  const submitUrl = `${agentUrl.replace(/\/$/, "")}/tasks`;

  const body = {
    task: input.taskInstruction,
    goal: input.projectGoal,
    repoUrl: input.repoUrl,
    branch: input.repoBranch ?? "main",
    environment: input.workspaceEnv ?? "development",
    context: input.memorySummary ?? "",
  };

  const submitRes = await fetch(submitUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => "");
    throw new Error(`Replit Agent task submission failed: ${submitRes.status} ${errText}`);
  }

  const submitted = (await submitRes.json()) as { taskId: string };
  const taskId = submitted.taskId;

  if (!taskId) {
    throw new Error("Replit Agent API did not return a taskId");
  }

  logger.info({ taskId, repoUrl: input.repoUrl }, "Replit Agent task submitted — polling for result");

  const pollUrl = `${agentUrl.replace(/\/$/, "")}/tasks/${taskId}`;
  const maxAttempts = getMaxAttempts();
  const startMs = Date.now();

  let lastSummary: string | undefined;
  let lastToolOutputs: ToolOutput[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, AGENT_POLL_INTERVAL_MS));

    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!pollRes.ok) {
      logger.warn({ taskId, status: pollRes.status }, "Replit Agent poll returned non-OK — will retry");
      input.onPollCycle?.({
        attempt,
        maxAttempts,
        status: "polling",
        elapsedMs: Date.now() - startMs,
      });
      continue;
    }

    const task = (await pollRes.json()) as ReplitAgentTask;

    // Stash any partial outputs we receive during polling
    if (task.outputs && task.outputs.length > 0) {
      lastToolOutputs = normalizeToolOutputs(task.outputs);
    }
    if (task.summary) {
      lastSummary = task.summary;
    }

    input.onPollCycle?.({
      attempt,
      maxAttempts,
      status: task.status,
      elapsedMs: Date.now() - startMs,
    });

    if (task.status === "complete") {
      const toolOutputs = lastToolOutputs;
      const summary = lastSummary ?? "Replit Agent completed the task.";
      logger.info({ taskId, outputCount: toolOutputs.length }, "Replit Agent task complete");
      return { summary, toolOutputs };
    }

    if (task.status === "failed") {
      throw new Error(`Replit Agent task failed: ${task.error ?? "unknown error"}`);
    }

    logger.debug({ taskId, status: task.status, attempt }, "Replit Agent task still running");
  }

  // Timeout: return partial result rather than discarding work already done
  const elapsedMs = Date.now() - startMs;
  const budgetMs = parseInt(process.env["REPLIT_AGENT_TIMEOUT_MS"] ?? "60000", 10);
  logger.warn({ taskId, elapsedMs, budgetMs }, "Replit Agent task timed out — persisting partial result");

  return {
    summary: lastSummary
      ? `⏱ Task timed out after ${Math.round(elapsedMs / 1000)}s (budget: ${budgetMs / 1000}s). Partial result: ${lastSummary}`
      : `⏱ Replit Agent task timed out after ${Math.round(elapsedMs / 1000)}s — no partial output was available.`,
    toolOutputs: lastToolOutputs,
    timedOut: true,
  };
}

export class ReplitAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "replit";
  capabilities = ["build", "code", "deployment", "implementation"];
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
    this.model = model ?? process.env["REPLIT_MODEL"] ?? "replit-code-v1-3b";
  }

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    // ── Real execution path: Replit Agent API ──────────────────────────────
    // Used when REPLIT_AGENT_URL is configured and a repo is attached to the session.
    const agentUrl = process.env["REPLIT_AGENT_URL"];
    if (agentUrl && input.repoUrl) {
      logger.info(
        { agentUrl, repoUrl: input.repoUrl, branch: input.repoBranch },
        "ReplitAdapter: delegating to Replit Agent API for real code execution",
      );
      try {
        const { summary, toolOutputs, timedOut } = await runReplitAgentTask(agentUrl, this.apiKey, input);

        const costEstimate = 0.02; // flat estimate for agent execution; no token data available
        return {
          messageText: summary,
          suggestedNextTasks: [],
          completionStatus: timedOut ? "in_progress" : "complete",
          confidence: timedOut ? 0.5 : 0.9,
          estimatedCost: costEstimate,
          toolOutputs,
        };
      } catch (err) {
        logger.warn(
          { err },
          "Replit Agent API call failed — falling back to LLM chat completion",
        );
        // fall through to LLM path
      }
    }

    // ── LLM chat completion path ───────────────────────────────────────────
    const workspaceBlock = input.repoUrl
      ? `\nWorkspace context:\n- Repo: ${input.repoUrl}\n- Branch: ${input.repoBranch ?? "main"}\n- Environment: ${input.workspaceEnv ?? "development"}\n`
      : "";

    const questionsBlock = (input.pendingQuestions ?? []).length > 0
      ? `\nQuestions from other agents you must answer FIRST (task-scoped only):\n${(input.pendingQuestions ?? []).map((q, i) => `${i + 1}. [from ${q.fromAgent}] ${q.question}`).join("\n")}\n`
      : "";

    const jsonSchema = buildAdapterJsonSchema(true, input.pendingQuestions);

    const systemPrompt = `You are ${this.name}, a tool-capable AI agent with the role of ${this.role} in VIBA — Collaborative Multi-Agent Orchestration System.

You CAN use tools: execute code, clone git repositories, run tests, write files, and deploy to environments. You are one of the agents trusted with real execution work.

Project Goal: ${input.projectGoal}
${workspaceBlock}
Shared Memory Summary: ${input.memorySummary || "No previous context."}
${questionsBlock}
Your task: ${input.taskInstruction}
${jsonSchema}`;

    const messages = input.previousMessages.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.agentName ? `[${m.agentName}]: ${m.content}` : m.content,
    }));

    messages.push({ role: "user", content: input.taskInstruction });

    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: "https://replit.com/ai/v1",
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
      const outputCost = ((usage?.completion_tokens ?? 0) / 1_000_000) * 0.40;
      const cost = inputCost + outputCost;

      return parseAdapterJson(text, cost);
    } catch (err) {
      logger.error({ err }, "Replit AI API call failed");
      throw err;
    }
  }

  async evaluateTask(goal: string, _peers: Array<{ name: string; role: string }>): Promise<{ accepted: boolean; reason?: string }> {
    const HARMFUL =
      /\b(malware|(?:write|create|build|code)\s+(?:a\s+)?(?:virus|ransomware|trojan|worm|rootkit)|ddos\s+attack|weapons?\s+of\s+mass\s+destruction|bioweapon|chemical\s+weapon|nuclear\s+weapon|child\s+(?:abuse|sexual|pornography)|csam|human\s+trafficking|terrorism\s+plot|genocide\s+campaign)\b/i;
    if (HARMFUL.test(goal)) {
      return { accepted: false, reason: "This goal conflicts with my operational safety constraints. I cannot build or execute tasks of this nature." };
    }
    return { accepted: true };
  }
}
