/**
 * VIBA Plan Limits
 *
 * Defines plan keys, per-plan feature limits, and helpers to
 * check / enforce entitlements in the tool broker and API routes.
 */
import { pool } from "@workspace/db";

// ─── Plan keys ────────────────────────────────────────────────────────────────

export type PlanKey =
  | "basic_assessment"
  | "pro_repair"
  | "admin_full_access"
  // Legacy keys — treated as pro_repair for feature gating
  | "viba_monthly"
  | "viba_annual";

// ─── Feature limits shape ─────────────────────────────────────────────────────

export interface PlanLimits {
  monthlyCredits: number;        // -1 = unlimited
  maxProviders: number;          // -1 = unlimited; Groq is always included
  multiAgent: boolean;
  repairActions: boolean;
  writeActions: boolean;
  deepSecurity: boolean;
  brandedReports: boolean;
  maxRepoScansPerMonth: number;  // -1 = unlimited
  maxWebsiteScansPerMonth: number; // -1 = unlimited
}

// ─── Plan limits config ───────────────────────────────────────────────────────

export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  basic_assessment: {
    monthlyCredits: 750,
    maxProviders: 1,
    multiAgent: false,
    repairActions: false,
    writeActions: false,
    deepSecurity: false,
    brandedReports: false,
    maxRepoScansPerMonth: 5,
    maxWebsiteScansPerMonth: 10,
  },
  pro_repair: {
    monthlyCredits: 4000,
    maxProviders: -1,
    multiAgent: true,
    repairActions: true,
    writeActions: true,
    deepSecurity: true,
    brandedReports: true,
    maxRepoScansPerMonth: -1,
    maxWebsiteScansPerMonth: -1,
  },
  admin_full_access: {
    monthlyCredits: -1,
    maxProviders: -1,
    multiAgent: true,
    repairActions: true,
    writeActions: true,
    deepSecurity: true,
    brandedReports: true,
    maxRepoScansPerMonth: -1,
    maxWebsiteScansPerMonth: -1,
  },
  // Legacy plans — treat as pro for backward compat
  viba_monthly: {
    monthlyCredits: 1000,
    maxProviders: -1,
    multiAgent: true,
    repairActions: true,
    writeActions: true,
    deepSecurity: true,
    brandedReports: true,
    maxRepoScansPerMonth: -1,
    maxWebsiteScansPerMonth: -1,
  },
  viba_annual: {
    monthlyCredits: 1950,
    maxProviders: -1,
    multiAgent: true,
    repairActions: true,
    writeActions: true,
    deepSecurity: true,
    brandedReports: true,
    maxRepoScansPerMonth: -1,
    maxWebsiteScansPerMonth: -1,
  },
};

// ─── Pro-only tool IDs ────────────────────────────────────────────────────────
// Basic plan gets everything NOT in this set.

export const PRO_ONLY_TOOLS = new Set<string>([
  // Deep security
  "security.deep_audit",
  "report.owasp_asvs.generate",
  "report.owasp_wstg.generate",
  // Repair / patch
  "security.safe_patch.apply",
  "repo.repair.apply",
  "repo.patch.apply",
  "repo.build.fix",
  // GitHub writes
  "github.pr.create",
  "github.branch.write",
  "github.commit.write",
  // Deployment
  "railway.deploy",
  "railway.deploy.trigger",
  "railway.rollback",
  "railway.env.write",
  // Client reports
  "report.client_proof.generate",
  // Multi-agent coordination
  "agents.multi.coordinate",
  "agents.team.spawn",
]);

// ─── Feature names ────────────────────────────────────────────────────────────

export type FeatureName =
  | "multiAgent"
  | "repairActions"
  | "writeActions"
  | "deepSecurity"
  | "brandedReports"
  | "maxProviders";

// ─── DB helpers ───────────────────────────────────────────────────────────────

export async function getUserPlan(userId: number): Promise<PlanKey> {
  const result = await pool.query(
    `SELECT COALESCE(plan_key, 'basic_assessment') AS plan_key FROM users WHERE id = $1`,
    [userId],
  );
  const raw = result.rows[0]?.plan_key as string | undefined;
  return (raw as PlanKey) ?? "basic_assessment";
}

export function getPlanLimits(planKey: PlanKey): PlanLimits {
  return PLAN_LIMITS[planKey] ?? PLAN_LIMITS["basic_assessment"];
}

// ─── Feature gating helpers ───────────────────────────────────────────────────

export const UPGRADE_MESSAGE =
  "Upgrade to VIBA Pro to repair, retest, collaborate with multiple AI agents, and generate proof reports.";

export async function requireFeature(
  userId: number,
  feature: FeatureName,
): Promise<{ allowed: boolean; planKey: PlanKey; upgradeMessage: string | null }> {
  const planKey = await getUserPlan(userId);
  const limits = getPlanLimits(planKey);
  const allowed =
    feature === "maxProviders"
      ? limits.maxProviders === -1 || limits.maxProviders > 1
      : (limits[feature] as boolean);

  return {
    allowed,
    planKey,
    upgradeMessage: allowed ? null : UPGRADE_MESSAGE,
  };
}

export function isPlanProOrAbove(planKey: PlanKey): boolean {
  return planKey !== "basic_assessment";
}

export function isToolAllowedForPlan(toolId: string, planKey: PlanKey): boolean {
  if (planKey === "admin_full_access") return true;
  if (isPlanProOrAbove(planKey)) return true;
  return !PRO_ONLY_TOOLS.has(toolId);
}

export function getPlanDisplayName(planKey: PlanKey): string {
  const names: Record<PlanKey, string> = {
    basic_assessment: "Basic Assessment",
    pro_repair: "Pro Repair",
    admin_full_access: "Admin Full Access",
    viba_monthly: "Pro Repair",
    viba_annual: "Pro Repair (Annual)",
  };
  return names[planKey] ?? "Basic Assessment";
}
