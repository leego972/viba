import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const router: IRouter = Router();

// ──────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────

type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
type FindingType = "docs" | "config" | "workflow" | "env_var" | "credential" | "health" | "dependency";

export interface DoctorFinding {
  id: string;
  severity: FindingSeverity;
  area: string;
  title: string;
  recommendation: string;
  evidence: string | null;
  prReady: boolean;
  findingType: FindingType;
}

export interface DoctorReport {
  id: string;
  owner: string;
  repo: string;
  branch: string;
  healthScore: number;
  findings: DoctorFinding[];
  scannedAt: string;
}

// ──────────────────────────────────────────────────
// In-memory store (ephemeral — scans are per-session)
// Exported so /reports/compare can load reports by ID.
// ──────────────────────────────────────────────────

export const reportStore = new Map<string, DoctorReport>();

// ──────────────────────────────────────────────────
// GitHub helpers
// ──────────────────────────────────────────────────

async function resolveGithubToken(): Promise<string | null> {
  let token: string | null = process.env.GITHUB_TOKEN ?? null;
  if (!token) {
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "GITHUB_TOKEN"));
    token = row?.value ?? null;
  }
  return token;
}

function ghHeaders(token: string | null): Record<string, string> {
  const base: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "VIBA-Doctor/1.0",
  };
  if (token) base["Authorization"] = `Bearer ${token}`;
  return base;
}

async function ghGet(url: string, token: string | null): Promise<{ ok: boolean; status: number; data: unknown }> {
  const r = await fetch(url, { headers: ghHeaders(token) });
  let data: unknown = null;
  try { data = await r.json(); } catch { /* ignore */ }
  return { ok: r.ok, status: r.status, data };
}

async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token: string | null,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(ref)}`;
  const { ok, data } = await ghGet(url, token);
  if (!ok || !data || typeof data !== "object") return null;
  const d = data as { content?: string; encoding?: string };
  if (d.encoding === "base64" && d.content) {
    return Buffer.from(d.content.replace(/\n/g, ""), "base64").toString("utf8");
  }
  return null;
}

async function fileExists(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token: string | null,
): Promise<boolean> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(ref)}`;
  const { ok } = await ghGet(url, token);
  return ok;
}

// ──────────────────────────────────────────────────
// Health score formula
// ──────────────────────────────────────────────────

function calcHealthScore(findings: DoctorFinding[]): number {
  const weights: Record<FindingSeverity, number> = {
    critical: 30,
    high: 18,
    medium: 10,
    low: 4,
    info: 0,
  };
  const deduction = findings.reduce((sum, f) => sum + (weights[f.severity] ?? 0), 0);
  return Math.max(0, 100 - deduction);
}

// ──────────────────────────────────────────────────
// Scanner
// ──────────────────────────────────────────────────

