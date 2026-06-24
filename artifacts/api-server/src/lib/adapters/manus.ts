import type { AgentAdapter, AgentTaskInput, AgentTaskResult, ToolOutput } from "./interface";
import { buildAdapterJsonSchema, parseAdapterJson, normalizeToolOutputs } from "./shared";
import { logger } from "../logger";

const TASK_POLL_INTERVAL_MS = 5_000;

function getMaxAttempts(): number {
  const budgetMs = parseInt(process.env["MANUS_TASK_TIMEOUT_MS"] ?? "60000", 10);
  return Math.max(1, Math.ceil(budgetMs / TASK_POLL_INTERVAL_MS));
}

interface ManusTaskResponse {
  task_id: string;
}

interface ManusTaskStatus {
  task_id: string;
  status: "pending" | "running" | "complete" | "failed";
  result?: {
    summary?: string;
    outputs?: Array<{
      type: string;
      title: string;
      content: string;
      metadata?: Record<string, unknown>;
    }>;
  };
  error?: string;
}

const MANUS_API_BASE = "https://api.manus.im/v1";

/**
 * Submits a multi-step workflow to the Manus task API and polls until complete.
 * Uses MANUS_WORKSPACE_API_KEY (distinct from the LLM inference key).
 * On timeout, returns the partial result accumulated so far rather than throwing.
 */
async function runManusWorkflowTask(
  workspaceApiKey: string,
  input: AgentTaskInput,
): Promise<{ summary: string; toolOutputs: ToolOutput[]; timedOut?: boolean }> {
  const repoContext = input.repoUrl
    ? { repoUrl: input.repoUrl, branch: input.repoBranch ?? "main", environment: input.workspaceEnv ?? "development" }
    : undefined;

  const body = {
    goal: input.taskInstruction,
    project_goal: input.projectGoal,
    context: input.memorySummary ?? "",
    ...(repoContext ? { workspace: repoContext } : {}),
  };

  const submitRes = await fetch(`${MANUS_API_BASE}/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${workspaceApiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => "");
    throw new Error(`Manus task submission failed: ${submitRes.status} ${errText}`);
  }

  const submitted = (await submitRes.json()) as ManusTaskResponse;
  const taskId = submitted.task_id;

  if (!taskId) {
    throw new Error("Manus API did not return a task_id");
  }

  logger.info({ taskId, repoUrl: input.repoUrl }, "Manus workflow task submitted — polling for result");

  const maxAttempts = getMaxAttempts();
  const startMs = Date.now();

  let lastSummary: string | undefined;
  let lastToolOutputs: ToolOutput[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, TASK_POLL_INTERVAL_MS));

    const pollRes = await fetch(`${MANUS_API_BASE}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${workspaceApiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!pollRes.ok) {
      logger.warn({ taskId, status: pollRes.status }, "Manus task poll returned non-OK — will retry");
      input.onPollCycle?.({
        attempt,
        maxAttempts,
        status: "polling",
        elapsedMs: Date.now() - startMs,
      });
      continue;
    }

    const task = (await pollRes.json()) as ManusTaskStatus;

    // Stash any partial outputs we receive during polling
    if (task.result?.outputs && task.result.outputs.length > 0) {
      lastToolOutputs = normalizeToolOutputs(task.result.outputs);
    }
    if (task.result?.summary) {
      lastSummary = task.result.summary;
    }

    input.onPollCycle?.({
      attempt,
      maxAttempts,
      status: task.status,
      elapsedMs: Date.now() - startMs,
    });

    if (task.status === "complete") {
      const toolOutputs = lastToolOutputs;
      const summary = lastSummary ?? "Manus completed the workflow task.";
      logger.info({ taskId, outputCount: toolOutputs.length }, "Manus workflow task complete");
      return { summary, toolOutputs };
    }

    if (task.status === "failed") {
      throw new Error(`Manus task failed: ${task.error ?? "unknown error"}`);
    }

    logger.debug({ taskId, status: task.status, attempt }, "Manus task still running");
  }

  // Timeout: return partial result rather than discarding work already done
  const elapsedMs = Date.now() - startMs;
  const budgetMs = parseInt(process.env["MANUS_TASK_TIMEOUT_MS"] ?? "60000", 10);
  logger.warn({ taskId, elapsedMs, budgetMs }, "Manus task timed out — persisting partial result");

  return {
    summary: lastSummary
      ? `⏱ Task timed out after ${Math.round(elapsedMs / 1000)}s (budget: ${budgetMs / 1000}s). Partial result: ${lastSummary}`
      : `⏱ Manus task timed out after ${Math.round(elapsedMs / 1000)}s — no partial output was available.`,
    toolOutputs: lastToolOutputs,
    timedOut: true,
  };
}

export class ManusAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "manus";
  capabilities = ["research", "execution", "data_gathering", "analysis"];
  role: string;
  isMock = false;
  canUseTools: boolean;

  private apiKey: string;
  model: string;

  constructor(id: string, name: string, role: string, apiKey: string, model?: string, canUseTools = true) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.apiKey = apiKey;
    this.model = model ?? process.env["MANUS_MODEL"] ?? "manus-deep-research-1";
    this.canUseTools = canUseTools;
  }

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    // ── Real execution path: Manus Workspace Task API ─────────────────────
    // Used when MANUS_WORKSPACE_API_KEY is configured. This key is separate
    // from the inference API key and grants access to multi-step task execution.
    const workspaceApiKey = process.env["MANUS_WORKSPACE_API_KEY"];
    if (workspaceApiKey) {
      logger.info(
        { repoUrl: input.repoUrl },
        "ManusAdapter: delegating to Manus Workspace Task API for real execution",
      );
      try {
        const { summary, toolOutputs, timedOut } = await runManusWorkflowTask(workspaceApiKey, input);

        const costEstimate = 0.05; // flat estimate for task execution; no token data from this API
        return {
          messageText: summary,
          suggestedNextTasks: [],
          completionStatus: timedOut ? "in_progress" : "complete",
          confidence: timedOut ? 0.5 : 0.88,
          estimatedCost: costEstimate,
          toolOutputs,
        };
      } catch (err) {
        logger.warn(
          { err },
          "Manus Workspace Task API call failed — falling back to LLM chat completion",
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

You CAN use tools: browse the web, run code, gather data, call external APIs, and execute multi-step research workflows. You are trusted to take real action on behalf of the team.

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

      return parseAdapterJson(text, cost);
    } catch (err) {
      logger.error({ err }, "Manus API call failed");
      throw err;
    }
  }

  async evaluateTask(goal: string, _peers: Array<{ name: string; role: string }>): Promise<{ accepted: boolean; reason?: string }> {
    const HARMFUL =
      /\b(malware|(?:write|create|build|code)\s+(?:a\s+)?(?:virus|ransomware|trojan|worm|rootkit)|ddos\s+attack|weapons?\s+of\s+mass\s+destruction|bioweapon|chemical\s+weapon|nuclear\s+weapon|child\s+(?:abuse|sexual|pornography)|csam|human\s+trafficking|terrorism\s+plot|genocide\s+campaign)\b/i;
    if (HARMFUL.test(goal)) {
      return { accepted: false, reason: "This goal conflicts with my research and execution safety protocols. I cannot research or execute tasks of this nature." };
    }
    return { accepted: true };
  }
}
