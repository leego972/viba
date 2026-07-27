import { db, agentsTable, messagesTable, tasksTable } from "@workspace/db";
import type { Agent, Task } from "@workspace/db";
import { eq } from "drizzle-orm";
import { routeTask } from "./taskRouter";
import { logVibaEvent } from "./vibaVault";

export type PlannedTask = {
  title: string;
  type: string;
  description: string;
  toolRequirements: string[];
  phase: "discover" | "create" | "verify" | "deliver";
};

type AssignmentPreview = {
  taskTitle: string;
  taskType: string;
  phase: PlannedTask["phase"];
  agentId: number | null;
  agentName: string | null;
  provider: string | null;
  role: string | null;
  toolRequirements: string[];
};

export type InstructionPlan = {
  complexity: "simple" | "standard" | "complex";
  executionMode: "single_agent" | "multi_agent";
  estimatedAgentCalls: number;
  tasks: PlannedTask[];
};

function cleanInstruction(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function includesAny(text: string, phrases: string[]): boolean {
  const lower = text.toLowerCase();
  return phrases.some((phrase) => lower.includes(phrase));
}

function includesWord(text: string, words: string[]): boolean {
  return words.some((word) => new RegExp(`\\b${word}\\b`, "i").test(text));
}

function inferToolRequirements(type: string, instruction: string): string[] {
  const requirements = new Set<string>();
  const lower = instruction.toLowerCase();

  const needsCurrentWeb =
    type === "research" ||
    includesWord(lower, ["latest", "online", "website", "web"]) ||
    includesAny(lower, ["current price", "current pricing", "current news", "current market", "public source"]);

  if (needsCurrentWeb) requirements.add("web_search");
  if (includesWord(lower, ["github", "repository", "repo", "branch", "commit", "codebase"]) || includesAny(lower, ["pull request"])) {
    requirements.add("github");
  }
  if (includesWord(lower, ["render", "deploy", "deployment", "production"]) || includesAny(lower, ["environment variable", "env var"])) {
    requirements.add("deployment");
  }
  if (includesWord(lower, ["browser", "click", "form", "login", "screenshot"]) || includesAny(lower, ["website check", "ui check"])) {
    requirements.add("browser");
  }
  if (includesWord(lower, ["upload", "download", "file", "storage", "bucket", "r2"])) {
    requirements.add("storage");
  }

  return [...requirements];
}

function estimateComplexity(instruction: string, candidateCount: number): InstructionPlan["complexity"] {
  const wordCount = instruction.split(/\s+/).filter(Boolean).length;
  const explicitMultiStep = /\b(first|then|after that|and then|step \d+|multiple steps?|full audit|entire system|complete system)\b/i.test(instruction);
  if (candidateCount >= 4 || wordCount > 90 || explicitMultiStep) return "complex";
  if (candidateCount >= 2 || wordCount > 35) return "standard";
  return "simple";
}

function addUniqueTask(
  tasks: PlannedTask[],
  task: Omit<PlannedTask, "toolRequirements">,
  instruction: string,
): void {
  if (tasks.some((existing) => existing.type === task.type)) return;
  tasks.push({
    ...task,
    toolRequirements: inferToolRequirements(task.type, instruction),
  });
}

/**
 * Produce the smallest useful execution plan.
 *
 * Work is deduplicated by task type, and a separate synthesis task is added
 * only when multiple specialist outputs need to be merged.
 */
export function planInstruction(instruction: string): InstructionPlan {
  const cleaned = cleanInstruction(instruction);
  const tasks: PlannedTask[] = [];
  const lower = cleaned.toLowerCase();

  if (
    includesWord(lower, ["research", "lookup", "find", "compare", "price", "pricing", "competitor", "market", "latest", "web"]) ||
    includesAny(lower, ["look up", "public source", "current price", "current pricing", "current news", "current market"])
  ) {
    addUniqueTask(tasks, {
      title: "Research and Evidence Gathering",
      type: "research",
      phase: "discover",
      description: `Gather only the evidence needed to complete this instruction, use current sources when required, and avoid repeating facts already available in session context: ${cleaned}`,
    }, cleaned);
  }

  if (includesWord(lower, ["design", "creative", "brand", "logo", "copy", "advert", "ux", "ui", "landing", "visual"])) {
    addUniqueTask(tasks, {
      title: "Creative and UX Direction",
      type: "creative_direction",
      phase: "create",
      description: `Create the required original creative, UX, copy, or brand output. Reuse approved project context and do not generate alternate directions unless requested: ${cleaned}`,
    }, cleaned);
  }

  if (includesWord(lower, ["build", "code", "repo", "backend", "frontend", "api", "database", "fix", "debug", "implement", "wire", "connect", "integration", "orchestrator", "system"])) {
    addUniqueTask(tasks, {
      title: "Build and Implementation",
      type: "build",
      phase: "create",
      description: `Implement the requested technical work with the smallest safe change set. Inspect existing code before creating new abstractions and use available tools directly when permitted: ${cleaned}`,
    }, cleaned);
  }

  if (includesWord(lower, ["review", "audit", "test", "qa", "bug", "error", "security", "check", "validate", "verify"])) {
    addUniqueTask(tasks, {
      title: "Review and Validation",
      type: "code_review",
      phase: "verify",
      description: `Validate the relevant work, run the available checks, identify concrete defects, and fix or report only substantiated issues: ${cleaned}`,
    }, cleaned);
  }

  if (
    includesWord(lower, ["deploy", "render", "railway", "docker", "release", "production", "environment", "github", "commit"]) ||
    includesAny(lower, ["env vars", "pull request"])
  ) {
    addUniqueTask(tasks, {
      title: "Deployment and Connector Check",
      type: "deployment_approval",
      phase: "verify",
      description: `Check the relevant deployment, connector, environment, repository, and release requirements. Do not mutate production without the required approval: ${cleaned}`,
    }, cleaned);
  }

  if (tasks.length === 0) {
    addUniqueTask(tasks, {
      title: "Complete User Instruction",
      type: "planning",
      phase: "create",
      description: `Understand and complete the instruction directly. Ask the user only when a genuinely required value cannot be discovered from available context or tools: ${cleaned}`,
    }, cleaned);
  }

  const complexity = estimateComplexity(cleaned, tasks.length);
  const specialistTaskCount = tasks.length;

  if (specialistTaskCount > 1) {
    tasks.push({
      title: "Final Merge and User Answer",
      type: "final_qa",
      phase: "deliver",
      toolRequirements: [],
      description: `Merge the specialist outputs into one direct answer. Remove duplication, resolve conflicts using evidence, state any unverified limitation, and do not repeat internal process commentary. Original instruction: ${cleaned}`,
    });
  }

  return {
    complexity,
    executionMode: specialistTaskCount === 1 ? "single_agent" : "multi_agent",
    estimatedAgentCalls: tasks.length,
    tasks,
  };
}

/** Existing callers receive the same task-array shape. */
export function decomposeInstruction(instruction: string): PlannedTask[] {
  return planInstruction(instruction).tasks;
}

function previewAssignments(tasks: PlannedTask[], agents: Agent[]): AssignmentPreview[] {
  return tasks.map((task, index) => {
    const pseudoTask = {
      id: index + 1,
      type: task.type,
      toolRequirements: task.toolRequirements,
    } as unknown as Task;
    const agent = routeTask(pseudoTask, agents);
    return {
      taskTitle: task.title,
      taskType: task.type,
      phase: task.phase,
      agentId: agent?.id ?? null,
      agentName: agent?.name ?? null,
      provider: agent?.provider ?? null,
      role: agent?.role ?? null,
      toolRequirements: task.toolRequirements,
    };
  });
}

export async function orchestrateUserInstruction(input: { sessionId: number; content: unknown; userId?: number | null }) {
  const instruction = cleanInstruction(input.content);
  if (!instruction) throw new Error("Instruction text is required.");

  const agents = await db.select().from(agentsTable).where(eq(agentsTable.sessionId, input.sessionId));
  if (!agents.length) throw new Error("No agents exist in this session.");

  const plan = planInstruction(instruction);

  const [userMessage] = await db.insert(messagesTable).values({
    sessionId: input.sessionId,
    agentId: null,
    role: "user",
    provider: null,
    content: instruction,
    taskId: null,
    agentName: "User",
    agentRole: "Human",
    messageType: "input",
    metadata: { source: "instruction_orchestrator" },
  }).returning();

  const createdTasks: Task[] = [];
  for (const task of plan.tasks) {
    const [created] = await db.insert(tasksTable).values({
      sessionId: input.sessionId,
      title: task.title,
      description: task.description,
      type: task.type,
      status: "planned",
      toolRequirements: task.toolRequirements,
    }).returning();
    if (created) createdTasks.push(created);
  }

  const assignments = previewAssignments(plan.tasks, agents);
  const phaseSummary = assignments.map((assignment) => ({
    phase: assignment.phase,
    task: assignment.taskTitle,
    agent: assignment.agentName,
    provider: assignment.provider,
  }));

  const [delegationMessage] = await db.insert(messagesTable).values({
    sessionId: input.sessionId,
    agentId: null,
    role: "assistant",
    provider: "viba",
    content: plan.executionMode === "single_agent"
      ? "VIBA selected one best-fit agent for a direct execution path, avoiding an unnecessary synthesis call."
      : `VIBA created a ${plan.complexity} ${plan.tasks.length}-task execution plan and assigned each task to the best available specialist.`,
    taskId: null,
    agentName: "VIBA Orchestrator",
    agentRole: "Coordinator",
    messageType: "context",
    metadata: {
      assignments,
      phaseSummary,
      complexity: plan.complexity,
      executionMode: plan.executionMode,
      estimatedAgentCalls: plan.estimatedAgentCalls,
    },
  }).returning();

  await logVibaEvent({
    userId: input.userId ?? null,
    sessionId: input.sessionId,
    eventType: "instruction_orchestrated",
    provider: "viba",
    status: "planned",
    message: `Instruction planned in ${plan.executionMode} mode.`,
    metadata: {
      taskCount: createdTasks.length,
      assignments,
      phaseSummary,
      complexity: plan.complexity,
      executionMode: plan.executionMode,
      estimatedAgentCalls: plan.estimatedAgentCalls,
    },
  });

  return {
    userMessage,
    delegationMessage,
    tasks: createdTasks,
    assignments,
    plan: {
      complexity: plan.complexity,
      executionMode: plan.executionMode,
      estimatedAgentCalls: plan.estimatedAgentCalls,
      phases: phaseSummary,
    },
  };
}
