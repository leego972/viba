import { logger } from "./logger";

export interface CostPolicy {
  maxConcurrentTasksPerUser: number;
  maxAgentStepsPerTask: number;
  maxToolInvocationsPerTask: number;
  maxBrowserMinutesPerTask: number;
  maxRetriesPerTask: number;
  maxSafeBuildRunsPerTask: number;
  groqDefaultDailyMessages: number;
  runawayLoopThresholdSteps: number;
  stuckTaskTimeoutMs: number;
  queueMaxDepthPerUser: number;
}

export interface TaskCostState {
  taskId: string;
  userId: number;
  agentSteps: number;
  toolInvocations: number;
  browserMinutes: number;
  retries: number;
  safeBuildRuns: number;
  startedAt: number;
  lastProgressAt: number;
  status: "running" | "paused" | "completed" | "aborted";
  pauseReason?: string;
  provider?: string;
  isByok: boolean;
}

export interface CostControlStatus {
  policy: CostPolicy;
  activeTasks: TaskCostState[];
  runawayTasks: string[];
  stuckTasks: string[];
  queueDepthByUser: Record<string, number>;
  rawValuesReturned: false;
}

const DEFAULT_POLICY: CostPolicy = {
  maxConcurrentTasksPerUser: 3,
  maxAgentStepsPerTask: 200,
  maxToolInvocationsPerTask: 100,
  maxBrowserMinutesPerTask: 30,
  maxRetriesPerTask: 5,
  maxSafeBuildRunsPerTask: 10,
  groqDefaultDailyMessages: 500,
  runawayLoopThresholdSteps: 50,
  stuckTaskTimeoutMs: 10 * 60 * 1000,
  queueMaxDepthPerUser: 10,
};

let _policy: CostPolicy = { ...DEFAULT_POLICY };

const _tasks = new Map<string, TaskCostState>();

export function getPolicy(): CostPolicy {
  return { ..._policy };
}

export function updatePolicy(patch: Partial<CostPolicy>): CostPolicy {
  _policy = { ..._policy, ...patch };
  logger.info({ policy: _policy }, "CostControl: policy updated");
  return { ..._policy };
}

export function registerTask(
  taskId: string,
  userId: number,
  provider?: string,
  isByok = false,
): TaskCostState {
  const state: TaskCostState = {
    taskId,
    userId,
    agentSteps: 0,
    toolInvocations: 0,
    browserMinutes: 0,
    retries: 0,
    safeBuildRuns: 0,
    startedAt: Date.now(),
    lastProgressAt: Date.now(),
    status: "running",
    provider,
    isByok,
  };
  _tasks.set(taskId, state);
  return state;
}

export function getTaskState(taskId: string): TaskCostState | undefined {
  return _tasks.get(taskId);
}

export function recordStep(taskId: string): { allowed: boolean; reason?: string } {
  const state = _tasks.get(taskId);
  if (!state) return { allowed: false, reason: "Task not registered" };
  if (state.status !== "running") return { allowed: false, reason: `Task is ${state.status}` };

  state.agentSteps += 1;
  state.lastProgressAt = Date.now();

  if (state.agentSteps >= _policy.maxAgentStepsPerTask) {
    state.status = "paused";
    state.pauseReason = `Max agent steps (${_policy.maxAgentStepsPerTask}) reached`;
    logger.warn({ taskId, steps: state.agentSteps }, "CostControl: max steps reached, pausing");
    return { allowed: false, reason: state.pauseReason };
  }

  const recentWindow = state.agentSteps > _policy.runawayLoopThresholdSteps
    ? _policy.runawayLoopThresholdSteps
    : 0;
  if (recentWindow > 0 && state.agentSteps % _policy.runawayLoopThresholdSteps === 0) {
    logger.warn({ taskId, steps: state.agentSteps }, "CostControl: runaway loop threshold hit, check for stuck task");
  }

  return { allowed: true };
}

export function recordToolInvocation(taskId: string): { allowed: boolean; reason?: string } {
  const state = _tasks.get(taskId);
  if (!state) return { allowed: false, reason: "Task not registered" };
  if (state.status !== "running") return { allowed: false, reason: `Task is ${state.status}` };

  state.toolInvocations += 1;

  if (state.toolInvocations >= _policy.maxToolInvocationsPerTask) {
    state.status = "paused";
    state.pauseReason = `Max tool invocations (${_policy.maxToolInvocationsPerTask}) reached`;
    return { allowed: false, reason: state.pauseReason };
  }

  return { allowed: true };
}

export function recordBrowserTime(taskId: string, minutes: number): { allowed: boolean; reason?: string } {
  const state = _tasks.get(taskId);
  if (!state) return { allowed: false, reason: "Task not registered" };
  if (state.status !== "running" && state.status !== "paused") {
    return { allowed: false, reason: `Task is ${state.status}` };
  }

  state.browserMinutes += minutes;

  if (state.browserMinutes >= _policy.maxBrowserMinutesPerTask) {
    state.status = "paused";
    state.pauseReason = `Max browser minutes (${_policy.maxBrowserMinutesPerTask}) reached`;
    return { allowed: false, reason: state.pauseReason };
  }

  return { allowed: true };
}

export function pauseTaskForUserInput(taskId: string, reason: string): void {
  const state = _tasks.get(taskId);
  if (!state) return;
  state.status = "paused";
  state.pauseReason = reason;
  logger.info({ taskId, reason }, "CostControl: task paused for user input");
}

export function resumeTask(taskId: string): boolean {
  const state = _tasks.get(taskId);
  if (!state || state.status !== "paused") return false;
  state.status = "running";
  state.pauseReason = undefined;
  state.lastProgressAt = Date.now();
  return true;
}

export function completeTask(taskId: string): void {
  const state = _tasks.get(taskId);
  if (state) state.status = "completed";
}

export function getCostControlStatus(): CostControlStatus {
  const now = Date.now();
  const active = Array.from(_tasks.values());

  const runawayTasks = active
    .filter((t) => t.status === "running" && t.agentSteps > _policy.runawayLoopThresholdSteps * 3)
    .map((t) => t.taskId);

  const stuckTasks = active
    .filter(
      (t) =>
        t.status === "running" &&
        now - t.lastProgressAt > _policy.stuckTaskTimeoutMs,
    )
    .map((t) => t.taskId);

  const queueDepthByUser: Record<string, number> = {};
  for (const t of active) {
    if (t.status === "running" || t.status === "paused") {
      const key = String(t.userId);
      queueDepthByUser[key] = (queueDepthByUser[key] ?? 0) + 1;
    }
  }

  return {
    policy: getPolicy(),
    activeTasks: active,
    runawayTasks,
    stuckTasks,
    queueDepthByUser,
    rawValuesReturned: false,
  };
}

export function canStartTask(userId: number): { allowed: boolean; reason?: string } {
  const userActive = Array.from(_tasks.values()).filter(
    (t) => t.userId === userId && (t.status === "running" || t.status === "paused"),
  ).length;

  if (userActive >= _policy.maxConcurrentTasksPerUser) {
    return {
      allowed: false,
      reason: `Max concurrent tasks (${_policy.maxConcurrentTasksPerUser}) reached for user`,
    };
  }

  const userQueue = Array.from(_tasks.values()).filter(
    (t) => t.userId === userId,
  ).length;

  if (userQueue >= _policy.queueMaxDepthPerUser) {
    return {
      allowed: false,
      reason: `Queue depth limit (${_policy.queueMaxDepthPerUser}) reached for user`,
    };
  }

  return { allowed: true };
}
