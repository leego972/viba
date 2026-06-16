import { Router, type IRouter } from "express";
import { eq, asc, desc, inArray } from "drizzle-orm";
import {
  db,
  sessionsTable,
  agentsTable,
  tasksTable,
  messagesTable,
  memoryTable,
  approvalsTable,
  auditLogsTable,
  bannerDismissalsTable,
} from "@workspace/db";
import {
  CreateSessionBody,
  GetSessionParams,
  RunNextStepParams,
  RunFullWorkflowParams,
  SendMessageParams,
  SendMessageBody,
  ApproveActionParams,
  ApproveActionBody,
  StopSessionParams,
  ListAgentsParams,
  ListTasksParams,
  ListMessagesParams,
  GetMemoryParams,
  ListAuditLogsParams,
  ListApprovalsParams,
} from "@workspace/api-zod";
import { runNextAgentStep, runFullWorkflow } from "../lib/agentLoop";
import { determineTaskSequence, autoAssignRoles } from "../lib/taskRouter";

const router: IRouter = Router();

/** Recursively converts Date objects to ISO strings for JSON serialization */
function serialize<T>(val: T): T {
  if (val instanceof Date) return val.toISOString() as unknown as T;
  if (Array.isArray(val)) return val.map(serialize) as unknown as T;
  if (val !== null && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = serialize(v);
    }
    return out as T;
  }
  return val;
}

const PROVIDER_CAPABILITIES: Record<string, string[]> = {
  openai: ["planning", "reasoning", "creative_direction", "code_review", "final_qa"],
  anthropic: ["code_review", "writing", "logic_critique", "ux_review"],
  manus: ["research", "execution", "data_gathering", "analysis"],
  replit: ["build", "code", "deployment", "implementation"],
  google: ["multimodal", "contextual_analysis", "summarization", "creative"],
  perplexity: ["research_summary", "fact_checking", "citation"],
};

function getCapabilities(provider: string): string[] {
  return PROVIDER_CAPABILITIES[provider.toLowerCase()] ?? ["general"];
}

async function logAudit(sessionId: number, eventType: string, description: string, metadata?: Record<string, unknown>) {
  await db.insert(auditLogsTable).values({
    sessionId,
    eventType,
    description,
    metadata: metadata ?? {},
  });
}

/**
 * Derives activeModel for each agent from the most recent message that has a
 * non-null model value. Uses a single query for all agents to avoid N+1.
 */
async function withActiveModels<T extends { id: number; lastUsedModel: string | null }>(
  agents: T[]
): Promise<(T & { activeModel: string | null })[]> {
  if (agents.length === 0) return agents.map((a) => ({ ...a, activeModel: null }));

  const agentIds = agents.map((a) => a.id);

  // Fetch all messages for the given agents in one query, newest first.
  // Non-null model selection is applied in-memory on the returned rows.
  const agentFilter =
    agentIds.length === 1
      ? eq(messagesTable.agentId, agentIds[0]!)
      : inArray(messagesTable.agentId, agentIds);

  const rows = await db
    .select({ agentId: messagesTable.agentId, model: messagesTable.model })
    .from(messagesTable)
    .where(agentFilter)
    .orderBy(desc(messagesTable.id));

  // Take the first non-null model seen per agent (rows are ordered newest-first)
  const latestModelByAgent = new Map<number, string>();
  for (const row of rows) {
    if (row.agentId !== null && row.model !== null && !latestModelByAgent.has(row.agentId)) {
      latestModelByAgent.set(row.agentId, row.model);
    }
  }

  return agents.map((a) => ({
    ...a,
    activeModel: latestModelByAgent.get(a.id) ?? null,
  }));
}

/** Enriches a session row with the agentModes array required by the Session schema */
async function withAgentModes<T extends { id: number }>(session: T) {
  const agents = await db.select().from(agentsTable).where(eq(agentsTable.sessionId, session.id));
  return {
    ...session,
    agentModes: agents.map((a) => ({ name: a.name, provider: a.provider, isMock: a.isMock })),
  };
}

// GET /sessions
router.get("/sessions", async (req, res): Promise<void> => {
  const sessions = await db.select().from(sessionsTable).orderBy(asc(sessionsTable.id));
  const agents = await db.select().from(agentsTable);

  const agentsBySession = agents.reduce<Record<number, typeof agents>>((acc, agent) => {
    if (!acc[agent.sessionId]) acc[agent.sessionId] = [];
    acc[agent.sessionId]!.push(agent);
    return acc;
  }, {});

  const result = sessions.map((session) => ({
    ...session,
    agentModes: (agentsBySession[session.id] ?? []).map((a) => ({
      name: a.name,
      provider: a.provider,
      isMock: a.isMock,
    })),
  }));

  res.json(serialize(result));
});