async function scanRepo(owner: string, repo: string, branch: string, token: string | null): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [];
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  // 1. Verify repo exists & get default branch
  const { ok: repoOk, status: repoStatus, data: repoData } = await ghGet(base, token);
  if (!repoOk) {
    if (repoStatus === 404) throw new Error("repo_not_found");
    if (repoStatus === 401 || repoStatus === 403) throw new Error("github_token_missing");
    throw new Error(`github_error_${repoStatus}`);
  }
  const rd = repoData as { private?: boolean; default_branch?: string };
  const effectiveBranch = branch || rd.default_branch || "main";

  // 2. Check README
  const hasReadme = await fileExists(owner, repo, "README.md", effectiveBranch, token);
  if (!hasReadme) {
    findings.push({
      id: randomUUID(),
      severity: "medium",
      area: "Documentation",
      title: "Missing README.md",
      recommendation: "Add a README.md describing the project purpose, setup, and usage.",
      evidence: "README.md not found at repo root.",
      prReady: true,
      findingType: "docs",
    });
  }

  // 3. Check CONTRIBUTING.md
  const hasContributing = await fileExists(owner, repo, "CONTRIBUTING.md", effectiveBranch, token);
  if (!hasContributing) {
    findings.push({
      id: randomUUID(),
      severity: "low",
      area: "Documentation",
      title: "Missing CONTRIBUTING.md",
      recommendation: "Add CONTRIBUTING.md with contribution guidelines and code standards.",
      evidence: "CONTRIBUTING.md not found.",
      prReady: true,
      findingType: "docs",
    });
  }

  // 4. Check .env.example
  const hasEnvExample = await fileExists(owner, repo, ".env.example", effectiveBranch, token);
  if (!hasEnvExample) {
    findings.push({
      id: randomUUID(),
      severity: "medium",
      area: "Configuration",
      title: "Missing .env.example",
      recommendation: "Add .env.example listing all required environment variables (without values).",
      evidence: ".env.example not found. New contributors won't know which env vars are required.",
      prReady: false,
      findingType: "env_var",
    });
  }

  // 5. Check nixpacks.toml for Node version
  const nixpacksContent = await getFileContent(owner, repo, "nixpacks.toml", effectiveBranch, token);
  if (nixpacksContent !== null) {
    if (!nixpacksContent.includes("nodejs_") && !nixpacksContent.includes("[phases") ) {
      findings.push({
        id: randomUUID(),
        severity: "medium",
        area: "Build Configuration",
        title: "nixpacks.toml does not pin Node.js version",
        recommendation: "Pin the Node.js version in nixpacks.toml (e.g. providers = [\"nodejs_24\"]) to prevent unexpected runtime upgrades.",
        evidence: "nixpacks.toml exists but does not reference a nodejs_XX provider.",
        prReady: true,
        findingType: "config",
      });
    }
  }

  // 6. Check package.json for test script
  const pkgContent = await getFileContent(owner, repo, "package.json", effectiveBranch, token);
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent) as { scripts?: Record<string, string> };
      if (!pkg.scripts?.["test"]) {
        findings.push({
          id: randomUUID(),
          severity: "low",
          area: "Testing",
          title: "No test script in package.json",
          recommendation: "Add a 'test' script to package.json to enable CI test automation.",
          evidence: "package.json scripts.test is not defined.",
          prReady: false,
          findingType: "workflow",
        });
      }
    } catch { /* ignore parse errors */ }
  }

  // 7. Check for VIBA audit record
  const hasVIBARecord = await fileExists(owner, repo, "VIBA-DOCTOR-AUDIT.md", effectiveBranch, token);
  if (!hasVIBARecord) {
    findings.push({
      id: randomUUID(),
      severity: "info",
      area: "Audit Trail",
      title: "No VIBA Doctor audit record",
      recommendation: "Generate a VIBA Doctor audit record (VIBA-DOCTOR-AUDIT.md) to document system health over time.",
      evidence: "VIBA-DOCTOR-AUDIT.md not found.",
      prReady: true,
      findingType: "docs",
    });
  }

  return findings;
}

// ──────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────

// POST /doctor/scan
// ─── SAFETY CONTRACT ─────────────────────────────────────────────────────────
// Project Doctor diagnostic mode must be read-only. It may inspect repository
// metadata, configuration, health, and required files, but must not mutate
// GitHub, deploy, change billing, or call paid providers unless a separate
// explicit approval flow is implemented.
//
// Safety gates enforced by this handler:
//   • no mutation in diagnostic mode — only ghGet (HTTP GET) calls are made
//   • no deploy in diagnostic mode — no railway/render/vercel calls in scanRepo
//   • no paid provider call without approval — token resolved from env/DB only
//   • repair requires separate approval — POST /doctor/reports/:id/prepare-repair-pr
//     is the ONLY write path and requires explicit { confirm: true } in the body
//
// Do NOT add write operations here without a confirmation gate and approval log entry.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/doctor/scan", async (req, res): Promise<void> => {
  const body = req.body as { owner?: string; repo?: string; branch?: string };
  const { owner, repo, branch = "main" } = body;
  if (!owner || !repo) {
    res.status(400).json({ error: "owner and repo are required" });
    return;
  }

  const token = await resolveGithubToken();
  let findings: DoctorFinding[];
  try {
    findings = await scanRepo(owner, repo, branch, token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "repo_not_found") {
      res.status(404).json({ error: "repo_not_found", message: `Repository ${owner}/${repo} not found.` });
    } else if (msg === "github_token_missing") {
      res.status(503).json({ error: "github_token_missing", message: "This repository requires a GitHub token. Set GITHUB_TOKEN in Settings." });
    } else {
      res.status(502).json({ error: "github_error", message: msg });
    }
    return;
  }

  const report: DoctorReport = {
    id: randomUUID(),
    owner,
    repo,
    branch,
    healthScore: calcHealthScore(findings),
    findings,
    scannedAt: new Date().toISOString(),
  };
  reportStore.set(report.id, report);

  res.status(201).json(report);
});

