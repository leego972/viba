import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logVibaEvent, resolveVibaCredential } from "../lib/vibaVault";

const router: IRouter = Router();

type ReqWithSession = { session?: { userId?: number } };
type Severity = "critical" | "high" | "medium" | "low" | "info";
type Evidence = "green" | "yellow" | "red";

type DoctorFinding = {
  severity: Severity;
  evidence: Evidence;
  area: string;
  title: string;
  detail: string;
  recommendation: string;
  source?: string;
};

type GitHubTreeItem = { path?: string; type?: string };

type DoctorReport = {
  mode: "github_railway_doctor_v1";
  repoFullName: string;
  branch: string;
  publicUrl: string | null;
  generatedAt: string;
  healthScore: number;
  topBlockers: DoctorFinding[];
  findings: DoctorFinding[];
  nextAction: string;
  creditQuote: {
    deterministicScanCredits: number;
    liveAgentEscalationCredits: string;
    repairCredits: string;
  };
  gates: {
    mutatesGitHub: false;
    mutatesRailway: false;
    usesPaidProviders: false;
    approvalRequiredForRepair: true;
  };
};

const REQUIRED_REPO_PATHS = [
  "package.json",
  "pnpm-workspace.yaml",
  ".github/workflows/backend-ci.yml",
  "artifacts/api-server/package.json",
  "artifacts/api-server/src/routes/index.ts",
  "artifacts/api-server/src/lib/agentLoop.ts",
  "artifacts/api-server/src/lib/agentComms.ts",
  "artifacts/api-server/src/lib/toolHandoff.ts",
  "artifacts/api-server/src/lib/fallbackPool.ts",
  "artifacts/api-server/src/lib/actionCreditBilling.ts",
  "artifacts/api-server/src/routes/billing.ts",
  "artifacts/api-server/src/routes/stripe.ts",
  "artifacts/bridge-ai/package.json",
  "docs/MANUS_RAILWAY_ENV_SETUP.md",
  "docs/MANUS_STRIPE_PRICE_SETUP.md",
];

const REQUIRED_RAILWAY_ENV = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "PUBLIC_ORIGIN",
  "VIBA_PUBLIC_URL",
  "VIBA_COST_SAFE_MODE",
  "VIBA_LIVE_AGENTS_ENABLED",
  "VIBA_BACKGROUND_MAX_TURNS",
];

const REQUIRED_STRIPE_ENV = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_BILLING_SUBSCRIPTION_PRICE_ID",
  "STRIPE_BILLING_PRO_SUBSCRIPTION_PRICE_ID",
  "STRIPE_PRICE_ID",
  "STRIPE_BILLING_CREDITS_1000_PRICE_ID",
  "STRIPE_BILLING_CREDITS_2000_PRICE_ID",
  "STRIPE_BILLING_CREDITS_3000_PRICE_ID",
  "STRIPE_BILLING_CREDITS_4000_PRICE_ID",
  "STRIPE_BILLING_CREDITS_5000_PRICE_ID",
  "STRIPE_BILLING_CREDITS_6000_PRICE_ID",
];

function userId(req: ReqWithSession): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function repoFromBody(body: unknown): string {
  const repo = typeof (body as { repoFullName?: unknown })?.repoFullName === "string"
    ? String((body as { repoFullName: string }).repoFullName).trim()
    : process.env.VIBA_SELF_REPO || process.env.GITHUB_REPOSITORY || "leego972/bridge-ai";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("repoFullName must be owner/name");
  return repo;
}

function branchFromBody(body: unknown): string {
  const branch = typeof (body as { branch?: unknown })?.branch === "string" ? String((body as { branch: string }).branch).trim() : "main";
  if (!/^[A-Za-z0-9._\/-]+$/.test(branch)) throw new Error("invalid branch");
  return branch;
}

function publicUrlFromBody(body: unknown): string | null {
  const raw = typeof (body as { publicUrl?: unknown })?.publicUrl === "string" ? String((body as { publicUrl: string }).publicUrl).trim() : "";
  if (!raw) return process.env.VIBA_PUBLIC_URL || process.env.PUBLIC_ORIGIN || null;
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("publicUrl must be http or https");
  return url.toString().replace(/\/$/, "");
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "VIBA-Project-Doctor/1.0",
  };
}