// POST /sessions
router.post("/sessions", async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { goal, autonomyMode, agents } = parsed.data;

  const allMock = agents.every((a) => a.isMock);
  const noneMock = agents.every((a) => !a.isMock);
  const mode: "live" | "simulation" | "mixed" = allMock ? "simulation" : noneMock ? "live" : "mixed";

  const [session] = await db
    .insert(sessionsTable)
    .values({ goal, autonomyMode, status: "active", mode })
    .returning();

  if (!session) {
    res.status(500).json({ error: "Failed to create session" });
    return;
  }

  await logAudit(session.id, "session_created", `Session created with goal: ${goal}`, { autonomyMode });

  const providerList = agents.map((a) => a.provider);
  const autoRoles = autoAssignRoles(providerList);

  const createdAgents = [];
  for (const agentInput of agents) {
    const role = agentInput.role || autoRoles[agentInput.provider] || "Strategist";
    const [agent] = await db
      .insert(agentsTable)
      .values({
        sessionId: session.id,
        name: agentInput.name,
        provider: agentInput.provider.toLowerCase(),
        role,
        capabilities: getCapabilities(agentInput.provider),
        isMock: agentInput.isMock,
      })
      .returning();
    if (agent) {
      createdAgents.push(agent);
      await logAudit(session.id, "agent_added", `Agent ${agent.name} (${role}) added to session`, {
        agentId: agent.id,
        provider: agent.provider,
      });
    }
  }

  const taskSequence = determineTaskSequence(goal);
  for (let i = 0; i < taskSequence.length; i++) {
    const taskDef = taskSequence[i];
    if (!taskDef) continue;
    const [task] = await db
      .insert(tasksTable)
      .values({
        sessionId: session.id,
        title: taskDef.title,
        description: taskDef.description,
        type: taskDef.type,
        status: "planned",
      })
      .returning();
    if (task) {
      await logAudit(session.id, "task_created", `Task "${task.title}" created`, { taskId: task.id, type: task.type });
    }
  }

  await db.insert(memoryTable).values({
    sessionId: session.id,
    summary: `Project started: ${goal}. Agents: ${createdAgents.map((a) => `${a.name} (${a.role})`).join(", ")}.`,
    decisions: [`Project goal defined: ${goal}`, `Autonomy mode: ${autonomyMode}`],
  });

  res.status(201).json(serialize(await withAgentModes(session)));
});

// GET /sessions/:id
router.get("/sessions/:id", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const agentRows = await db.select().from(agentsTable).where(eq(agentsTable.sessionId, session.id));
  const agents = await withActiveModels(agentRows);
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.sessionId, session.id)).orderBy(asc(tasksTable.id));
  const messages = await db.select().from(messagesTable).where(eq(messagesTable.sessionId, session.id)).orderBy(asc(messagesTable.id));
  const [memory] = await db.select().from(memoryTable).where(eq(memoryTable.sessionId, session.id));
  const approvals = await db.select().from(approvalsTable).where(eq(approvalsTable.sessionId, session.id));

  res.json(serialize({
    ...session,
    agents,
    tasks,
    messages,
    memory: memory ?? null,
    approvals,
  }));
});

// DELETE /sessions/:id
router.delete("/sessions/:id", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const sessionId = params.data.id;
  // Cascade-delete all related data
  await db.delete(auditLogsTable).where(eq(auditLogsTable.sessionId, sessionId));
  await db.delete(approvalsTable).where(eq(approvalsTable.sessionId, sessionId));
  await db.delete(memoryTable).where(eq(memoryTable.sessionId, sessionId));
  await db.delete(messagesTable).where(eq(messagesTable.sessionId, sessionId));
  await db.delete(tasksTable).where(eq(tasksTable.sessionId, sessionId));
  await db.delete(agentsTable).where(eq(agentsTable.sessionId, sessionId));
  await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));
  res.status(204).end();
});

// POST /sessions/:id/run-next
router.post("/sessions/:id/run-next", async (req, res): Promise<void> => {
  const params = RunNextStepParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const result = await runNextAgentStep(params.data.id);
  const [updatedSession] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, params.data.id));

  res.json(serialize({
    session: updatedSession ? await withAgentModes(updatedSession) : updatedSession,
    newMessages: result.newMessages,
    updatedTasks: result.updatedTasks,
    approvalRequired: result.approvalRequired,
    approval: result.approval,
    stepsRun: 1,
  }));
});

// POST /sessions/:id/run-full
router.post("/sessions/:id/run-full", async (req, res): Promise<void> => {
  const params = RunFullWorkflowParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const result = await runFullWorkflow(params.data.id);
  const [updatedSession] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, params.data.id));

  res.json(serialize({
    session: updatedSession ? await withAgentModes(updatedSession) : updatedSession,
    newMessages: result.newMessages,
    updatedTasks: result.updatedTasks,
    approvalRequired: result.approvalRequired,
    approval: result.approval,
    stepsRun: result.stepsRun,
  }));
});

