import type { Agent, Task } from "@workspace/db";

export type CoordinationDecisionType =
  | "schedule"
  | "wait_for_dependencies"
  | "reassign"
  | "recover"
  | "blocked";

export interface CoordinationDecision {
  type: CoordinationDecisionType;
  taskId: number;
  agentId: number | null;
  score: number;
  reasons: string[];
}

export interface CoordinationPlan {
  runnableTaskIds: number[];
  blockedTaskIds: number[];
  parallelBatches: number[][];
  decisions: CoordinationDecision[];
}

const TERMINAL_STATUSES = new Set(["complete"]);
const ACTIVE_STATUSES = new Set(["in_progress"]);

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function words(value: string): Set<string> {
  return new Set(normalize(value).split(/\s+/).filter(Boolean));
}

function overlapScore(left: string[], right: string[]): number {
  const leftWords = new Set(left.flatMap((value) => [...words(value)]));
  const rightWords = new Set(right.flatMap((value) => [...words(value)]));
  let score = 0;
  for (const word of leftWords) if (rightWords.has(word)) score += 1;
  return score;
}

function isDependencySatisfied(task: Task, tasksById: ReadonlyMap<number, Task>): boolean {
  if (task.dependencyTaskId === null) return true;
  const dependency = tasksById.get(task.dependencyTaskId);
  return dependency ? TERMINAL_STATUSES.has(dependency.status) : false;
}

function hasActiveDependent(taskId: number, tasks: Task[]): boolean {
  return tasks.some((task) => task.dependencyTaskId === taskId && ACTIVE_STATUSES.has(task.status));
}

function agentScore(task: Task, agent: Agent): number {
  if (agent.satOutReason) return Number.NEGATIVE_INFINITY;
  if ((task.toolRequirements?.length ?? 0) > 0 && !agent.canUseTools) return Number.NEGATIVE_INFINITY;

  let score = 0;
  if (task.assignedAgentId === agent.id) score += 25;
  if (agent.canUseTools && (task.toolRequirements?.length ?? 0) > 0) score += 30;
  score += overlapScore(
    [task.type, task.title, task.description, ...(task.toolRequirements ?? [])],
    [agent.role, agent.provider, ...agent.capabilities],
  ) * 5;
  if (!agent.isMock) score += 3;
  return score;
}

export function selectBestAgent(task: Task, agents: Agent[]): { agent: Agent | null; score: number; reasons: string[] } {
  const ranked = agents
    .map((agent) => ({ agent, score: agentScore(task, agent) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score || left.agent.id - right.agent.id);

  const best = ranked[0];
  if (!best) {
    return { agent: null, score: 0, reasons: ["No participating operator satisfies the task requirements."] };
  }

  const reasons: string[] = [];
  if (task.assignedAgentId === best.agent.id) reasons.push("Preserves the existing operator assignment.");
  if ((task.toolRequirements?.length ?? 0) > 0) reasons.push("Selected operator satisfies required tool capabilities.");
  if (best.score > 0) reasons.push("Operator role and capabilities match the task content.");
  return { agent: best.agent, score: best.score, reasons };
}

function tasksConflict(left: Task, right: Task): boolean {
  if (left.id === right.id) return false;
  if (left.dependencyTaskId === right.id || right.dependencyTaskId === left.id) return true;
  if (left.assignedAgentId !== null && left.assignedAgentId === right.assignedAgentId) return true;
  return false;
}

export function buildParallelBatches(tasks: Task[]): number[][] {
  const batches: Task[][] = [];
  for (const task of tasks) {
    const target = batches.find((batch) => batch.every((candidate) => !tasksConflict(task, candidate)));
    if (target) target.push(task);
    else batches.push([task]);
  }
  return batches.map((batch) => batch.map((task) => task.id));
}

export function buildCoordinationPlan(input: {
  tasks: Task[];
  agents: Agent[];
  now?: Date;
  stalledAfterMs?: number;
}): CoordinationPlan {
  const now = input.now ?? new Date();
  const stalledAfterMs = input.stalledAfterMs ?? 15 * 60_000;
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const runnable: Task[] = [];
  const blockedTaskIds: number[] = [];
  const decisions: CoordinationDecision[] = [];

  for (const task of input.tasks) {
    if (TERMINAL_STATUSES.has(task.status)) continue;

    if (task.status === "in_progress") {
      const ageMs = now.getTime() - task.updatedAt.getTime();
      if (ageMs >= stalledAfterMs && !hasActiveDependent(task.id, input.tasks)) {
        const selection = selectBestAgent({ ...task, assignedAgentId: null }, input.agents);
        decisions.push({
          type: "recover",
          taskId: task.id,
          agentId: selection.agent?.id ?? null,
          score: selection.score,
          reasons: [`Task has been in progress for ${Math.round(ageMs / 60_000)} minutes without completion.`, ...selection.reasons],
        });
      }
      continue;
    }

    if (task.status !== "planned" && task.status !== "blocked_needs_tools") continue;
    if (!isDependencySatisfied(task, tasksById)) {
      blockedTaskIds.push(task.id);
      decisions.push({
        type: "wait_for_dependencies",
        taskId: task.id,
        agentId: null,
        score: 0,
        reasons: [`Dependency task ${task.dependencyTaskId} is not complete.`],
      });
      continue;
    }

    const selection = selectBestAgent(task, input.agents);
    if (!selection.agent) {
      blockedTaskIds.push(task.id);
      decisions.push({ type: "blocked", taskId: task.id, agentId: null, score: 0, reasons: selection.reasons });
      continue;
    }

    const decisionType = task.assignedAgentId !== null && task.assignedAgentId !== selection.agent.id
      ? "reassign"
      : "schedule";
    const plannedTask = { ...task, assignedAgentId: selection.agent.id };
    runnable.push(plannedTask);
    decisions.push({
      type: decisionType,
      taskId: task.id,
      agentId: selection.agent.id,
      score: selection.score,
      reasons: selection.reasons,
    });
  }

  runnable.sort((left, right) => {
    const leftHandoff = left.dependencyTaskId !== null && tasksById.get(left.dependencyTaskId)?.status === "blocked_needs_tools";
    const rightHandoff = right.dependencyTaskId !== null && tasksById.get(right.dependencyTaskId)?.status === "blocked_needs_tools";
    if (leftHandoff !== rightHandoff) return leftHandoff ? -1 : 1;
    return left.id - right.id;
  });

  return {
    runnableTaskIds: runnable.map((task) => task.id),
    blockedTaskIds: [...new Set(blockedTaskIds)].sort((a, b) => a - b),
    parallelBatches: buildParallelBatches(runnable),
    decisions,
  };
}
