/**
 * planLimits.test.ts
 * Unit tests for the VIBA plan gating system.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PLAN_LIMITS,
  getPlanLimits,
  isToolAllowedForPlan,
  isPlanProOrAbove,
  getPlanDisplayName,
  PRO_ONLY_TOOLS,
  UPGRADE_MESSAGE,
  type PlanKey,
} from "./planLimits";

// ── Mock DB pool so getUserPlan can be tested without a real DB ────────────────
vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn(),
  },
}));

// ─── PLAN_LIMITS config ───────────────────────────────────────────────────────

describe("PLAN_LIMITS config", () => {
  it("basic_assessment has 750 credits and no repair actions", () => {
    const lim = PLAN_LIMITS["basic_assessment"];
    expect(lim.monthlyCredits).toBe(750);
    expect(lim.repairActions).toBe(false);
    expect(lim.multiAgent).toBe(false);
    expect(lim.deepSecurity).toBe(false);
    expect(lim.brandedReports).toBe(false);
    expect(lim.maxProviders).toBe(1);
  });

  it("pro_repair has 4000 credits and full feature access", () => {
    const lim = PLAN_LIMITS["pro_repair"];
    expect(lim.monthlyCredits).toBe(4000);
    expect(lim.repairActions).toBe(true);
    expect(lim.multiAgent).toBe(true);
    expect(lim.deepSecurity).toBe(true);
    expect(lim.brandedReports).toBe(true);
    expect(lim.maxProviders).toBe(-1);
  });

  it("admin_full_access has unlimited credits and all features", () => {
    const lim = PLAN_LIMITS["admin_full_access"];
    expect(lim.monthlyCredits).toBe(-1);
    expect(lim.repairActions).toBe(true);
    expect(lim.multiAgent).toBe(true);
    expect(lim.maxProviders).toBe(-1);
  });
});

// ─── getPlanLimits ────────────────────────────────────────────────────────────

describe("getPlanLimits", () => {
  it("returns correct limits for each plan key", () => {
    const plans: PlanKey[] = ["basic_assessment", "pro_repair", "admin_full_access", "viba_monthly", "viba_annual"];
    for (const key of plans) {
      const lim = getPlanLimits(key);
      expect(lim).toBeDefined();
      expect(typeof lim.monthlyCredits).toBe("number");
    }
  });

  it("falls back to basic_assessment for unknown plan key", () => {
    const lim = getPlanLimits("unknown_plan" as PlanKey);
    expect(lim).toEqual(PLAN_LIMITS["basic_assessment"]);
  });
});

// ─── isToolAllowedForPlan ─────────────────────────────────────────────────────

describe("isToolAllowedForPlan — Basic plan", () => {
  const plan: PlanKey = "basic_assessment";

  it("allows report tools (not in PRO_ONLY_TOOLS)", () => {
    expect(isToolAllowedForPlan("website.scan.lighthouse", plan)).toBe(true);
    expect(isToolAllowedForPlan("qa.report.generate", plan)).toBe(true);
    expect(isToolAllowedForPlan("security.baseline.audit", plan)).toBe(true);
  });

  it("blocks repair tools", () => {
    expect(isToolAllowedForPlan("repo.repair.apply", plan)).toBe(false);
    expect(isToolAllowedForPlan("repo.patch.apply", plan)).toBe(false);
    expect(isToolAllowedForPlan("repo.build.fix", plan)).toBe(false);
  });

  it("blocks deep security tools", () => {
    expect(isToolAllowedForPlan("security.deep_audit", plan)).toBe(false);
    expect(isToolAllowedForPlan("report.owasp_asvs.generate", plan)).toBe(false);
    expect(isToolAllowedForPlan("report.owasp_wstg.generate", plan)).toBe(false);
  });

  it("blocks multi-agent tools", () => {
    expect(isToolAllowedForPlan("agents.multi.coordinate", plan)).toBe(false);
    expect(isToolAllowedForPlan("agents.team.spawn", plan)).toBe(false);
  });

  it("blocks GitHub write tools", () => {
    expect(isToolAllowedForPlan("github.pr.create", plan)).toBe(false);
    expect(isToolAllowedForPlan("github.branch.write", plan)).toBe(false);
    expect(isToolAllowedForPlan("github.commit.write", plan)).toBe(false);
  });

  it("blocks deployment tools", () => {
    expect(isToolAllowedForPlan("railway.deploy", plan)).toBe(false);
    expect(isToolAllowedForPlan("railway.rollback", plan)).toBe(false);
    expect(isToolAllowedForPlan("replit.repair.apply", plan)).toBe(false);
  });

  it("blocks client proof report generation", () => {
    expect(isToolAllowedForPlan("report.client_proof.generate", plan)).toBe(false);
  });
});

describe("isToolAllowedForPlan — Pro plan", () => {
  const plan: PlanKey = "pro_repair";

  it("allows all Pro-only tools", () => {
    for (const toolId of PRO_ONLY_TOOLS) {
      expect(isToolAllowedForPlan(toolId, plan)).toBe(true);
    }
  });

  it("allows Basic tools too", () => {
    expect(isToolAllowedForPlan("website.scan.lighthouse", plan)).toBe(true);
    expect(isToolAllowedForPlan("qa.report.generate", plan)).toBe(true);
  });
});

describe("isToolAllowedForPlan — Admin plan", () => {
  const plan: PlanKey = "admin_full_access";

  it("bypasses all gates", () => {
    for (const toolId of PRO_ONLY_TOOLS) {
      expect(isToolAllowedForPlan(toolId, plan)).toBe(true);
    }
    expect(isToolAllowedForPlan("website.scan.lighthouse", plan)).toBe(true);
    expect(isToolAllowedForPlan("any.made.up.tool", plan)).toBe(true);
  });
});

describe("isToolAllowedForPlan — Legacy plans", () => {
  it("viba_monthly behaves as Pro (allows Pro-only tools)", () => {
    for (const toolId of PRO_ONLY_TOOLS) {
      expect(isToolAllowedForPlan(toolId, "viba_monthly")).toBe(true);
    }
  });

  it("viba_annual behaves as Pro (allows Pro-only tools)", () => {
    for (const toolId of PRO_ONLY_TOOLS) {
      expect(isToolAllowedForPlan(toolId, "viba_annual")).toBe(true);
    }
  });
});

// ─── isPlanProOrAbove ─────────────────────────────────────────────────────────

describe("isPlanProOrAbove", () => {
  it("returns false for basic_assessment", () => {
    expect(isPlanProOrAbove("basic_assessment")).toBe(false);
  });

  it("returns true for pro_repair, admin_full_access, viba_monthly, viba_annual", () => {
    expect(isPlanProOrAbove("pro_repair")).toBe(true);
    expect(isPlanProOrAbove("admin_full_access")).toBe(true);
    expect(isPlanProOrAbove("viba_monthly")).toBe(true);
    expect(isPlanProOrAbove("viba_annual")).toBe(true);
  });
});

// ─── UPGRADE_MESSAGE ──────────────────────────────────────────────────────────

describe("UPGRADE_MESSAGE", () => {
  it("contains the key upgrade call to action", () => {
    expect(UPGRADE_MESSAGE).toContain("Pro");
    expect(UPGRADE_MESSAGE).toContain("Upgrade");
    expect(UPGRADE_MESSAGE.length).toBeGreaterThan(10);
  });
});

// ─── getPlanDisplayName ───────────────────────────────────────────────────────

describe("getPlanDisplayName", () => {
  it("returns human-readable names for all plans", () => {
    expect(getPlanDisplayName("basic_assessment")).toBe("Basic Assessment");
    expect(getPlanDisplayName("pro_repair")).toBe("Pro Repair");
    expect(getPlanDisplayName("admin_full_access")).toBe("Admin Full Access");
    expect(getPlanDisplayName("viba_annual")).toBe("Pro Repair (Annual)");
    expect(getPlanDisplayName("viba_monthly")).toBe("Pro Repair");
  });

  it("falls back gracefully for unknown plans", () => {
    expect(getPlanDisplayName("unknown" as PlanKey)).toBe("Basic Assessment");
  });
});

// ─── getUserPlan (mocked) ─────────────────────────────────────────────────────

describe("getUserPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the plan_key from the database row", async () => {
    const { pool } = await import("@workspace/db");
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ plan_key: "pro_repair" }],
    } as unknown as ReturnType<typeof pool.query>);

    const { getUserPlan } = await import("./planLimits");
    const result = await getUserPlan(42);
    expect(result).toBe("pro_repair");
  });

  it("falls back to basic_assessment when no row is found", async () => {
    const { pool } = await import("@workspace/db");
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [],
    } as unknown as ReturnType<typeof pool.query>);

    const { getUserPlan } = await import("./planLimits");
    const result = await getUserPlan(99);
    expect(result).toBe("basic_assessment");
  });
});