// POST /sessions/:id/message
router.post("/sessions/:id/message", async (req, res): Promise<void> => {
  const params = SendMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SendMessageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [message] = await db
    .insert(messagesTable)
    .values({
      sessionId: params.data.id,
      agentId: null,
      role: "user",
      provider: null,
      content: body.data.content,
      taskId: null,
      agentName: "User",
      agentRole: "Human",
    })
    .returning();

  res.status(201).json(serialize(message));
});

// POST /sessions/:id/approve
router.post("/sessions/:id/approve", async (req, res): Promise<void> => {
  const params = ApproveActionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = ApproveActionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [approval] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, body.data.approvalId));
  if (!approval) {
    res.status(404).json({ error: "Approval not found" });
    return;
  }

  const [updated] = await db
    .update(approvalsTable)
    .set({ status: "approved", approvedAt: new Date() })
    .where(eq(approvalsTable.id, approval.id))
    .returning();

  await logAudit(params.data.id, "approval_granted", `Approval granted for: ${approval.description}`, {
    approvalId: approval.id,
    type: approval.type,
  });

  res.json(serialize(updated));
});

// POST /sessions/:id/stop
router.post("/sessions/:id/stop", async (req, res): Promise<void> => {
  const params = StopSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [updated] = await db
    .update(sessionsTable)
    .set({ status: "stopped" })
    .where(eq(sessionsTable.id, params.data.id))
    .returning();

  await logAudit(params.data.id, "session_stopped", "Session stopped by user");

  res.json(serialize(updated ? await withAgentModes(updated) : updated));
});

// GET /sessions/:id/stream — Server-Sent Events for real-time workspace updates
router.get("/sessions/:id/stream", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const sessionId = params.data.id;
  const [initial] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!initial) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendSnapshot = async () => {
    try {
      const [sess] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
      if (!sess) return;

      const agentRows = await db.select().from(agentsTable).where(eq(agentsTable.sessionId, sessionId));
      const agents = await withActiveModels(agentRows);
      const messages = await db
        .select().from(messagesTable)
        .where(eq(messagesTable.sessionId, sessionId))
        .orderBy(asc(messagesTable.id));
      const tasks = await db
        .select().from(tasksTable)
        .where(eq(tasksTable.sessionId, sessionId))
        .orderBy(asc(tasksTable.id));
      const approvals = await db
        .select().from(approvalsTable)
        .where(eq(approvalsTable.sessionId, sessionId));
      const auditLogs = await db
        .select().from(auditLogsTable)
        .where(eq(auditLogsTable.sessionId, sessionId))
        .orderBy(asc(auditLogsTable.id));
      const [memory] = await db
        .select().from(memoryTable)
        .where(eq(memoryTable.sessionId, sessionId));

      const payload = serialize({
        session: { ...sess, memory: memory ?? null },
        agents,
        messages,
        tasks,
        approvals,
        auditLogs,
      });

      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // ignore snapshot errors — EventSource auto-reconnects
    }
  };

  await sendSnapshot();
  const interval = setInterval(sendSnapshot, 800);
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 20_000);

  req.on("close", () => {
    clearInterval(interval);
    clearInterval(keepAlive);
  });
});

// GET /sessions/:id/agents
router.get("/sessions/:id/agents", async (req, res): Promise<void> => {
  const params = ListAgentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const agentRows = await db.select().from(agentsTable).where(eq(agentsTable.sessionId, params.data.id));
  const agents = await withActiveModels(agentRows);
  res.json(serialize(agents));
});

// GET /sessions/:id/tasks
router.get("/sessions/:id/tasks", async (req, res): Promise<void> => {
  const params = ListTasksParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.sessionId, params.data.id)).orderBy(asc(tasksTable.id));
  res.json(serialize(tasks));
});

// GET /sessions/:id/messages
router.get("/sessions/:id/messages", async (req, res): Promise<void> => {
  const params = ListMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const messages = await db.select().from(messagesTable).where(eq(messagesTable.sessionId, params.data.id)).orderBy(asc(messagesTable.id));
  res.json(serialize(messages));
});

// GET /sessions/:id/memory
router.get("/sessions/:id/memory", async (req, res): Promise<void> => {
  const params = GetMemoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [memory] = await db.select().from(memoryTable).where(eq(memoryTable.sessionId, params.data.id));
  if (!memory) {
    res.status(404).json({ error: "Memory not found" });
    return;
  }
  res.json(serialize(memory));
});

// GET /sessions/:id/audit-logs
router.get("/sessions/:id/audit-logs", async (req, res): Promise<void> => {
  const params = ListAuditLogsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const logs = await db.select().from(auditLogsTable).where(eq(auditLogsTable.sessionId, params.data.id)).orderBy(asc(auditLogsTable.id));
  res.json(serialize(logs));
});

