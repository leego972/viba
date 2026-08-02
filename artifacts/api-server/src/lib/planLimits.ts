/**
 * VIBA Plan Limits
 *
 * Defines plan keys, per-plan feature limits, and helpers to
 * check / enforce entitlements in the tool broker and API routes.
 */
import { pool } from "@workspace/db";

export type PlanKey =
  | "basic_assessment"
  | "pro_repair"
  | "admin_full_access"
  | "viba_monthly"
  | "viba_annual";

export interface PlanLimits {
  monthlyCredits: number;
  maxProviders: number;
  multiAgent: boolean;
  repairActions: boolean;
  writeActions: boolean;
  deepSecurity: boolean;
  brandedReports: boolean;
  maxRepoScansPerMonth: number;
  maxWebsiteScansPerMonth: number;
}

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

export const PRO_ONLY_TOOLS = new Set<string>([
  "security.deep_audit",
  "report.owasp_asvs.generate",
  "report.owasp_wstg.generate",
  "security.safe_patch.apply",
  "repo.repair.apply",
  "repo.patch.apply",
  "repo.build.fix",
  "replit.repair.apply",
  "github.pr.create",
  "github.branch.write",
  "github.commit.write",
  "railway.deploy",
  "railway.deploy.trigger",
  "railway.rollback",
  "railway.env.write",
  "report.client_proof.generate",
  "agents.multi.coordinate",
  "agents.team.spawn",
]);

export type FeatureName =
  | "multiAgent"
  | "repairActions"
  | "writeActions"
  | "deepSecurity"
  | "brandedReports"
  | "maxProviders";

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
