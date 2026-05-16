import crypto from "node:crypto";
import { logger } from "../lib/logger";

export interface WorkbenchLogEntry {
  taskId: string;
  platform: string;
  taskType: string;
  instructionsHash: string;
  rubricHash: string;
  taskContentHash: string;
  confidence: number;
  riskFlags: string[];
  reviewLevel: string;
  simulated: boolean;
  timestamp: string;
  durationMs: number;
}

function sha256short(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function buildLogEntry({
  taskId,
  platform,
  taskType,
  instructions,
  rubric,
  taskContent,
  confidence,
  riskFlags,
  reviewLevel,
  simulated,
  startedAt,
}: {
  taskId: string;
  platform: string;
  taskType: string;
  instructions: string;
  rubric?: string;
  taskContent: string;
  confidence: number;
  riskFlags: string[];
  reviewLevel: string;
  simulated: boolean;
  startedAt: number;
}): WorkbenchLogEntry {
  return {
    taskId,
    platform,
    taskType,
    instructionsHash: sha256short(instructions),
    rubricHash: sha256short(rubric ?? ""),
    taskContentHash: sha256short(taskContent),
    confidence,
    riskFlags,
    reviewLevel,
    simulated,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
  };
}

export async function logWorkbenchTask(entry: WorkbenchLogEntry): Promise<void> {
  logger.info(
    {
      workbench: true,
      taskId: entry.taskId,
      platform: entry.platform,
      taskType: entry.taskType,
      confidence: entry.confidence,
      reviewLevel: entry.reviewLevel,
      riskFlagCount: entry.riskFlags.length,
      simulated: entry.simulated,
      durationMs: entry.durationMs,
    },
    "workbench task analysed"
  );
}
