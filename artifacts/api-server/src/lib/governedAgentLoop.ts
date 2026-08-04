import { db, agentsTable, auditLogsTable, sessionsTable, tasksTable } from "@workspace/db";
import type { Task } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  runFullWorkflow as runRawFullWorkflow,
  runNextAgentStep as runRawNextAgentStep,
} from "./agentLoop";
import { authorizeScheduledContract } from "./architectureImpactGate";
import { refreshSessionArchitectureTwin } from "./architectureTwinService";
import { buildCoordinationPlan, type CoordinationDecision } from "./autonomousCoordinator";
import {
  captureEngineeringLesson,
  injectEngineeringMemoryContext,
} from "./engineeringMemoryIntegration";
import {
  evaluateExecutionAuthorization,
  getActiveTaskContract,
  releaseTaskReservations,
  reserveContractResources,
} from "./governanceStore";

const COORDINATION_WAIT_STATUS = "coordination_wait";

async function logGovernanceAudit(
  sessionId: number,
  eventType: string,
  description: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditLogsTable).values({ sessionId, eventType, description, metadata });
}

async function logCoordinationDecision(sessionId: number, decision: CoordinationDecision): Promise<void> {
  await logGovernanceAudit(
    sessionId,
    `coordination_${decision.type}`,
    decision.reasons.join(" ") || `Coordination decision: ${decision.type}`,
    {
      taskId: decision.taskId,
      agentId: decision.agentId,
      score: decision.score,
      decisionType: decision.type,
    },
  );
}

async function prepareCoordinatedTask(sessionId: number): Promise<Task | null> {
  await db
    .update(tasksTable)
    .set({ status: "planned", blockedReason: null })
    .where(inArray(
      tasksTable.id,
      db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(and(
          eq(tasksTable.sessionId, sessionId),
          eq(tasksTable.status, COORDINATION_WAIT_STATUS),
        )),
    ));

  const [tasks, agents] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.sessionId, sessionId)).orderBy(asc(tasksTable.id)),
    db.select().from(agentsTable).where(eq(agentsTable.sessionId, sessionId)),
  ]);
  const activeAgents = agents.filter((agent) => !agent.satOutReason);
  const plan = buildCoordinationPlan({ tasks, agents: activeAgents });

  for (const decision of plan.decisions) {
    await logCoordinationDecision(sessionId, decision);

    if (decision.type === "recover") {
      const task = tasks.find((candidate) => candidate.id === decision.taskId);
      await db
        .update(tasksTable)
        .set({
          status: "planned",
          assignedAgentId: decision.agentId,
          blockedReason: decision.reasons.join(" "),
        })
        .where(eq(tasksTable.id, decision.taskId));
      await captureEngineeringLesson({
        sessionId,
        taskId: decision.taskId,
        lessonType: "stalled_task_recovery",
        severity: "medium",
        title: `Recovered stalled task: ${task?.title ?? decision.taskId}`,
        observation: decision.reasons.join(" "),
        rootCause: "The task remained in progress beyond the coordination stall threshold.",
        correctiveAction: decision.agentId === null
          ? "Return the task to planning for operator reassessment."
          : `Return the task to planning and assign operator ${decision.agentId}.`,
        preventionRules: [
          "Apply bounded execution timeouts.",
          "Persist progress heartbeats for long-running tasks.",
          "Re-evaluate operator suitability when a task stalls.",
        ],
        affectedModules: task?.type ? [task.type] : [],
        evidence: { coordinationDecision: decision },
        resolved: true,
      });
    } else if (decision.type === "reassign") {
      await db
        .update(tasksTable)
        .set({ assignedAgentId: decision.agentId, blockedReason: null })
        .where(eq(tasksTable.id, decision.taskId));
    } else if (decision.type === "wait_for_dependencies") {
      await db
        .update(tasksTable)
        .set({ status: COORDINATION_WAIT_STATUS, blockedReason: decision.reasons.join(" ") })
        .where(eq(tasksTable.id, decision.taskId));
    } else if (decision.type === "blocked") {
      await db
        .update(tasksTable)
        .set({ status: "review", blockedReason: decision.reasons.join(" ") })
        .where(eq(tasksTable.id, decision.taskId));
    }
  }

  const refreshedTasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.sessionId, sessionId))
    .orderBy(asc(tasksTable.id));
  const refreshedPlan = buildCoordinationPlan({ tasks: refreshedTasks, agents: activeAgents });
  const nextTaskId = refreshedPlan.runnableTaskIds[0];
  if (nextTaskId === undefined) return null;

  const nextTask = refreshedTasks.find((task) => task.id === nextTaskId) ?? null;
  const assignment = refreshedPlan.decisions.find((decision) =>
    decision.taskId === nextTaskId && (decision.type === "schedule" || decision.type === "reassign"),
  );
  if (nextTask && assignment?.agentId !== null && assignment?.agentId !== undefined) {
    await db
      .update(tasksTable)
      .set({ assignedAgentId: assignment.agentId, blockedReason: null })
      .where(eq(tasksTable.id, nextTask.id));
    return { ...nextTask, assignedAgentId: assignment.agentId };
  }
  return nextTask;
}

export async function runNextAgentStep(
  sessionId: number,
  userId = 0,
): ReturnType<typeof runRawNextAgentStep> {
  const nextTask = await prepareCoordinatedTask(sessionId);
  if (!nextTask) return runRawNextAgentStep(sessionId, userId);

  const contract = await getActiveTaskContract(nextTask.id);
  const mode = process.env.VIBA_GOVERNANCE_MODE?.toLowerCase() === "audit" ? "audit" : "enforce";
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

    await injectEngineeringMemoryContext({
      sessionId,
      taskTitle: nextTask.title,
      taskDescription: nextTask.description,
      modules: authorization.contract.allowedPaths,
      interfaces: authorization.contract.ownedInterfaces,
    });
    await reserveContractResources(authorization.contract);
  } else {
    await injectEngineeringMemoryContext({
      sessionId,
      taskTitle: nextTask.title,
      taskDescription: nextTask.description,
      modules: [nextTask.type],
    });
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