import { createHash } from "node:crypto";

export type ExecutionPhase = "discover" | "create" | "verify" | "deliver";

export type ExecutionTask = {
  id: string;
  title: string;
  type: string;
  phase: ExecutionPhase;
  dependsOn?: string[];
  toolRequirements?: string[];
};

export type CompletionEvidence = {
  toolCalls?: number;
  mutations?: number;
  checks?: number;
  artifactIds?: string[];
  fileChanges?: string[];
  sourceUrls?: string[];
  dryRun?: boolean;
  error?: string | null;
};

export type CompletionDecision = {
  complete: boolean;
  status: "completed" | "dry_run" | "blocked" | "failed";
  reasons: string[];
};

const MUTATING_TASK_TYPES = new Set([
  "build",
  "deployment_approval",
  "file_write",
  "repository_patch",
  "email_send",
  "calendar_write",
]);

const VERIFYING_TASK_TYPES = new Set([
  "code_review",
  "ux_review",
  "final_qa",
  "security_review",
  "deployment_approval",
]);

export function buildExecutionWaves(tasks: ExecutionTask[]): ExecutionTask[][] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const remaining = new Set(tasks.map((task) => task.id));
  const completed = new Set<string>();
  const waves: ExecutionTask[][] = [];

  for (const task of tasks) {
    for (const dependency of task.dependsOn ?? []) {
      if (!byId.has(dependency)) {
        throw new Error(`Task ${task.id} depends on unknown task ${dependency}.`);
      }
      if (dependency === task.id) {
        throw new Error(`Task ${task.id} cannot depend on itself.`);
      }
    }
  }

  while (remaining.size > 0) {
    const wave = tasks.filter((task) => {
      if (!remaining.has(task.id)) return false;
      return (task.dependsOn ?? []).every((dependency) => completed.has(dependency));
    });

    if (wave.length === 0) {
      throw new Error("Task dependency graph contains a cycle.");
    }

    waves.push(wave);
    for (const task of wave) {
      remaining.delete(task.id);
      completed.add(task.id);
    }
  }

  return waves;
}

export function verifyTaskCompletion(task: Pick<ExecutionTask, "type" | "toolRequirements">, evidence: CompletionEvidence): CompletionDecision {
  const reasons: string[] = [];

  if (evidence.error) {
    return { complete: false, status: "failed", reasons: [evidence.error] };
  }

  const toolRequired = (task.toolRequirements?.length ?? 0) > 0;
  const mutating = MUTATING_TASK_TYPES.has(task.type);
  const verifying = VERIFYING_TASK_TYPES.has(task.type);
  const toolCalls = evidence.toolCalls ?? 0;
  const mutations = evidence.mutations ?? 0;
  const checks = evidence.checks ?? 0;
  const artifacts = evidence.artifactIds?.length ?? 0;
  const fileChanges = evidence.fileChanges?.length ?? 0;
  const sources = evidence.sourceUrls?.length ?? 0;

  if (toolRequired && toolCalls === 0) reasons.push("Required tools were not invoked.");
  if (mutating && mutations === 0 && fileChanges === 0 && artifacts === 0) {
    reasons.push("No mutation, changed file, or produced artifact proves the requested work occurred.");
  }
  if (verifying && checks === 0) reasons.push("No verification check was recorded.");
  if (task.type === "research" && sources === 0) reasons.push("No source evidence was recorded.");

  if (evidence.dryRun) {
    return {
      complete: false,
      status: "dry_run",
      reasons: reasons.length ? reasons : ["Only a dry run was completed; no live mutation occurred."],
    };
  }

  return reasons.length
    ? { complete: false, status: "blocked", reasons }
    : { complete: true, status: "completed", reasons: [] };
}

export function createSemanticCacheKey(input: {
  projectId?: string | number | null;
  commit?: string | null;
  taskType: string;
  toolInputs: unknown;
  freshnessBucket?: string | null;
}): string {
  const canonical = JSON.stringify({
    projectId: input.projectId ?? null,
    commit: input.commit ?? null,
    taskType: input.taskType,
    toolInputs: input.toolInputs,
    freshnessBucket: input.freshnessBucket ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function requiresExplicitApproval(action: string): boolean {
  const normalized = action.trim().toLowerCase();
  const mutatingActions = [
    /\bdelete\b/,
    /\bdestroy\b/,
    /\bpurge\b/,
    /\brollback\b/,
    /\bdeploy\b/,
    /\bpublish\b/,
    /\bsend\b/,
    /\bcharge\b/,
    /\bpurchase\b/,
    /\bmerge\b/,
    /\bwrite[_ -]?env\b/,
    /\bdns[_ -]?(?:write|delete)\b/,
  ];
  return mutatingActions.some((pattern) => pattern.test(normalized));
}