// GET /sessions/:id/approvals
router.get("/sessions/:id/approvals", async (req, res): Promise<void> => {
  const params = ListApprovalsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const approvals = await db.select().from(approvalsTable).where(eq(approvalsTable.sessionId, params.data.id));
  res.json(serialize(approvals));
});

// GET /sessions/:id/banner-dismissal
router.get("/sessions/:id/banner-dismissal", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }
  const [session] = await db.select({ id: sessionsTable.id }).from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const [row] = await db.select().from(bannerDismissalsTable).where(eq(bannerDismissalsTable.sessionId, id));
  res.json({ sessionId: id, dismissedAt: row ? serialize(row.dismissedAt) : null });
});

// PUT /sessions/:id/banner-dismissal
// Accepts an optional JSON body: { dismissedAt?: string } (ISO 8601).
// Pass the original dismissal timestamp during migration so the banner
// re-show comparison (latestFallbackTimestamp > dismissedAt) is preserved.
// When no timestamp is provided, the server records the current time.
// NOTE: This app has no user authentication system (single-tenant); dismissal
// is keyed by sessionId only. If multi-user auth is added, this should be
// updated to key by (userId, sessionId) to isolate per-user state.
router.put("/sessions/:id/banner-dismissal", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }
  const [session] = await db.select({ id: sessionsTable.id }).from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  let dismissedAt: Date;
  const bodyTs = req.body?.dismissedAt;
  if (bodyTs !== undefined) {
    if (typeof bodyTs !== "string" || isNaN(Date.parse(bodyTs))) {
      res.status(400).json({ error: "dismissedAt must be a valid ISO 8601 timestamp string" });
      return;
    }
    dismissedAt = new Date(bodyTs);
  } else {
    dismissedAt = new Date();
  }
  await db
    .insert(bannerDismissalsTable)
    .values({ sessionId: id, dismissedAt })
    .onConflictDoUpdate({ target: bannerDismissalsTable.sessionId, set: { dismissedAt } });
  res.json({ sessionId: id, dismissedAt: dismissedAt.toISOString() });
});

// DELETE /sessions/:id/banner-dismissal
// Removes the dismissal record so the banner reappears (e.g. when new
// simulated messages arrive). Returns 200 with { sessionId, dismissedAt: null }
// whether or not a record existed (idempotent).
router.delete("/sessions/:id/banner-dismissal", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }
  const [session] = await db.select({ id: sessionsTable.id }).from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await db.delete(bannerDismissalsTable).where(eq(bannerDismissalsTable.sessionId, id));
  res.json({ sessionId: id, dismissedAt: null });
});


  // GET /sessions/:id/export — download full session as Markdown transcript
  router.get("/sessions/:id/export", async (req, res): Promise<void> => {
    const parsed = GetSessionParams.safeParse(req.params);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    const id = parsed.data.id;

    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }

    const [agents, tasks, messages] = await Promise.all([
      db.select().from(agentsTable).where(eq(agentsTable.sessionId, id)).orderBy(asc(agentsTable.id)),
      db.select().from(tasksTable).where(eq(tasksTable.sessionId, id)).orderBy(asc(tasksTable.id)),
      db.select().from(messagesTable).where(eq(messagesTable.sessionId, id)).orderBy(asc(messagesTable.id)),
    ]);

    const taskLines = tasks.map((t) =>
      `- [${t.status === "completed" ? "x" : " "}] **${t.title}** (${t.type}) — ${t.status}`
    );

    const messageLines = messages.flatMap((m) => [
      `### ${m.agentName ? `[${m.agentName}]` : "User"} — ${new Date(m.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
      ``,
      m.content,
      ``,
    ]);

    const agentLines = agents.map(
      (a) => `- **${a.name}** — Provider: ${a.provider}, Role: ${a.role}, Mode: ${a.isMock ? "simulation" : "live"}`
    );

    const lines = [
      `# VIBA - Collaborative Multi-Agent Orchestration System Session Transcript`,
      ``,
      `**Goal:** ${session.goal}`,
      `**Mode:** ${session.mode}`,
      `**Status:** ${session.status}`,
      `**Created:** ${new Date(session.createdAt).toISOString()}`,
      ``,
      `## Agents (${agents.length})`,
      ``,
      ...agentLines,
      ``,
      `## Task Plan (${tasks.length} tasks)`,
      ``,
      ...taskLines,
      ``,
      `## Conversation`,
      ``,
      ...messageLines,
      `---`,
      `*Exported from VIBA - Collaborative Multi-Agent Orchestration System*`,
    ];

    const markdown = lines.join("\n");
    const filename = `viba-session-${id}.md`;

    res.set("Content-Type", "text/markdown; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(markdown);
  });

  export default router;
