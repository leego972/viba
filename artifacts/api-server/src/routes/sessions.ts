import { z } from "zod/v4";
import { Router, type IRouter } from "express";
import { eq, asc, desc, inArray, sql, and } from "drizzle-orm";
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
  UpdateSessionParams,
  UpdateSessionBody,
  GetSessionParams,
  RunNextStepParams,
  RunFullWorkflowParams,
  SendMessageParams,
  SendMessageBody,
  AnswerQuestionParams,
  AnswerQuestionBody,
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

function currentUserId(req: { session?: { userId?: number; bypass?: boolean } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function sessionOwnerFilter(req: { session?: { userId?: number; bypass?: boolean } }) {
  const uid = currentUserId(req);
  if (uid === null || req.session?.bypass) return undefined;
  return eq(sessionsTable.userId, uid);
}

/**
 * Extracts toolOutputs from metadata and resolves toAgentId → toAgentName.
 * Pass agentNameMap (agentId → name) to surface the recipient name in messages
 * that carry an outbound question to a specific peer agent.
 */
function formatMessage(
  msg: typeof messagesTable.$inferSelect,
  agentNameMap?: Map<number, string>,
): typeof messagesTable.$inferSelect & { toolOutputs: unknown[] | null; toAgentName: string | null } {
  const meta = msg.metadata as Record<string, unknown> | null;
  const toolOutputs = Array.isArray(meta?.["toolOutputs"]) ? (meta["toolOutputs"] as unknown[]) : null;
  const toAgentName =
    msg.toAgentId !== null && agentNameMap ? (agentNameMap.get(msg.toAgentId) ?? null) : null;
  return { ...msg, toolOutputs, toAgentName };
}

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
  railway: ["deployment", "infrastructure", "monitoring", "environment_management", "rollback"],
  groq: ["planning", "reasoning", "code_review", "build", "implementation", "research"],
  ollama: ["planning", "reasoning", "code_review", "build", "implementation", "research"],
};

const TOOL_CAPABLE_PROVIDERS = new Set(["replit", "manus", "railway", "groq", "ollama"]);

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

  const agentFilter =
    agentIds.length === 1
      ? eq(messagesTable.agentId, agentIds[0]!)
      : inArray(messagesTable.agentId, agentIds);

  const rows = await db
    .select({ agentId: messagesTable.agentId, model: messagesTable.model })
    .from(messagesTable)
    .where(agentFilter)
    .orderBy(desc(messagesTable.id));

  const latestModelByAgent = new Map<number, string>();
  for (const row of rows) {
    if (row.agentId !== null && row.model !== null && !latestModelByAgent.has(row.agentId)) {
      latestModelByAgent.set(row.agentId, row.model);
    }
  }

  return agents.map((a) => ({ ...a, activeModel: latestModelByAgent.get(a.id) ?? null }));
}

/** Enriches a session row with the agentModes array required by the Session schema */
async function withAgentModes<T extends { id: number }>(session: T) {
  const agents = await db.select().from(agentsTable).where(eq(agentsTable.sessionId, session.id));
  return {
    ...session,
    agentModes: agents.map((a) => ({ name: a.name, provider: a.provider, isMock: a.isMock })),
  };
}

