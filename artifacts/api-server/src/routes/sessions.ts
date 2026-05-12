import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import {
  db,
  sessionsTable,
  agentsTable,
  tasksTable,
  messagesTable,
  memoryTable,
  approvalsTable,
  auditLogsTable,
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

// GET /sessions
router.get("/sessions", async (req, res): Promise<void> => {
  const sessions = await db.select().from(sessionsTable).orderBy(asc(sessionsTable.id));
  res.json(serialize(sessions));
});

// POST /sessions
router.post("/sessions", async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { goal, autonomyMode, agents } = parsed.data;

  const [session] = await db
    .insert(sessionsTable)
    .values({ goal, autonomyMode, status: "active" })
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

  res.status(201).json(serialize(session));
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

  const agents = await db.select().from(agentsTable).where(eq(agentsTable.sessionId, session.id));
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
    session: updatedSession,
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
    session: updatedSession,
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

  res.json(serialize(updated));
});

// GET /sessions/:id/agents
router.get("/sessions/:id/agents", async (req, res): Promise<void> => {
  const params = ListAgentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const agents = await db.select().from(agentsTable).where(eq(agentsTable.sessionId, params.data.id));
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

export default router;