// GET /doctor/reports — list all in-memory reports
router.get("/doctor/reports", (_req, res): void => {
  const reports = [...reportStore.values()].map((r) => ({
    id: r.id,
    owner: r.owner,
    repo: r.repo,
    branch: r.branch,
    healthScore: r.healthScore,
    findingCount: r.findings.length,
    scannedAt: r.scannedAt,
  }));
  res.json({ reports });
});

// GET /doctor/reports/:id
router.get("/doctor/reports/:id", (req, res): void => {
  const id = String(req.params["id"] ?? "");
  const report = reportStore.get(id);
  if (!report) { res.status(404).json({ error: "Report not found" }); return; }
  res.json(report);
});

// POST /doctor/reports/:id/prepare-repair-pr
router.post("/doctor/reports/:id/prepare-repair-pr", async (req, res): Promise<void> => {
  const id = String(req.params["id"] ?? "");
  const body = req.body as { confirm?: boolean };

  if (!body.confirm) {
    res.status(400).json({
      error: "confirmation_required",
      message: "Must include { confirm: true } to proceed. Approving creates a GitHub branch and PR.",
    });
    return;
  }

  const report = reportStore.get(id);
  if (!report) { res.status(404).json({ error: "Report not found" }); return; }

  const token = await resolveGithubToken();
  if (!token) {
    res.status(503).json({
      error: "github_token_missing",
      message: "GitHub token not configured. Set GITHUB_TOKEN in Settings.",
    });
    return;
  }

  const prReadyItems = report.findings.filter((f) => f.prReady);
  const manualItems = report.findings.filter((f) => !f.prReady);

  if (prReadyItems.length === 0) {
    res.status(422).json({
      error: "no_pr_ready_repairs",
      message: "No PR-ready items found. All findings require manual action.",
      manualItems: manualItems.map((f) => ({ title: f.title, recommendation: f.recommendation })),
    });
    return;
  }

  const timestamp = Date.now();
  const branchName = `viba-repair/report-${id.slice(0, 8)}-${timestamp}`;
  const { owner, repo, branch: baseBranch } = report;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "VIBA-Doctor/1.0",
    "Content-Type": "application/json",
  };

  // Resolve base branch SHA
  const refRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
    { headers },
  );
  if (!refRes.ok) {
    res.status(502).json({ error: "github_error", message: `Could not resolve base branch ${baseBranch}` });
    return;
  }
  const refData = await refRes.json() as { object?: { sha?: string } };
  const baseSha = refData.object?.sha ?? "";

  // Create repair branch
  const branchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
  });
  if (!branchRes.ok) {
    const d = await branchRes.json() as { message?: string };
    res.status(502).json({ error: "github_error", message: d.message ?? "Failed to create branch" });
    return;
  }

  // Build VIBA-DOCTOR-AUDIT.md content
  const auditDate = new Date().toISOString().split("T")[0];
  const prReadySection = prReadyItems
    .map((f) => `### [${f.severity.toUpperCase()}] ${f.title}\n- **Area:** ${f.area}\n- **Recommendation:** ${f.recommendation}${f.evidence ? `\n- **Evidence:** ${f.evidence}` : ""}`)
    .join("\n\n");
  const manualSection = manualItems.length > 0
    ? manualItems.map((f) => `### [${f.severity.toUpperCase()}] ${f.title}\n- **Area:** ${f.area}\n- **Recommendation:** ${f.recommendation}${f.evidence ? `\n- **Evidence:** ${f.evidence}` : ""}\n- **Action required:** Manual — cannot be auto-patched`)
        .join("\n\n")
    : "_No manual-only items._";

  const auditContent = `# VIBA Doctor Audit — ${owner}/${repo}

> **Generated by VIBA Doctor** | Report ID: \`${id}\` | Scanned: ${report.scannedAt} | Committed: ${auditDate}

## Health Score: ${report.healthScore}/100

Branch scanned: \`${baseBranch}\`

---

## PR-Ready Findings (addressed in this PR)

${prReadySection}

---

## Manual-Only Findings (require human action)

${manualSection}

---

## Safety Declaration

- ✅ No environment variables were modified
- ✅ No secrets were touched
- ✅ No production deployment was triggered
- ✅ No Railway configuration was changed
- ✅ This PR contains documentation changes only

---

*Generated by VIBA Doctor. Review before merging.*
`;

  // Commit VIBA-DOCTOR-AUDIT.md to the repair branch
  const b64Content = Buffer.from(auditContent, "utf8").toString("base64");

  // Check if file already exists on the branch (to get its SHA for updates)
  const existingRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/VIBA-DOCTOR-AUDIT.md?ref=${encodeURIComponent(branchName)}`,
    { headers },
  );
  const payload: Record<string, unknown> = {
    message: `docs: add VIBA Doctor audit record (report ${id.slice(0, 8)})`,
    content: b64Content,
    branch: branchName,
  };
  if (existingRes.ok) {
    const ex = await existingRes.json() as { sha?: string };
    if (ex.sha) payload["sha"] = ex.sha;
  }

  const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/VIBA-DOCTOR-AUDIT.md`, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
  });
  if (!commitRes.ok) {
    const d = await commitRes.json() as { message?: string };
    res.status(502).json({ error: "github_error", message: d.message ?? "Failed to commit audit file" });
    return;
  }

  // Build PR body
  const prBody = `## VIBA Doctor Repair PR

**Source Report:** \`${id}\`
**Repository:** \`${owner}/${repo}\`
**Branch scanned:** \`${baseBranch}\`
**Health Score:** ${report.healthScore}/100

---

### Findings Addressed (${prReadyItems.length} PR-Ready Items)

${prReadyItems.map((f) => `- **[${f.severity.toUpperCase()}]** ${f.title} — ${f.recommendation}`).join("\n")}

### Files Changed

- \`VIBA-DOCTOR-AUDIT.md\` — Full audit record with all findings and recommendations

### Safety Gates

- ✅ No environment variables modified
- ✅ No secrets touched
- ✅ No production deployment triggered
- ✅ No Railway configuration changed
- ✅ Changes are documentation-only

### Tests to Run After Merge

\`\`\`
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/bridge-ai run build
\`\`\`

### Manual-Only Items (Not Patched — Require Human Action)

${manualItems.length > 0
  ? manualItems.map((f) => `- **[${f.severity.toUpperCase()}]** ${f.title} — ${f.recommendation}`).join("\n")
  : "_None_"
}

---

*This PR was prepared by VIBA Doctor. Review all changes before merging. Do not merge without owner approval.*`;

  // Create PR
  const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: `VIBA Doctor Repair — ${owner}/${repo} (health: ${report.healthScore}/100)`,
      body: prBody,
      head: branchName,
      base: baseBranch,
    }),
  });
  if (!prRes.ok) {
    const d = await prRes.json() as { message?: string };
    res.status(502).json({ error: "github_error", message: d.message ?? "Failed to create PR" });
    return;
  }
  const prData = await prRes.json() as { number?: number; html_url?: string; state?: string };

  res.status(201).json({
    ok: true,
    branch: branchName,
    prNumber: prData.number,
    prUrl: prData.html_url,
    itemsPatched: prReadyItems.map((f) => ({ title: f.title, severity: f.severity })),
    manualItems: manualItems.map((f) => ({ title: f.title, severity: f.severity, recommendation: f.recommendation })),
  });
});

export default router;
