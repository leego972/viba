/**
 * VIBA Approval Gate — Pure Module
 *
 * Determines whether a task or action requires explicit owner approval before
 * the agent is allowed to proceed. Also logs approval/rejection events.
 *
 * No DB calls in the pure functions — logging helpers accept a log callback.
 * Do NOT remove this gate from sensitive code paths.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApprovalCategory =
  | "repository_write"
  | "deployment_change"
  | "billing_change"
  | "provider_key_change"
  | "domain_dns_change"
  | "destructive_operation"
  | "customer_facing_publication"
  | "high_cost_escalation"
  | "out_of_scope";

export interface ApprovalContext {
  userId?: number;
  sessionId?: number | string;
  taskType?: string;
  /** Tool or action being requested */
  action?: string;
  /** Approximate credit cost of the action */
  estimatedCredits?: number;
  /** Session credit budget ceiling */
  budgetCeiling?: number;
  /** Whether the task is within the user's stated project scope */
  inScope?: boolean;
  /** Whether this publishes content visible to end customers */
  isCustomerFacing?: boolean;
}

export interface ApprovalDecision {
  required: boolean;
  categories: ApprovalCategory[];
  reasons: string[];
}

export type ApprovalOutcome = "granted" | "rejected" | "pending";

export interface ApprovalLogEntry {
  at: string;
  userId?: number;
  sessionId?: number | string;
  action?: string;
  categories: ApprovalCategory[];
  outcome: ApprovalOutcome;
  note?: string;
}

// ─── Category detection ───────────────────────────────────────────────────────

/**
 * Keywords that flag a repository write action.
 * Read-only GitHub calls (getFile, getTree, getRef) never trigger this.
 */
const REPO_WRITE_ACTIONS = [
  "github.pushFile", "github.createBranch", "github.mergePullRequest",
  "github.deleteBranch", "github.createPR", "github.updateFile",
  "github.deleteFile", "git.push", "git.commit",
];

const DEPLOYMENT_ACTIONS = [
  "railway.deploy", "railway.rollback", "railway.restart",
  "render.deploy", "render.rollback", "vercel.deploy", "vercel.rollback",
  "do.deploy", "sevalla.deploy", "deployment.trigger", "deploy",
];

const BILLING_ACTIONS = [
  "stripe.createSubscription", "stripe.cancelSubscription", "stripe.charge",
  "billing.upgrade", "billing.downgrade", "billing.cancel",
  "credits.deduct", "subscription.change",
];

const KEY_ACTIONS = [
  "credentials.set", "credentials.delete", "apiKey.rotate",
  "providerKey.update", "settings.setApiKey", "vault.write",
];

const DNS_ACTIONS = [
  "dns.addRecord", "dns.deleteRecord", "domain.add", "domain.remove",
  "godaddy.updateRecord", "cloudflare.updateRecord",
];

const DESTRUCTIVE_ACTIONS = [
  "database.drop", "database.truncate", "database.delete",
  "file.deleteAll", "repo.delete", "session.purge",
  "user.delete", "account.delete",
];

function matchesAction(action: string, list: string[]): boolean {
  const lower = action.toLowerCase();
  return list.some((a) => lower.includes(a.toLowerCase()));
}

// ─── Pure approval checker ────────────────────────────────────────────────────

/**
 * Determine whether an action requires owner approval.
 * Returns the set of triggered categories and human-readable reasons.
 */
export function requiresApproval(
  action: string,
  context: ApprovalContext = {},
): ApprovalDecision {
  const categories: ApprovalCategory[] = [];
  const reasons: string[] = [];

  // 1 — Repository write
  if (matchesAction(action, REPO_WRITE_ACTIONS)) {
    categories.push("repository_write");
    reasons.push(`Action "${action}" writes to a repository. Owner must confirm before any GitHub mutation.`);
  }

  // 2 — Deployment change
  if (matchesAction(action, DEPLOYMENT_ACTIONS)) {
    categories.push("deployment_change");
    reasons.push(`Action "${action}" triggers a production deployment. Requires explicit sign-off.`);
  }

  // 3 — Billing change
  if (matchesAction(action, BILLING_ACTIONS)) {
    categories.push("billing_change");
    reasons.push(`Action "${action}" modifies billing or subscription state. Owner approval required.`);
  }

  // 4 — Provider key change
  if (matchesAction(action, KEY_ACTIONS)) {
    categories.push("provider_key_change");
    reasons.push(`Action "${action}" modifies API keys or provider credentials. Sensitive — must be owner-approved.`);
  }

  // 5 — Domain / DNS change
  if (matchesAction(action, DNS_ACTIONS)) {
    categories.push("domain_dns_change");
    reasons.push(`Action "${action}" modifies DNS or domain settings. Owner approval required.`);
  }

  // 6 — Destructive operation
  if (matchesAction(action, DESTRUCTIVE_ACTIONS)) {
    categories.push("destructive_operation");
    reasons.push(`Action "${action}" is destructive and irreversible. Owner must confirm.`);
  }

  // 7 — Customer-facing publication
  if (context.isCustomerFacing === true) {
    categories.push("customer_facing_publication");
    reasons.push("This action publishes content visible to customers. Owner must approve before going live.");
  }

  // 8 — High-cost model escalation
  if (
    typeof context.estimatedCredits === "number" &&
    typeof context.budgetCeiling === "number" &&
    context.estimatedCredits > context.budgetCeiling * 0.4
  ) {
    categories.push("high_cost_escalation");
    reasons.push(
      `Estimated cost (${context.estimatedCredits} credits) exceeds 40% of budget ceiling (${context.budgetCeiling} credits). ` +
      "Owner must approve high-cost escalation."
    );
  }

  // 9 — Out of stated scope
  if (context.inScope === false) {
    categories.push("out_of_scope");
    reasons.push("This action is outside the user's stated project scope. Owner must approve scope expansion.");
  }

  return {
    required: categories.length > 0,
    categories,
    reasons,
  };
}

// ─── Logging helper ───────────────────────────────────────────────────────────

/**
 * Build a structured log entry for an approval decision.
 * Pass a `persist` callback to write to DB — keeps this module pure.
 */
export function buildApprovalLogEntry(
  action: string,
  decision: ApprovalDecision,
  outcome: ApprovalOutcome,
  context: ApprovalContext = {},
  note?: string,
): ApprovalLogEntry {
  return {
    at: new Date().toISOString(),
    userId: context.userId,
    sessionId: context.sessionId,
    action,
    categories: decision.categories,
    outcome,
    note,
  };
}

/**
 * Assert that an action has been approved. Throws if approval was required but
 * not granted. Use in agent execution paths before any sensitive tool call.
 */
export function assertApproved(
  action: string,
  outcome: ApprovalOutcome,
  decision: ApprovalDecision,
): void {
  if (decision.required && outcome !== "granted") {
    throw new Error(
      `Action "${action}" requires owner approval (${decision.categories.join(", ")}) ` +
      `but was not granted (outcome: ${outcome}). ` +
      "The agent cannot proceed without explicit approval."
    );
  }
}
