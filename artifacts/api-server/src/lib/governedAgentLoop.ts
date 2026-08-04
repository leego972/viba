import { db, auditLogsTable, sessionsTable, tasksTable } from "@workspace/db";
import type { Task } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import {
  runFullWorkflow as runRawFullWorkflow,
  runNextAgentStep as runRawNextAgentStep,
} from "./agentLoop";
import { authorizeScheduledContract } from "./architectureImpactGate";
import { refreshSessionArchitectureTwin } from "./architectureTwinService";
import {
  evaluateExecutionAuthorization,
  getActiveTaskContract,
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

  const contract = await getActiveTaskContract(nextTask.id);
  const mode = process.env.VIBA_GOVERNANCE_MODE?.toLowerCase() === "enforce" ? "enforce" : "audit";
  const authorization = evaluateExecutionAuthorization({
    taskId: nextTask.id,
    sessionId,
    agentId: contract?.assignedAgentId ?? nextTask.assignedAgentId ?? 0,
    mode,
    contract,
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

  if (authorization.contract) {
    const snapshot = await refreshSessionArchitectureTwin({ sessionId });
    const impact = await authorizeScheduledContract({ sessionId, contract: authorization.contract });
    const impactReason = impact?.reasons.join(" ") || "Architecture impact simulation completed.";

    await logGovernanceAudit(
      sessionId,
      impact?.allowed === false ? "architecture_execution_blocked" : "architecture_execution_authorized",
      impactReason,
      {
        taskId: nextTask.id,
        snapshotVersion: snapshot.version,
        action: impact?.action ?? "approve",
        riskLevel: impact?.report.riskLevel ?? "low",
        riskScore: impact?.report.riskScore ?? 0,
        conflictingTaskIds: impact?.report.conflictingTaskIds ?? [],
        requiredReviews: impact?.report.requiredReviews ?? [],
      },
    );

    if (impact && !impact.allowed) {
      const blockedReason = impact.conditions.join(" ") || impactReason;
      await db
        .update(tasksTable)
        .set({ status: "review", blockedReason })
        .where(eq(tasksTable.id, nextTask.id));
      return {
        newMessages: [],
        updatedTasks: [{ ...nextTask, status: "review", blockedReason } as Task],
        approvalRequired: false,
        approval: null,
      };
    }

    await reserveContractResources(authorization.contract);
  }

  const result = await runRawNextAgentStep(sessionId, userId);
  const finished = result.updatedTasks.some((task) =>
    task.id === nextTask.id && (task.status === "complete" || task.status === "review"),
  );
  if (finished) {
    await releaseTaskReservations(nextTask.id);
    await refreshSessionArchitectureTwin({ sessionId });
  }
  return result;
}

export async function runFullWorkflow(
  sessionId: number,
  userId = 0,
): Promise<Awaited<ReturnType<typeof runRawFullWorkflow>>> {
  const newMessages: Awaited<ReturnType<typeof runRawNextAgentStep>>["newMessages"] = [];
  const updatedTasks: Task[] = [];
  let stepsRun = 0;
  let approvalRequired = false;
  let approval: Awaited<ReturnType<typeof runRawNextAgentStep>>["approval"] = null;

  for (let index = 0; index < 12; index += 1) {
    const result = await runNextAgentStep(sessionId, userId);
    newMessages.push(...result.newMessages);
    updatedTasks.push(...result.updatedTasks);
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

  return { newMessages, updatedTasks, approvalRequired, approval, stepsRun };
}
