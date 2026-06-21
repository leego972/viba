import { db, agentsTable, messagesTable, tasksTable } from "@workspace/db";
import type { Agent, Task } from "@workspace/db";
import { eq } from "drizzle-orm";
import { routeTask } from "./taskRouter";
import { logVibaEvent } from "./vibaVault";

type PlannedTask = {
  title: string;
  type: string;
  description: string;
};

type AssignmentPreview = {
  taskTitle: string;
  taskType: string;
  agentId: number | null;
  agentName: string | null;
  provider: string | null;
  role: string | null;
};

function cleanInstruction(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function includesAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

export function decomposeInstruction(instruction: string): PlannedTask[] {
  const tasks: PlannedTask[] = [];
  const lower = instruction.toLowerCase();

  if (includesAny(lower, ["research", "lookup", "look up", "find", "compare", "price", "pricing", "competitor", "market", "web"])) {
    tasks.push({
      title: "Research and Evidence Gathering",
      type: "research",
      description: `Research the user's instruction, gather relevant public evidence, compare options, and return sources where available: ${instruction}`,
    });
  }

  if (includesAny(lower, ["design", "creative", "brand", "logo", "copy", "advert", "ad", "ux", "ui", "landing", "visual"])) {
    tasks.push({
      title: "Creative and UX Direction",
      type: "creative_direction",
      description: `Create the original creative, UX, copy, or brand direction required by the user's instruction: ${instruction}`,
    });
  }

  if (includesAny(lower, ["build", "code", "repo", "backend", "frontend", "api", "database", "fix", "debug", "implement", "wire", "connect", "integration"])) {
    tasks.push({
      title: "Build and Implementation",
      type: "build",
      description: `Implement or plan the technical build required by the user's instruction. Use tools only when available and permitted: ${instruction}`,
    });
  }

  if (includesAny(lower, ["review", "audit", "test", "qa", "bug", "error", "security", "check", "validate"])) {
    tasks.push({
      title: "Review and Validation",
      type: "code_review",
      description: `Review, test, audit, or validate the work relevant to the user's instruction. Identify bugs, risks, and required fixes: ${instruction}`,
    });
  }

  if (includesAny(lower, ["deploy", "railway", "docker", "release", "production", "environment", "env vars", "github", "pull request", "commit"])) {
    tasks.push({
      title: "Deployment and Connector Check",
      type: "deployment_approval",
      description: `Check deployment, connector, environment, GitHub, Railway, or release requirements for: ${instruction}`,
    });
  }

  if (tasks.length === 0) {
    tasks.push({
      title: "Plan User Instruction",
      type: "planning",
      description: `Understand, plan, and execute the user's instruction through the best available VIBA agents: ${instruction}`,
    });
  }

  tasks.push({
    title: "Final Merge and User Answer",
    type: "final_qa",
    description: `Merge all agent outputs into one direct, useful response for the user. Remove duplicates and conflicts. Original instruction: ${instruction}`,
  });

  return tasks;
}

function previewAssignments(tasks: PlannedTask[], agents: Agent[]): AssignmentPreview[] {
  return tasks.map((task, index) => {
    const pseudoTask = { id: index + 1, type: task.type, title: task.title, toolRequirements: [] } as Task;
    const agent = routeTask(pseudoTask, agents);
    return {
      taskTitle: task.title,
      taskType: task.type,
      agentId: agent?.id ?? null,
      agentName: agent?.name ?? null,
      provider: agent?.provider ?? null,
      role: agent?.role ?? null,
    };
  });
}

export async function orchestrateUserInstruction(input: { sessionId: number; content: unknown; userId?: number | null }) {
  const instruction = cleanInstruction(input.content);
  if (!instruction) throw new Error("Instruction text is required.");

  const agents = await db.select().from(agentsTable).where(eq(agentsTable.sessionId, input.sessionId));
  if (!agents.length) throw new Error("No agents exist in this session.");

  const planned = decomposeInstruction(instruction);

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
  for (const task of planned) {
    const [created] = await db.insert(tasksTable).values({
      sessionId: input.sessionId,
      title: task.title,
      description: task.description,
      type: task.type,
      status: "planned",
    }).returning();
    if (created) createdTasks.push(created);
  }

  const assignments = previewAssignments(planned, agents);

  const [delegationMessage] = await db.insert(messagesTable).values({
    sessionId: input.sessionId,
    agentId: null,
    role: "assistant",
    provider: "viba",
    content: `VIBA decomposed the instruction into ${createdTasks.length} task(s), matched them to the best available agents by capability, and queued them for execution.`,
    taskId: null,
    agentName: "VIBA Orchestrator",
    agentRole: "Coordinator",
    messageType: "context",
    metadata: { assignments },
  }).returning();

  await logVibaEvent({
    userId: input.userId ?? null,
    sessionId: input.sessionId,
    eventType: "instruction_orchestrated",
    provider: "viba",
    status: "planned",
    message: "User instruction decomposed and delegated by VIBA.",
    metadata: { taskCount: createdTasks.length, assignments },
  });

  return {
    userMessage,
    delegationMessage,
    tasks: createdTasks,
    assignments,
  };
}
