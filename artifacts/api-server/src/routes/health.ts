import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { and, eq } from "drizzle-orm";
import { agentsTable, db, tasksTable } from "@workspace/db";
import { runFullWorkflow, runNextAgentStep } from "../lib/agentLoop";
import { fallbackStatus, returnTaskToPool } from "../lib/fallbackPool";

const router: IRouter = Router();

function idParam(value: string | undefined): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function needsPool(content: string): boolean {
  const lower = content.toLowerCase();
  return lower.includes("[simulated") || lower.includes("timed out") || lower.includes("queued for retry");
}

async function poolSignals(sessionId: number, messages: Array<{ id: number; taskId: number | null; agentId: number | null; content: string }>) {
  const updates = [];
  for (const message of messages) {
    if (!message.taskId || !message.agentId || !needsPool(message.content)) continue;
    const [[task], [agent]] = await Promise.all([
      db.select().from(tasksTable).where(and(eq(tasksTable.sessionId, sessionId), eq(tasksTable.id, message.taskId))),
      db.select().from(agentsTable).where(and(eq(agentsTable.sessionId, sessionId), eq(agentsTable.id, message.agentId))),
    ]);
    if (!task || !agent) continue;
    const reason = message.content.toLowerCase().includes("timed out") ? "timeout" : "provider_unavailable";
    const returned = await returnTaskToPool({ sessionId, task, agent, reason, partialWork: message.content, error: `message:${message.id}` });
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

export default router;
