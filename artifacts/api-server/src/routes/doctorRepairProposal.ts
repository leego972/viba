import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

type Severity = "critical" | "high" | "medium" | "low" | "info";

type DoctorFinding = {
  severity: Severity;
  evidence: "green" | "yellow" | "red";
  area: string;
  title: string;
  detail: string;
  recommendation: string;
  source?: string;
};

type DoctorReport = {
  repoFullName: string;
  branch: string;
  publicUrl: string | null;
  healthScore: number;
  findings: DoctorFinding[];
  topBlockers: DoctorFinding[];
  nextAction: string;
};

type ProposalStep = {
  area: string;
  severity: Severity;
  title: string;
  fixType: "configuration" | "dependency" | "workflow" | "environment" | "health" | "credential" | "documentation" | "review";
  ownerAction: string;
  suggestedPath: string | null;
  risk: "low" | "medium" | "high";
  approvalRequired: boolean;
  canAutoPreparePr: boolean;
};

const router: IRouter = Router();

function reportIdFromParams(value: string | undefined): number | null {
  const id = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function riskFromSeverity(severity: Severity): "low" | "medium" | "high" {
  if (severity === "critical" || severity === "high") return "high";
  if (severity === "medium") return "medium";
  return "low";
}

function fixTypeForArea(area: string): ProposalStep["fixType"] {
  if (area.includes("env") || area.includes("stripe") || area.includes("railway")) return "environment";
  if (area.includes("credential")) return "credential";
  if (area.includes("workflow") || area.includes("ci")) return "workflow";
  if (area.includes("package") || area.includes("mobile")) return "dependency";
  if (area.includes("health")) return "health";
  if (area.includes("structure") || area.includes("github")) return "configuration";
  if (area.includes("doc")) return "documentation";
  return "review";
}

function suggestedPath(finding: DoctorFinding): string | null {
  if (finding.source && finding.source.includes("/")) return finding.source;
  if (finding.area === "ci_workflow") return ".github/workflows/backend-ci.yml";
  if (finding.area === "mobile_build") return "artifacts/bridge-ai/package.json";
  if (finding.area === "stripe_env" || finding.area === "railway_env") return "Railway service variables";
  if (finding.area === "health_endpoint") return "Railway deploy logs and /api/healthz";
  if (finding.area === "github_credentials") return "GITHUB_TOKEN / VIBA credentials";
  return null;
}

function ownerAction(finding: DoctorFinding): string {
  const type = fixTypeForArea(finding.area);
  if (type === "environment") return "Verify the missing or unconfirmed environment variable in Railway, then rerun Doctor.";
  if (type === "credential") return "Add or repair the required credential, then rerun Doctor.";
  if (type === "workflow") return "Patch the workflow configuration and rerun CI before deployment.";
  if (type === "dependency") return "Patch the package/dependency setup, run install, then run typecheck and build.";
  if (type === "health") return "Check Railway runtime logs, confirm app start, then verify the health endpoint.";
  if (type === "configuration") return "Restore or correct the required repo configuration, then rerun Doctor.";
  if (type === "documentation") return "Update the setup documentation and rerun Doctor if the doc is used as a deploy gate.";
  return finding.recommendation;
}

function canAutoPreparePr(finding: DoctorFinding): boolean {
  const type = fixTypeForArea(finding.area);
  if (type === "environment" || type === "credential" || type === "health") return false;
  if (!suggestedPath(finding)) return false;
  return true;
}

function proposalForFinding(finding: DoctorFinding): ProposalStep {
  return {
    area: finding.area,
    severity: finding.severity,
    title: finding.title,
    fixType: fixTypeForArea(finding.area),
    ownerAction: ownerAction(finding),
    suggestedPath: suggestedPath(finding),
    risk: riskFromSeverity(finding.severity),
    approvalRequired: true,
    canAutoPreparePr: canAutoPreparePr(finding),
  };
}

router.get("/doctor/reports/:id/repair-proposal", async (req, res): Promise<void> => {
  const id = reportIdFromParams(req.params.id);
  if (!id) { res.status(400).json({ error: "invalid_report_id" }); return; }

  const result = await pool.query<{ report: DoctorReport; repo_full_name: string; branch: string; health_score: number; created_at: Date }>(
    `SELECT report, repo_full_name, branch, health_score, created_at
       FROM viba_project_doctor_reports
      WHERE id = $1
      LIMIT 1`,
    [id],
  );

  const row = result.rows[0];
  if (!row) { res.status(404).json({ error: "doctor_report_not_found" }); return; }

  const report = row.report;
  const actionableFindings = (report.findings ?? []).filter((finding) => finding.severity !== "info");
  const proposal = actionableFindings.map(proposalForFinding);
  const prReadyCount = proposal.filter((step) => step.canAutoPreparePr).length;
  const manualOnlyCount = proposal.length - prReadyCount;

  res.json({
    reportId: id,
    generatedAt: new Date().toISOString(),
    sourceReport: {
      repoFullName: row.repo_full_name,
      branch: row.branch,
      healthScore: row.health_score,
      createdAt: row.created_at,
    },
    summary: {
      totalFindings: actionableFindings.length,
      prReadyCount,
      manualOnlyCount,
      highRiskCount: proposal.filter((step) => step.risk === "high").length,
    },
    proposal,
    gates: {
      usesPaidProviders: false,
      mutatesGitHub: false,
      mutatesRailway: false,
      approvalRequiredBeforeAnyChange: true,
    },
    nextAction: proposal.length === 0
      ? "No repair proposal needed. Rerun Doctor after deployment changes if required."
      : "Review proposal steps. Environment and credential items must be handled manually. Code/config items can later become PR-first work after approval.",
    guarantee: "This proposal is generated from the stored Doctor report only. It does not call paid providers and does not change GitHub or Railway.",
  });
});

export default router;
