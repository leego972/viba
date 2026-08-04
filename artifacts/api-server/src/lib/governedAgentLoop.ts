import { db, auditLogsTable, sessionsTable, tasksTable } from "@workspace/db";
import type { Task } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import {
  runFullWorkflow as runRawFullWorkflow,
  runNextAgentStep as runRawNextAgentStep,
} from "./agentLoop";
import {
  authorizeTaskExecution,
  releaseTaskReservations,
  reserveContractResources,
} from "./governanceStore";

async function logGovernanceAudit(
  sessionId: number,
  eventType: string,
  description: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditLogsTable).values({ sessionId, eventType, description, metadata });
}

async function findNextPlannedTask(sessionId: number): Promise<Task | null> {
  const tasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.sessionId, sessionId))
    .orderBy(asc(tasksTable.id));

  const blockedTaskIds = new Set(
    tasks.filter((task) => task.status === "blocked_needs_tools").map((task) => task.id),
  );
  return tasks.find((task) =>
    task.status === "planned" &&
    task.dependencyTaskId !== null &&
    blockedTaskIds.has(task.dependencyTaskId),
  ) ?? tasks.find((task) => task.status === "planned") ?? null;
}

export async function runNextAgentStep(
  sessionId: number,
  userId = 0,
): ReturnType<typeof runRawNextAgentStep> {
  const nextTask = await findNextPlannedTask(sessionId);
  if (!nextTask) return runRawNextAgentStep(sessionId, userId);

  const requestedAgentId = nextTask.assignedAgentId ?? 0;
  const authorization = await authorizeTaskExecution({
    taskId: nextTask.id,
    sessionId,
    agentId: requestedAgentId,
  });

  await logGovernanceAudit(
    sessionId,
    authorization.allowed ? "governance_execution_authorized" : "governance_execution_blocked",
    authorization.reason,
    {
      taskId: nextTask.id,
      contractId: authorization.contract?.id ?? null,
      contractVersion: authorization.contract?.version ?? null,
      governanceMode: authorization.mode,
    },
  );

  if (!authorization.allowed) {
    await db
      .update(tasksTable)
      .set({ status: "review", blockedReason: authorization.reason })
      .where(eq(tasksTable.id, nextTask.id));
    return {
      newMessages: [],
      updatedTasks: [{ ...nextTask, status: "review", blockedReason: authorization.reason } as Task],
      approvalRequired: false,
      approval: null,
    };
  }

  if (authorization.contract) await reserveContractResources(authorization.contract);
  const result = await runRawNextAgentStep(sessionId, userId);
  const completed = result.updatedTasks.some((task) => task.id === nextTask.id && task.status === "complete");
  if (completed) await releaseTaskReservations(nextTask.id);
  return result;
}

export async function runFullWorkflow(
  sessionId: number,
  userId = 0,
): Promise<Awaited<ReturnType<typeof runRawFullWorkflow>>> {
  const allNewMessages: Awaited<ReturnType<typeof runRawNextAgentStep>>["newMessages"] = [];
  const allUpdatedTasks: Task[] = [];
  let stepsRun = 0;
  let approvalRequired = false;
  let approval: Awaited<ReturnType<typeof runRawNextAgentStep>>["approval"] = null;

  for (let index = 0; index < 12; index += 1) {
    const result = await runNextAgentStep(sessionId, userId);
    allNewMessages.push(...result.newMessages);
    allUpdatedTasks.push(...result.updatedTasks);
    stepsRun += 1;

    if (result.approvalRequired) {
      approvalRequired = true;
      approval = result.approval;
      break;
    }
    if (result.newMessages.length === 0 && result.updatedTasks.length === 0) break;

    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    if (session?.status !== "active") break;
  }

  return { allNewMessages, allUpdatedTasks, approvalRequired, approval, stepsRun } as unknown as Awaited<ReturnType<typeof runRawFullWorkflow>>;
}