async function gh<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, { headers: githubHeaders(token) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof (data as { message?: unknown }).message === "string" ? (data as { message: string }).message : `GitHub HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

async function fetchTextFile(token: string, repo: string, branch: string, path: string): Promise<string | null> {
  try {
    const encodedPath = encodeURIComponent(path).replace(/%2F/g, "/");
    const data = await gh<{ content?: string; encoding?: string }>(token, `/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`);
    if (data.encoding === "base64" && data.content) return Buffer.from(data.content, "base64").toString("utf8");
    return null;
  } catch {
    return null;
  }
}

function envFinding(name: string, group: "railway" | "stripe"): DoctorFinding | null {
  if (process.env[name]?.trim()) return null;
  return {
    severity: group === "stripe" ? "high" : "medium",
    evidence: "yellow",
    area: group === "stripe" ? "stripe_env" : "railway_env",
    title: `${name} is not visible to the current runtime`,
    detail: `Doctor could not confirm ${name}. This may be expected in CI, but Railway production must set it before live deployment.`,
    recommendation: `Set ${name} in Railway service variables if this is the production environment.`,
    source: "process.env",
  };
}

async function checkHealth(publicUrl: string | null): Promise<DoctorFinding[]> {
  if (!publicUrl) {
    return [{
      severity: "low",
      evidence: "yellow",
      area: "health_endpoint",
      title: "Public URL not provided",
      detail: "Doctor skipped live health check because no publicUrl, VIBA_PUBLIC_URL, or PUBLIC_ORIGIN was available.",
      recommendation: "Provide publicUrl when running Doctor after Railway deploy.",
      source: "input/publicUrl",
    }];
  }

  const base = publicUrl.replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${base}/api/healthz`, { signal: controller.signal });
    if (response.ok) return [];
    return [{
      severity: "high",
      evidence: "red",
      area: "health_endpoint",
      title: "Health endpoint returned non-OK status",
      detail: `/api/healthz returned HTTP ${response.status}.`,
      recommendation: "Check Railway runtime logs, route registration, and PUBLIC_ORIGIN/CORS settings.",
      source: `${base}/api/healthz`,
    }];
  } catch (error) {
    return [{
      severity: "high",
      evidence: "red",
      area: "health_endpoint",
      title: "Health endpoint could not be reached",
      detail: error instanceof Error ? error.message : "Unknown health check failure.",
      recommendation: "Verify Railway deploy status, domain DNS, and app startup logs.",
      source: `${base}/api/healthz`,
    }];
  } finally {
    clearTimeout(timeout);
  }
}

function healthScore(findings: DoctorFinding[]): number {
  const penalty: Record<Severity, number> = { critical: 30, high: 18, medium: 10, low: 4, info: 0 };
  const total = findings.reduce((sum, finding) => sum + penalty[finding.severity], 0);
  return Math.max(0, Math.min(100, 100 - total));
}

function topBlockers(findings: DoctorFinding[]): DoctorFinding[] {
  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return [...findings].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 3);
}

function nextAction(score: number, blockers: DoctorFinding[]): string {
  if (blockers.some((finding) => finding.area === "health_endpoint" && finding.severity !== "low")) return "Fix Railway deploy/startup or domain health endpoint before running paid agent repair.";
  if (blockers.some((finding) => finding.area === "stripe_env")) return "Complete Stripe price/webhook env setup in Railway before live billing tests.";
  if (blockers.some((finding) => finding.area === "github_structure" || finding.area === "ci_workflow")) return "Fix repo/build structure before deployment.";
  if (score >= 90) return "Proceed to controlled deployment verification with safe mode enabled.";
  return "Review top blockers, then rerun Doctor after fixes.";
}

