import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { and, eq } from "drizzle-orm";
import { agentsTable, db, tasksTable } from "@workspace/db";
import { runFullWorkflow, runNextAgentStep } from "../lib/agentLoop";
import { fallbackStatus, resetFallbackPool, returnTaskToPool } from "../lib/fallbackPool";
import { confirmBrowserSession, getBrowserSession, listBrowserSessions, revokeBrowserSession, startBrowserSession } from "../lib/browserSessionHandoff";

const router: IRouter = Router();

type PoolUpdate = {
  messageId: number;
  taskId: number;
  provider: string;
  reason: string;
  alternativeAvailable: boolean;
};

function idParam(value: string | undefined): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function safeHttpUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function needsPool(content: string): boolean {
  const lower = content.toLowerCase();
  return lower.includes("[simulated") || lower.includes("timed out") || lower.includes("queued for retry");
}

async function poolSignals(sessionId: number, messages: Array<{ id: number; taskId: number | null; agentId: number | null; content: string }>): Promise<PoolUpdate[]> {
  const updates: PoolUpdate[] = [];
  for (const message of messages) {
    if (!message.taskId || !message.agentId || !needsPool(message.content)) continue;
    const [[task], [agent]] = await Promise.all([
      db.select().from(tasksTable).where(and(eq(tasksTable.sessionId, sessionId), eq(tasksTable.id, message.taskId))),
      db.select().from(agentsTable).where(and(eq(agentsTable.sessionId, sessionId), eq(agentsTable.id, message.agentId))),
    ]);
    if (!task || !agent) continue;
    const reason = message.content.toLowerCase().includes("timed out") ? "timeout" : "provider_unavailable";
    const returned = await returnTaskToPool({ sessionId, task, agent, reason, partialWork: message.content, error: `message:${message.id}` });
    if (returned.alternativeAvailable) {
      await db.update(agentsTable).set({ satOutReason: `temporary provider cooldown: ${reason}` }).where(and(eq(agentsTable.sessionId, sessionId), eq(agentsTable.provider, agent.provider)));
    }
    updates.push({ messageId: message.id, taskId: task.id, provider: agent.provider, reason, alternativeAvailable: returned.alternativeAvailable });
  }
  return updates;
}

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/sessions/:id/provider-health", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  if (!id) { res.status(400).json({ error: "valid session id required" }); return; }
  res.json(await fallbackStatus(id));
});

router.post("/sessions/:id/provider-reset", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  if (!id) { res.status(400).json({ error: "valid session id required" }); return; }
  await resetFallbackPool(id);
  await db.update(agentsTable).set({ satOutReason: null }).where(eq(agentsTable.sessionId, id));
  res.json({ ok: true, message: "Provider cooldown flags and fallback health records cleared for this session." });
});

router.post("/sessions/:id/run-next-resilient", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  if (!id) { res.status(400).json({ error: "valid session id required" }); return; }
  const result = await runNextAgentStep(id);
  const poolUpdates = await poolSignals(id, result.newMessages);
  res.json({ ...result, poolUpdates, resilient: true });
});

router.post("/sessions/:id/run-full-resilient", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  if (!id) { res.status(400).json({ error: "valid session id required" }); return; }
  const result = await runFullWorkflow(id);
  const poolUpdates = await poolSignals(id, result.newMessages);
  res.json({ ...result, poolUpdates, resilient: true });
});

router.get("/browser-sessions", async (req, res): Promise<void> => {
  res.json({ sessions: await listBrowserSessions(userId(req)) });
});

router.post("/browser-sessions/start", async (req, res): Promise<void> => {
  const body = req.body as { provider?: unknown; startUrl?: unknown; ttlHours?: unknown };
  const provider = typeof body.provider === "string" && body.provider.trim() ? body.provider.trim() : "custom";
  const startUrl = safeHttpUrl(body.startUrl);
  if (!startUrl) { res.status(400).json({ error: "valid startUrl required" }); return; }
  const ttlHours = typeof body.ttlHours === "number" ? body.ttlHours : undefined;
  const record = await startBrowserSession({ userId: userId(req), provider, startUrl, ttlHours });
  res.status(201).json({ ok: true, session: record, instruction: "Open startUrl in a temporary local browser profile, log in manually, then confirm the profile reference." });
});

router.get("/browser-sessions/:id/status", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  if (!id) { res.status(400).json({ error: "valid browser session id required" }); return; }
  res.json({ session: await getBrowserSession({ id, userId: userId(req) }) });
});

router.post("/browser-sessions/:id/confirm", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  if (!id) { res.status(400).json({ error: "valid browser session id required" }); return; }
  const body = req.body as { profileRef?: unknown };
  const profileRef = typeof body.profileRef === "string" ? body.profileRef.trim() : "";
  if (!profileRef) { res.status(400).json({ error: "profileRef required" }); return; }
  res.json({ ok: true, session: await confirmBrowserSession({ id, userId: userId(req), profileRef }) });
});

router.post("/browser-sessions/:id/revoke", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  if (!id) { res.status(400).json({ error: "valid browser session id required" }); return; }
  res.json({ ok: true, session: await revokeBrowserSession({ id, userId: userId(req) }) });
});

export default router;