// GET /sessions  — paginated (default 100, max 500)
router.get("/sessions", async (req, res): Promise<void> => {
  const rawLimit = parseInt(String(req.query.limit ?? "100"), 10);
  const rawOffset = parseInt(String(req.query.offset ?? "0"), 10);
  const limit = Math.min(Number.isNaN(rawLimit) ? 100 : Math.max(1, rawLimit), 500);
  const offset = Number.isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);
  const ownerFilter = sessionOwnerFilter(req);

  const [sessions, totalRows] = await Promise.all([
    ownerFilter
      ? db.select().from(sessionsTable).where(ownerFilter).orderBy(asc(sessionsTable.id)).limit(limit).offset(offset)
      : db.select().from(sessionsTable).orderBy(asc(sessionsTable.id)).limit(limit).offset(offset),
    ownerFilter
      ? db.select({ total: sql`count(*)::int` }).from(sessionsTable).where(ownerFilter)
      : db.select({ total: sql`count(*)::int` }).from(sessionsTable),
  ]);

  const sessionIds = sessions.map((s) => s.id);
  const agents = sessionIds.length > 0
    ? await db.select().from(agentsTable).where(inArray(agentsTable.sessionId, sessionIds))
    : [];

  const agentsBySession = agents.reduce<Record<number, typeof agents>>((acc, agent) => {
    if (!acc[agent.sessionId]) acc[agent.sessionId] = [];
    acc[agent.sessionId]!.push(agent);
    return acc;
  }, {});

  const result = sessions.map((session) => ({
    ...session,
    agentModes: (agentsBySession[session.id] ?? []).map((a) => ({ name: a.name, provider: a.provider, isMock: a.isMock })),
  }));

  res.json(serialize({ sessions: result, total: totalRows[0]?.total ?? 0, limit, offset }));
});

// POST /sessions
router.post("/sessions", async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { goal, autonomyMode, agents, repoUrl: rawRepoUrl, repoBranch: rawRepoBranch, workspaceEnv: rawWorkspaceEnv } = parsed.data;
  const repoUrl = typeof rawRepoUrl === "string" ? rawRepoUrl.trim() || null : null;
  const repoBranch = typeof rawRepoBranch === "string" ? rawRepoBranch.trim() || null : null;
  const workspaceEnv = typeof rawWorkspaceEnv === "string" ? rawWorkspaceEnv.trim() || null : null;

  const allMock = agents.every((a) => a.isMock);
  const noneMock = agents.every((a) => !a.isMock);
  const mode: "live" | "simulation" | "mixed" = allMock ? "simulation" : noneMock ? "live" : "mixed";

  const [session] = await db
    .insert(sessionsTable)
    .values({ goal, userId: currentUserId(req), autonomyMode, status: "active", mode, repoUrl: repoUrl ?? null, repoBranch: repoBranch ?? null, workspaceEnv: workspaceEnv ?? null })
    .returning();

  if (!session) {
    res.status(500).json({ error: "Failed to create session" });
    return;
  }

  await logAudit(session.id, "session_created", `Session created with goal: ${goal}`, { autonomyMode, userId: session.userId });

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
        canUseTools: agentInput.canUseTools ?? TOOL_CAPABLE_PROVIDERS.has(agentInput.provider.toLowerCase()),
        isMock: agentInput.isMock,
      })
      .returning();
    if (agent) {
      createdAgents.push(agent);
      await logAudit(session.id, "agent_added", `Agent ${agent.name} (${role}) added to session`, { agentId: agent.id, provider: agent.provider });
    }
  }

  const taskSequence = determineTaskSequence(goal);
  for (let i = 0; i < taskSequence.length; i++) {
    const taskDef = taskSequence[i];
    if (!taskDef) continue;
    const [task] = await db
      .insert(tasksTable)
      .values({ sessionId: session.id, title: taskDef.title, description: taskDef.description, type: taskDef.type, status: "planned" })
      .returning();
    if (task) await logAudit(session.id, "task_created", `Task "${task.title}" created`, { taskId: task.id, type: task.type });
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
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  const agentRows = await db.select().from(agentsTable).where(eq(agentsTable.sessionId, session.id));
  const agents = await withActiveModels(agentRows);
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.sessionId, session.id)).orderBy(asc(tasksTable.id));
  const rawMessages = await db.select().from(messagesTable).where(eq(messagesTable.sessionId, session.id)).orderBy(asc(messagesTable.id));
  const agentNameMap = new Map(agentRows.map((a) => [a.id, a.name]));
  const messages = rawMessages.map((m) => formatMessage(m, agentNameMap));
  const [memory] = await db.select().from(memoryTable).where(eq(memoryTable.sessionId, session.id));
  const approvals = await db.select().from(approvalsTable).where(eq(approvalsTable.sessionId, session.id));
  res.json(serialize({ ...session, agents, tasks, messages, memory: memory ?? null, approvals }));
});

// Remaining routes continue below in the existing file.
