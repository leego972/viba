/**
 * Unit tests for the VIBA Approval Gate (pure module).
 */
import { describe, it, expect } from "vitest";
import { requiresApproval, buildApprovalLogEntry, assertApproved } from "./approvalGate";

describe("requiresApproval", () => {
  // 1 — Repository writes
  it("requires approval for github.pushFile", () => {
    const d = requiresApproval("github.pushFile");
    expect(d.required).toBe(true);
    expect(d.categories).toContain("repository_write");
  });

  it("requires approval for github.createBranch", () => {
    const d = requiresApproval("github.createBranch");
    expect(d.required).toBe(true);
    expect(d.categories).toContain("repository_write");
  });

  it("requires approval for github.mergePullRequest", () => {
    const d = requiresApproval("github.mergePullRequest");
    expect(d.required).toBe(true);
    expect(d.categories).toContain("repository_write");
  });

  it("does NOT require approval for github.getFile (read-only)", () => {
    const d = requiresApproval("github.getFile");
    expect(d.categories).not.toContain("repository_write");
  });

  it("does NOT require approval for github.getTree (read-only)", () => {
    const d = requiresApproval("github.getTree");
    expect(d.categories).not.toContain("repository_write");
  });

  // 2 — Deployment changes
  it("requires approval for railway.deploy", () => {
    const d = requiresApproval("railway.deploy");
    expect(d.required).toBe(true);
    expect(d.categories).toContain("deployment_change");
  });

  it("requires approval for render.rollback", () => {
    const d = requiresApproval("render.rollback");
    expect(d.required).toBe(true);
    expect(d.categories).toContain("deployment_change");
  });

  it("requires approval for vercel.deploy", () => {
    const d = requiresApproval("vercel.deploy");
    expect(d.required).toBe(true);
    expect(d.categories).toContain("deployment_change");
  });

  // 3 — Billing changes
  it("requires approval for stripe.createSubscription", () => {
    const d = requiresApproval("stripe.createSubscription");
    expect(d.required).toBe(true);
    expect(d.categories).toContain("billing_change");
  });

  it("requires approval for billing.cancel", () => {
    const d = requiresApproval("billing.cancel");
    expect(d.required).toBe(true);
    expect(d.categories).toContain("billing_change");
  });

  // 4 — Provider key changes
  it("requires approval for credentials.set", () => {
    const d = requiresApproval("credentials.set");
    expect(d.required).toBe(true);
    expect(d.categories).toContain("provider_key_change");
  });

  it("requires approval for vault.write", () => {
    const d = requiresApproval("vault.write");
    expect(d.required).toBe(true);
    expect(d.categories).toContain("provider_key_change");
  });

  // 5 — Domain / DNS changes
  it("requires approval for dns.addRecord", () => {
    const d = requiresApproval("dns.addRecord");
    expect(d.required).toBe(true);
    expect(d.categories).toContain("domain_dns_change");
  });

  it("requires approval for domain.remove", () => {
    const d = requiresApproval("domain.remove");
    expect(d.required).toBe(true);
    expect(d.categories).toContain("domain_dns_change");
  });

  // 6 — Destructive operations
  it("requires approval for database.drop", () => {
    const d = requiresApproval("database.drop");
    expect(d.required).toBe(true);
    expect(d.categories).toContain("destructive_operation");
  });

  it("requires approval for user.delete", () => {
    const d = requiresApproval("user.delete");
    expect(d.required).toBe(true);
    expect(d.categories).toContain("destructive_operation");
  });

  // 7 — Customer-facing publication
  it("requires approval for customer-facing publish", () => {
    const d = requiresApproval("content.publish", { isCustomerFacing: true });
    expect(d.required).toBe(true);
    expect(d.categories).toContain("customer_facing_publication");
  });

  it("does NOT flag customer_facing when isCustomerFacing is false", () => {
    const d = requiresApproval("content.publish", { isCustomerFacing: false });
    expect(d.categories).not.toContain("customer_facing_publication");
  });

  // 8 — High-cost escalation
  it("requires approval when cost exceeds 40% of budget ceiling", () => {
    const d = requiresApproval("agent.run", {
      estimatedCredits: 50,
      budgetCeiling: 100,
    });
    expect(d.required).toBe(true);
    expect(d.categories).toContain("high_cost_escalation");
  });

  it("does NOT require cost approval when cost is within 40% of budget", () => {
    const d = requiresApproval("agent.run", {
      estimatedCredits: 30,
      budgetCeiling: 100,
    });
    expect(d.categories).not.toContain("high_cost_escalation");
  });

  // 9 — Out of scope
  it("requires approval when action is outside stated scope", () => {
    const d = requiresApproval("task.execute", { inScope: false });
    expect(d.required).toBe(true);
    expect(d.categories).toContain("out_of_scope");
  });

  it("does NOT require out-of-scope approval when inScope is true", () => {
    const d = requiresApproval("task.execute", { inScope: true });
    expect(d.categories).not.toContain("out_of_scope");
  });

  // — Multiple categories at once
  it("can flag multiple categories for a single action", () => {
    const d = requiresApproval("railway.deploy", {
      isCustomerFacing: true,
      estimatedCredits: 80,
      budgetCeiling: 100,
      inScope: false,
    });
    expect(d.categories.length).toBeGreaterThanOrEqual(3);
    expect(d.categories).toContain("deployment_change");
    expect(d.categories).toContain("customer_facing_publication");
    expect(d.categories).toContain("high_cost_escalation");
    expect(d.categories).toContain("out_of_scope");
  });

  // — Safe read-only actions
  it("does NOT require approval for a safe read-only action with no context flags", () => {
    const d = requiresApproval("github.getFile", {
      estimatedCredits: 1,
      budgetCeiling: 1000,
      inScope: true,
      isCustomerFacing: false,
    });
    expect(d.required).toBe(false);
    expect(d.categories).toHaveLength(0);
  });

  // — Reasons are populated
  it("populates human-readable reasons for each triggered category", () => {
    const d = requiresApproval("github.pushFile");
    expect(d.reasons.length).toBeGreaterThan(0);
    expect(d.reasons[0]).toContain("github.pushFile");
  });
});

describe("buildApprovalLogEntry", () => {
  it("produces a structured log entry", () => {
    const decision = requiresApproval("railway.deploy");
    const entry = buildApprovalLogEntry("railway.deploy", decision, "granted", { userId: 1, sessionId: 42 }, "Owner clicked Approve");
    expect(entry.action).toBe("railway.deploy");
    expect(entry.outcome).toBe("granted");
    expect(entry.userId).toBe(1);
    expect(entry.note).toBe("Owner clicked Approve");
    expect(entry.at).toBeTruthy();
  });
});

describe("assertApproved", () => {
  it("throws when approval is required but not granted", () => {
    const decision = requiresApproval("railway.deploy");
    expect(() => assertApproved("railway.deploy", "rejected", decision)).toThrow();
    expect(() => assertApproved("railway.deploy", "pending", decision)).toThrow();
  });

  it("does NOT throw when approval is granted", () => {
    const decision = requiresApproval("railway.deploy");
    expect(() => assertApproved("railway.deploy", "granted", decision)).not.toThrow();
  });

  it("does NOT throw when approval is not required", () => {
    const decision = requiresApproval("github.getFile");
    expect(() => assertApproved("github.getFile", "pending", decision)).not.toThrow();
  });
});
