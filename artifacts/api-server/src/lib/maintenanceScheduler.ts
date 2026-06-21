import { pool } from "@workspace/db";
import { logger } from "./logger";
import { notifyAdmin } from "./maintenanceNotify";

const MELBOURNE_TZ = "Australia/Melbourne";
const ADMIN_EMAIL = process.env["VIBA_ADMIN_EMAIL"] || process.env["ADMIN_BOOTSTRAP_EMAIL"] || "leego972@gmail.com";
const PUBLIC_URL = process.env["VIBA_PUBLIC_URL"] || "https://viba.guru";

let schedulerStarted = false;
let running = false;
let lastScheduledRunKey: string | null = null;

function melbourneParts(date = new Date()): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: MELBOURNE_TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function melbourneRunKey(date = new Date()): string {
  const p = melbourneParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function isSundayTenPmMelbourne(date = new Date()): boolean {
  const p = melbourneParts(date);
  return p.weekday === "Sun" && p.hour === "22";
}

async function ensureTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_maintenance_runs (
      id SERIAL PRIMARY KEY,
      run_key TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      repo_full_name TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      self_repair_run_id INTEGER,
      pr_number INTEGER,
      pr_url TEXT,
      checkpoint_id INTEGER,
      admin_email TEXT NOT NULL,
      notification_status TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function logRunEvent(input: { runKey: string; status: string; message: string; metadata?: Record<string, unknown> }): Promise<void> {
  await pool.query(
    `INSERT INTO viba_activity_logs (event_type, severity, provider, subject, status, message, metadata, created_at)
     VALUES ('weekly_maintenance', $1, 'viba', $2, $3, $4, $5, NOW())`,
    [input.status === "failed" ? "high" : "info", input.runKey, input.status, input.message, JSON.stringify(input.metadata ?? {})],
  ).catch(() => undefined);
}

async function claimRun(runKey: string, repo: string, branch: string): Promise<number | null> {
  await ensureTables();
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO viba_maintenance_runs (run_key, status, repo_full_name, base_branch, admin_email)
     VALUES ($1, 'running', $2, $3, $4)
     ON CONFLICT (run_key) DO NOTHING
     RETURNING id`,
    [runKey, repo, branch, ADMIN_EMAIL],
  );
  return inserted.rows[0]?.id ?? null;
}

async function updateRun(id: number, patch: { status: string; selfRepairRunId?: number | null; prNumber?: number | null; prUrl?: string | null; checkpointId?: number | null; notificationStatus?: string; metadata?: Record<string, unknown> }): Promise<void> {
  await pool.query(
    `UPDATE viba_maintenance_runs
        SET status = $1,
            self_repair_run_id = COALESCE($2, self_repair_run_id),
            pr_number = COALESCE($3, pr_number),
            pr_url = COALESCE($4, pr_url),
            checkpoint_id = COALESCE($5, checkpoint_id),
            notification_status = COALESCE($6, notification_status),
            metadata = COALESCE($7, metadata),
            updated_at = NOW()
      WHERE id = $8`,
    [patch.status, patch.selfRepairRunId ?? null, patch.prNumber ?? null, patch.prUrl ?? null, patch.checkpointId ?? null, patch.notificationStatus ?? null, patch.metadata ? JSON.stringify(patch.metadata) : null, id],
  );
}

async function callSelfRepair(repo: string, branch: string): Promise<{ ok: boolean; runId?: number; status?: string; checkpoint?: { id?: number }; pr?: { number?: number; html_url?: string }; message?: string }> {
  const port = process.env["PORT"] || "3000";
  const url = `http://127.0.0.1:${port}/api/self-repair/auto-fix`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-VIBA-INTERNAL-MAINTENANCE": process.env["VIBA_INTERNAL_MAINTENANCE_TOKEN"] || "",
    },
    body: JSON.stringify({ repoFullName: repo, branch, confirm: true, createPr: true, goal: "Weekly VIBA self-maintenance: audit, debug, repair, sandbox build, checkpoint, and prepare merge-ready PR." }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, message: (data as { message?: string }).message || `HTTP ${response.status}` };
  return data as { ok: boolean; runId?: number; status?: string; checkpoint?: { id?: number }; pr?: { number?: number; html_url?: string }; message?: string };
}

export async function runWeeklyMaintenanceNow(reason = "manual_or_scheduled"): Promise<{ ok: boolean; runKey: string; message: string }> {
  if (running) return { ok: false, runKey: melbourneRunKey(), message: "Weekly maintenance is already running." };
  running = true;
  const repo = process.env["VIBA_SELF_REPO"] || process.env["GITHUB_REPOSITORY"] || "leego972/bridge-ai";
  const branch = process.env["VIBA_SELF_BRANCH"] || "main";
  const runKey = reason === "scheduled" ? melbourneRunKey() : `${melbourneRunKey()}-${Date.now()}`;

  try {
    const runId = await claimRun(runKey, repo, branch);
    if (!runId) return { ok: false, runKey, message: "Maintenance already ran for this schedule window." };
    await logRunEvent({ runKey, status: "running", message: `Weekly maintenance started for ${repo}@${branch}.`, metadata: { reason } });

    const result = await callSelfRepair(repo, branch);
    if (!result.ok) {
      await updateRun(runId, { status: "failed", metadata: { result } });
      await logRunEvent({ runKey, status: "failed", message: `Weekly maintenance failed: ${result.message ?? "self-repair failed"}`, metadata: { result } });
      const notice = await notifyAdmin({
        subject: "VIBA weekly maintenance failed",
        body: `VIBA weekly maintenance failed for ${repo}@${branch}.\n\nReason: ${result.message ?? "Unknown"}\n\nDashboard: ${PUBLIC_URL}/admin`,
      }).catch(() => ({ sent: false, to: ADMIN_EMAIL, reason: "notification failed" }));
      await updateRun(runId, { status: "failed", notificationStatus: notice.sent ? "sent" : `not_sent: ${notice.reason ?? "unknown"}`, metadata: { result, notice } });
      return { ok: false, runKey, message: result.message ?? "Maintenance failed." };
    }

    const prNumber = result.pr?.number ?? null;
    const prUrl = result.pr?.html_url ?? null;
    const checkpointId = result.checkpoint?.id ?? null;
    const notice = await notifyAdmin({
      subject: "VIBA update ready to merge",
      body: `VIBA weekly maintenance completed successfully.\n\nRepository: ${repo}\nBranch: ${branch}\nRepair run: ${result.runId ?? "n/a"}\nCheckpoint: ${checkpointId ?? "n/a"}\nPR: ${prNumber ?? "n/a"}\nURL: ${prUrl ?? "n/a"}\n\nLog in to approve merge:\n${PUBLIC_URL}/admin/maintenance`,
      html: `<p>VIBA weekly maintenance completed successfully.</p><ul><li><b>Repository:</b> ${repo}</li><li><b>Branch:</b> ${branch}</li><li><b>Repair run:</b> ${result.runId ?? "n/a"}</li><li><b>Checkpoint:</b> ${checkpointId ?? "n/a"}</li><li><b>PR:</b> ${prNumber ?? "n/a"}</li></ul><p><a href="${PUBLIC_URL}/admin/maintenance">Open admin maintenance dashboard</a></p>`,
    }).catch((error: unknown) => ({ sent: false, to: ADMIN_EMAIL, reason: error instanceof Error ? error.message : "notification failed" }));

    await updateRun(runId, { status: "merge_ready", selfRepairRunId: result.runId ?? null, prNumber, prUrl, checkpointId, notificationStatus: notice.sent ? "sent" : `not_sent: ${notice.reason ?? "unknown"}`, metadata: { result, notice } });
    await logRunEvent({ runKey, status: "merge_ready", message: `Weekly maintenance completed. Update is ready for admin merge.`, metadata: { result, notice } });
    return { ok: true, runKey, message: "Maintenance completed; update ready to merge." };
  } finally {
    running = false;
  }
}

export function startWeeklyMaintenanceScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  if (process.env["VIBA_WEEKLY_MAINTENANCE_ENABLED"] !== "true") {
    logger.info("Weekly VIBA maintenance scheduler disabled");
    return;
  }
  logger.info({ timezone: MELBOURNE_TZ, schedule: "Sunday 22:00" }, "Weekly VIBA maintenance scheduler enabled");
  setInterval(() => {
    if (!isSundayTenPmMelbourne()) return;
    const runKey = melbourneRunKey();
    if (lastScheduledRunKey === runKey) return;
    lastScheduledRunKey = runKey;
    runWeeklyMaintenanceNow("scheduled").catch((error) => logger.error({ error }, "Weekly VIBA maintenance failed"));
  }, 60_000);
}
