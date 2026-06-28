/**
 * VIBA Beta Tester Routes
 *
 * Exposes the Virelle Studios (and any site) beta test pipeline as API endpoints.
 * Accepts a natural-language instruction like:
 *   "Log in as admin, generate a 15-min film about X, check character continuity"
 *
 * POST /api/beta-test/run          — generic beta test (site + credentials + goal)
 * POST /api/beta-test/virelle      — Virelle Studios-specific full pipeline test
 * POST /api/beta-test/continuity   — run continuity check on provided frame URLs
 * GET  /api/beta-test/tools        — list all VIBA tools available to agents
 * GET  /api/beta-test/jobs/:id     — get status of a running beta test job
 */

import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { runVirelleBetaTest, type VirelleBetaReport } from "../lib/virelleBetaTester";
import { runFullContinuityCheck, type FrameInput } from "../lib/continuityChecker";
import { getToolSummary } from "../lib/tools/registry";

const router: IRouter = Router();

function userId(req: { session?: { userId?: unknown } }): number | null {
  const id = req.session?.userId;
  return typeof id === "number" ? id : null;
}

async function ensureJobsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_beta_test_jobs (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id INTEGER,
      job_type TEXT NOT NULL DEFAULT 'virelle',
      status TEXT NOT NULL DEFAULT 'running',
      progress_log JSONB NOT NULL DEFAULT '[]',
      result JSONB,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function createJob(userId: number | null, jobType: string): Promise<string> {
  await ensureJobsTable();
  const { rows } = await pool.query(
    `INSERT INTO viba_beta_test_jobs (user_id, job_type, status) VALUES ($1, $2, 'running') RETURNING id`,
    [userId, jobType],
  );
  return String(rows[0]?.id ?? "");
}

async function updateJob(id: string, status: string, result?: unknown, error?: string): Promise<void> {
  await pool.query(
    `UPDATE viba_beta_test_jobs SET status=$2, result=$3, error=$4, updated_at=NOW() WHERE id=$1`,
    [id, status, result ? JSON.stringify(result) : null, error ?? null],
  );
}

async function appendProgress(id: string, step: string, detail?: string): Promise<void> {
  await pool.query(
    `UPDATE viba_beta_test_jobs
     SET progress_log = progress_log || $2::jsonb, updated_at=NOW()
     WHERE id=$1`,
    [id, JSON.stringify([{ step, detail, ts: new Date().toISOString() }])],
  );
}

// ── POST /api/beta-test/virelle ──────────────────────────────────────────────
router.post("/api/beta-test/virelle", async (req, res): Promise<void> => {
  const uid = userId(req as never);
  const body = req.body as Record<string, unknown>;

  const topic = typeof body["topic"] === "string" ? body["topic"] : "A cinematic short film";
  const duration = typeof body["duration_minutes"] === "number" ? body["duration_minutes"] : 15;
  const characterNames = Array.isArray(body["character_names"])
    ? (body["character_names"] as string[])
    : [];
  const credentialLabel = typeof body["credential_label"] === "string"
    ? body["credential_label"]
    : "admin";
  const async_ = body["async"] === true;

  // Create DB job for tracking
  let jobId = "";
  try {
    jobId = await createJob(uid, "virelle");
  } catch { /* non-fatal */ }

  if (async_) {
    // Fire and forget — return job ID immediately
    res.json({ ok: true, job_id: jobId, status: "running", message: "Beta test started. Poll GET /api/beta-test/jobs/:id for status." });

    runVirelleBetaTest({
      userId: uid,
      topic,
      credentialLabel,
      durationMinutes: duration,
      characterNames,
      onProgress: async (step, detail) => {
        await appendProgress(jobId, step, detail).catch(() => {});
        logger.info({ jobId, step, detail }, "Beta test progress");
      },
    })
      .then(async (report) => {
        await updateJob(jobId, report.overallVerdict === "ERROR" ? "error" : "completed", report);
      })
      .catch(async (err) => {
        await updateJob(jobId, "failed", undefined, String(err));
      });
    return;
  }

  // Synchronous — wait for result (may take several minutes for long films)
  try {
    const report: VirelleBetaReport = await runVirelleBetaTest({
      userId: uid,
      topic,
      credentialLabel,
      durationMinutes: duration,
      characterNames,
      onProgress: async (step, detail) => {
        await appendProgress(jobId, step, detail).catch(() => {});
      },
    });

    await updateJob(jobId, report.overallVerdict === "ERROR" ? "error" : "completed", report).catch(() => {});

    res.json({ job_id: jobId, ...report });
  } catch (err) {
    logger.error({ err }, "Virelle beta test failed");
    await updateJob(jobId, "failed", undefined, String(err)).catch(() => {});
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── POST /api/beta-test/run ──────────────────────────────────────────────────
// Generic: any site, natural language instruction
router.post("/api/beta-test/run", async (req, res): Promise<void> => {
  const uid = userId(req as never);
  const body = req.body as Record<string, unknown>;

  const instruction = typeof body["instruction"] === "string" ? body["instruction"] : "";
  if (!instruction) {
    res.status(400).json({ ok: false, error: "instruction is required" });
    return;
  }

  // Parse instruction for Virelle-specific patterns
  const isVirelle = /virelle/i.test(instruction);
  const topicMatch = instruction.match(/topic[:\s]+(.+?)(?:\.|$)/i);
  const topic = topicMatch?.[1]?.trim() ?? "A cinematic short film";
  const durationMatch = instruction.match(/(\d+)\s*(?:min|minute)/i);
  const duration = durationMatch ? parseInt(durationMatch[1] ?? "15") : 15;
  const charMatch = instruction.match(/character(?:s)?[:\s]+([^.]+)/i);
  const characters = charMatch ? charMatch[1]?.split(/,\s*/).map(s => s.trim()) : [];

  if (isVirelle) {
    let jobId = "";
    try { jobId = await createJob(uid, "virelle_natural_language"); } catch { /* ok */ }

    res.json({ ok: true, job_id: jobId, status: "running", parsed: { topic, duration, characters }, message: "Virelle beta test started. Poll /api/beta-test/jobs/:id" });

    runVirelleBetaTest({
      userId: uid,
      topic,
      durationMinutes: duration,
      characterNames: characters ?? [],
      onProgress: async (step, detail) => {
        await appendProgress(jobId, step, detail).catch(() => {});
      },
    })
      .then(async (r) => updateJob(jobId, r.ok ? "completed" : "failed", r))
      .catch(async (e) => updateJob(jobId, "failed", undefined, String(e)));
    return;
  }

  res.status(400).json({
    ok: false,
    error: "Only Virelle Studios beta testing is supported via natural language right now. Mention 'virelle' in your instruction, or use POST /api/beta-test/virelle directly.",
    hint: "Example: 'Log into Virelle as admin and generate a 15-min film. Topic: romance thriller. Check continuity.'",
  });
});

// ── POST /api/beta-test/continuity ───────────────────────────────────────────
router.post("/api/beta-test/continuity", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;

  const frameUrls = Array.isArray(body["frame_urls"]) ? body["frame_urls"] as string[] : [];
  const projectTitle = typeof body["project_title"] === "string" ? body["project_title"] : "Untitled";
  const characterNames = Array.isArray(body["character_names"]) ? body["character_names"] as string[] : [];
  const sceneDescription = typeof body["scene_description"] === "string" ? body["scene_description"] : undefined;

  if (frameUrls.length === 0) {
    res.status(400).json({ ok: false, error: "frame_urls array is required" });
    return;
  }

  try {
    const frames: FrameInput[] = frameUrls.map((url, i) => ({ url, label: `Frame ${i + 1}`, sceneIndex: i }));
    const report = await runFullContinuityCheck({
      projectTitle,
      frames,
      characterNames,
      sceneDescription,
    });
    res.json({ ok: true, ...report });
  } catch (err) {
    logger.error({ err }, "Continuity check failed");
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /api/beta-test/tools ─────────────────────────────────────────────────
router.get("/api/beta-test/tools", (req, res): void => {
  const uid = userId(req as never);
  const summary = getToolSummary({ userId: uid });
  const totalTools = Object.values(summary).reduce((a, b) => a + b.length, 0);

  res.json({
    ok: true,
    total_tools: totalTools,
    categories: summary,
    description: "All tools are owned by VIBA and available to any registered AI agent. No external browser service or paid AI required for tooling.",
    powered_by: {
      browser: "VIBA Chromium (Playwright) — local, no external service",
      vision: "Groq llama-3.2-11b-vision-preview — free tier",
      continuity: "Groq vision — free tier",
      site_operator: "VIBA Vault + Chromium — credentials never logged",
    },
  });
});

// ── GET /api/beta-test/jobs/:id ──────────────────────────────────────────────
router.get("/api/beta-test/jobs/:id", async (req, res): Promise<void> => {
  const jobId = String(req.params["id"] ?? "");
  try {
    await ensureJobsTable();
    const { rows } = await pool.query(
      `SELECT id, user_id, job_type, status, progress_log, result, error, created_at, updated_at
       FROM viba_beta_test_jobs WHERE id=$1`,
      [jobId],
    );
    if (!rows[0]) {
      res.status(404).json({ ok: false, error: "Job not found" });
      return;
    }
    res.json({ ok: true, ...rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /api/beta-test/jobs ──────────────────────────────────────────────────
router.get("/api/beta-test/jobs", async (req, res): Promise<void> => {
  const uid = userId(req as never);
  try {
    await ensureJobsTable();
    const { rows } = await pool.query(
      `SELECT id, job_type, status, error, created_at, updated_at
       FROM viba_beta_test_jobs
       WHERE user_id=$1 OR user_id IS NULL
       ORDER BY created_at DESC LIMIT 20`,
      [uid],
    );
    res.json({ ok: true, jobs: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