async function ensureDoctorTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viba_project_doctor_reports (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      repo_full_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      public_url TEXT,
      health_score INTEGER NOT NULL,
      report JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function runDoctor(input: { token: string | null; repo: string; branch: string; publicUrl: string | null }): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];

  if (!input.token) {
    findings.push({
      severity: "high",
      evidence: "red",
      area: "github_credentials",
      title: "GitHub token unavailable",
      detail: "Doctor could not inspect repository files or workflow status without a GitHub token.",
      recommendation: "Set GITHUB_TOKEN in Railway or save a GitHub token in VIBA credentials.",
      source: "github token",
    });
  } else {
    try {
      const tree = await gh<{ tree?: GitHubTreeItem[] }>(input.token, `/repos/${input.repo}/git/trees/${encodeURIComponent(input.branch)}?recursive=1`);
      const paths = new Set((tree.tree ?? []).filter((item) => item.type === "blob" && item.path).map((item) => item.path as string));

      for (const path of REQUIRED_REPO_PATHS) {
        if (!paths.has(path)) {
          findings.push({
            severity: "high",
            evidence: "red",
            area: "github_structure",
            title: `Required file missing: ${path}`,
            detail: `Doctor expected ${path} to exist in ${input.repo}@${input.branch}.`,
            recommendation: "Restore or implement the missing file before deployment.",
            source: path,
          });
        }
      }

      const workflow = await fetchTextFile(input.token, input.repo, input.branch, ".github/workflows/backend-ci.yml");
      if (workflow) {
        for (const expected of ["Typecheck backend and workspace", "Build API server", "Build Bridge AI frontend"]) {
          if (!workflow.includes(expected)) {
            findings.push({
              severity: "medium",
              evidence: "yellow",
              area: "ci_workflow",
              title: `CI is missing explicit step: ${expected}`,
              detail: "Doctor expects CI to prove typecheck, API build, and frontend build separately.",
              recommendation: "Keep separate CI steps so failures are easy to diagnose.",
              source: ".github/workflows/backend-ci.yml",
            });
          }
        }
      }

      const frontendPackage = await fetchTextFile(input.token, input.repo, input.branch, "artifacts/bridge-ai/package.json");
      if (frontendPackage && !frontendPackage.includes("mobile:sync")) {
        findings.push({
          severity: "medium",
          evidence: "yellow",
          area: "mobile_build",
          title: "Mobile sync script not found",
          detail: "Capacitor mobile shell requires a mobile:sync script for Android/iOS shell updates.",
          recommendation: "Restore mobile:sync script before mobile handoff.",
          source: "artifacts/bridge-ai/package.json",
        });
      }
    } catch (error) {
      findings.push({
        severity: "high",
        evidence: "red",
        area: "github_api",
        title: "GitHub inspection failed",
        detail: error instanceof Error ? error.message : "Unknown GitHub API failure.",
        recommendation: "Check repo name, branch name, token permission, and GitHub installation access.",
        source: "GitHub API",
      });
    }
  }

  findings.push(...REQUIRED_RAILWAY_ENV.map((name) => envFinding(name, "railway")).filter((finding): finding is DoctorFinding => finding !== null));
  findings.push(...REQUIRED_STRIPE_ENV.map((name) => envFinding(name, "stripe")).filter((finding): finding is DoctorFinding => finding !== null));
  findings.push(...await checkHealth(input.publicUrl));

  findings.push({
    severity: "info",
    evidence: "green",
    area: "doctor_safety",
    title: "Doctor v1 is deterministic and safe",
    detail: "This report did not mutate GitHub, mutate Railway, or call paid AI providers.",
    recommendation: "Use this report to decide whether deeper paid analysis or repair should be approved.",
    source: "projectDoctor.ts",
  });

  const score = healthScore(findings);
  const blockers = topBlockers(findings);
  return {
    mode: "github_railway_doctor_v1",
    repoFullName: input.repo,
    branch: input.branch,
    publicUrl: input.publicUrl,
    generatedAt: new Date().toISOString(),
    healthScore: score,
    topBlockers: blockers,
    findings,
    nextAction: nextAction(score, blockers),
    creditQuote: {
      deterministicScanCredits: 0,
      liveAgentEscalationCredits: "requires approval; estimate after findings review",
      repairCredits: "requires PR proposal and owner approval",
    },
    gates: {
      mutatesGitHub: false,
      mutatesRailway: false,
      usesPaidProviders: false,
      approvalRequiredForRepair: true,
    },
  };
}

router.post("/doctor/github-railway/run", async (req, res): Promise<void> => {
  const uid = userId(req);
  try {
    await ensureDoctorTables();
    const repo = repoFromBody(req.body ?? {});
    const branch = branchFromBody(req.body ?? {});
    const publicUrl = publicUrlFromBody(req.body ?? {});
    const resolved = await resolveVibaCredential({ userId: uid, provider: "github", kind: "token", envNames: ["GITHUB_TOKEN"] });
    const report = await runDoctor({ token: resolved.value, repo, branch, publicUrl });
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO viba_project_doctor_reports (user_id, repo_full_name, branch, public_url, health_score, report)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [uid, repo, branch, publicUrl, report.healthScore, JSON.stringify(report)],
    );
    await logVibaEvent({
      userId: uid,
      eventType: "project_doctor_report_created",
      provider: "viba",
      subject: repo,
      status: "completed",
      message: `Project Doctor completed for ${repo}@${branch}.`,
      metadata: { reportId: inserted.rows[0]?.id, healthScore: report.healthScore, topBlockers: report.topBlockers.map((finding) => finding.title) },
    });
    res.status(201).json({ ok: true, reportId: inserted.rows[0]?.id, report });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : "Project Doctor failed." });
  }
});

router.get("/doctor/reports", async (req, res): Promise<void> => {
  const uid = userId(req);
  await ensureDoctorTables();
  const reports = await pool.query(
    `SELECT id, repo_full_name, branch, public_url, health_score, created_at
       FROM viba_project_doctor_reports
      WHERE user_id = $1 OR user_id IS NULL
      ORDER BY created_at DESC
      LIMIT 50`,
    [uid],
  );
  res.json({ reports: reports.rows });
});

export default router;
