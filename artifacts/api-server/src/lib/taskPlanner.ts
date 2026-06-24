/**
 * VIBA Task Planner
 *
 * Analyzes a user's natural-language request and produces a structured plan.
 * Uses rule-based analysis first; if GROQ_API_KEY is available, enhances the
 * plan with a Groq coordinator pass.
 *
 * Never includes raw credential values. Credential references use
 * provider/kind/scope only.
 */

export type AgentType =
  | "coordinator"
  | "builder"
  | "security"
  | "payments"
  | "credits"
  | "deployment"
  | "browser_operator"
  | "research"
  | "tester"
  | "reviewer";

export type RiskLevel = "low" | "medium" | "high";

export interface PlanStep {
  stepNumber: number;
  title: string;
  description: string;
  assignedAgent: AgentType;
  requiresApproval: boolean;
  safeBuildCheckpoint: boolean;
}

export interface RequiredTool {
  toolId: string;
  reason: string;
  riskLevel: string;
  requiresApproval: boolean;
  supportsDryRun: boolean;
}

export interface TaskPlan {
  summary: string;
  taskType: string;
  requiredAgents: AgentType[];
  requiredCredentials: Array<{ provider: string; kind: string; scope: string }>;
  requiredTools: RequiredTool[];
  recommendedBYOK: boolean;
  byokSuggestion: string | null;
  approvalRequired: boolean;
  approvalReasons: string[];
  riskLevel: RiskLevel;
  steps: PlanStep[];
  blockers: string[];
  safeBuildRequired: boolean;
  planSource: "rules" | "groq" | "rules+groq";
}

// ─── Keyword sets ─────────────────────────────────────────────────────────────

const CODE_KEYWORDS = /\b(build|code|implement|develop|create|write|fix|refactor|migrate|upgrade|scaffold|generate)\b/i;
const DEPLOY_KEYWORDS = /\b(deploy|deployment|release|launch|publish|ship|railway|production|prod|go.?live|vercel|netlify|heroku)\b/i;
const SECURITY_KEYWORDS = /\b(secure|security|harden|auth|authentication|authorization|2fa|mfa|passkey|oauth|jwt|cors|csp|headers|ssl|tls|https|rate.?limit|firewall)\b/i;
const PAYMENT_KEYWORDS = /\b(payment|stripe|checkout|billing|subscription|plan|pricing|webhook|invoice|credit.?card|charge|revenue|monetize|shop)\b/i;
const SERVER_KEYWORDS = /\b(server|api|backend|express|node|database|db|postgres|mysql|redis|endpoint|route|middleware)\b/i;
const BROWSER_KEYWORDS = /\b(browser|login|oauth.?flow|sign.?in|click|form|page|navigate|screenshot|crawl|scrape|automate)\b/i;
const TEST_KEYWORDS = /\b(test|testing|spec|coverage|vitest|jest|playwright|e2e|end.?to.?end|qa|verify|validate)\b/i;
const RESEARCH_KEYWORDS = /\b(research|analyse|analyze|compare|investigate|evaluate|summarize|report|document)\b/i;
const APPROVAL_KEYWORDS = /\b(payment|stripe|webhook|railway|env.?var|environment.?var|dns|oauth|passkey|2fa|mfa|delete|remove|drop|production|deploy|launch|publish|secret|token|credential|uploaded.?code|run.?script)\b/i;

// ─── Rule-based planner ───────────────────────────────────────────────────────

function detectTaskType(request: string): string {
  if (PAYMENT_KEYWORDS.test(request)) return "payments";
  if (DEPLOY_KEYWORDS.test(request)) return "deployment";
  if (SECURITY_KEYWORDS.test(request)) return "security";
  if (CODE_KEYWORDS.test(request)) return "build";
  if (TEST_KEYWORDS.test(request)) return "testing";
  if (RESEARCH_KEYWORDS.test(request)) return "research";
  if (BROWSER_KEYWORDS.test(request)) return "browser_automation";
  if (SERVER_KEYWORDS.test(request)) return "backend";
  return "general";
}

function selectAgents(request: string, taskType: string): AgentType[] {
  const agents = new Set<AgentType>(["coordinator"]);
  if (CODE_KEYWORDS.test(request) || SERVER_KEYWORDS.test(request)) agents.add("builder");
  if (SECURITY_KEYWORDS.test(request) || taskType === "security") agents.add("security");
  if (PAYMENT_KEYWORDS.test(request) || taskType === "payments") agents.add("payments");
  if (DEPLOY_KEYWORDS.test(request) || taskType === "deployment") agents.add("deployment");
  if (BROWSER_KEYWORDS.test(request)) agents.add("browser_operator");
  if (TEST_KEYWORDS.test(request)) agents.add("tester");
  if (RESEARCH_KEYWORDS.test(request)) agents.add("research");
  if (agents.size > 2) agents.add("reviewer");
  return [...agents];
}

function detectRisk(request: string, taskType: string): RiskLevel {
  if (PAYMENT_KEYWORDS.test(request) || DEPLOY_KEYWORDS.test(request) || taskType === "deployment" || taskType === "payments") return "high";
  if (SECURITY_KEYWORDS.test(request) || SERVER_KEYWORDS.test(request) || taskType === "security") return "medium";
  return "low";
}

function detectApproval(request: string): { required: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (PAYMENT_KEYWORDS.test(request)) reasons.push("Task involves payment or billing changes");
  if (/\b(deploy|launch|publish|production|prod|go.?live)\b/i.test(request)) reasons.push("Task involves production deployment");
  if (/\b(dns|railway.?env|webhook|secret|token)\b/i.test(request)) reasons.push("Task involves infrastructure or secret changes");
  if (/\b(delete|remove|drop|clear|reset)\b/i.test(request)) reasons.push("Task involves potentially destructive operations");
  if (/\b(oauth|passkey|2fa|mfa|sign.?in|browser.?login)\b/i.test(request)) reasons.push("Task involves authentication or browser handoff");
  if (/\b(run.?uploaded|execute.?uploaded|run.?script)\b/i.test(request)) reasons.push("Task involves running uploaded or external code");
  return { required: reasons.length > 0, reasons };
}

function detectSafeBuild(request: string, taskType: string): boolean {
  return (
    CODE_KEYWORDS.test(request) ||
    DEPLOY_KEYWORDS.test(request) ||
    SECURITY_KEYWORDS.test(request) ||
    PAYMENT_KEYWORDS.test(request) ||
    SERVER_KEYWORDS.test(request) ||
    taskType === "build" ||
    taskType === "deployment" ||
    taskType === "security" ||
    taskType === "payments" ||
    taskType === "backend"
  );
}

function buildSteps(request: string, agents: AgentType[], taskType: string, approvalRequired: boolean, safeBuildRequired: boolean): PlanStep[] {
  const steps: PlanStep[] = [];
  let n = 1;

  steps.push({
    stepNumber: n++,
    title: "Analyze request",
    description: "Coordinator reviews the request, identifies scope, assigns agents, and flags blockers.",
    assignedAgent: "coordinator",
    requiresApproval: false,
    safeBuildCheckpoint: false,
  });

  if (agents.includes("research")) {
    steps.push({ stepNumber: n++, title: "Research phase", description: "Research agent collects background information, documentation, or competitive data relevant to the task.", assignedAgent: "research", requiresApproval: false, safeBuildCheckpoint: false });
  }

  if (agents.includes("security")) {
    steps.push({ stepNumber: n++, title: "Security review", description: "Security agent audits the planned changes for vulnerabilities, checks auth, CORS, rate limits, and secrets handling.", assignedAgent: "security", requiresApproval: false, safeBuildCheckpoint: false });
  }

  if (agents.includes("builder")) {
    steps.push({ stepNumber: n++, title: "Build implementation", description: "Builder agent writes or modifies code to fulfill the task requirements, following VIBA coding standards.", assignedAgent: "builder", requiresApproval: false, safeBuildCheckpoint: false });
  }

  if (agents.includes("payments")) {
    steps.push({ stepNumber: n++, title: "Payments integration", description: "Payments agent handles Stripe configuration, webhook setup, and billing changes.", assignedAgent: "payments", requiresApproval: true, safeBuildCheckpoint: false });
  }

  if (agents.includes("browser_operator")) {
    steps.push({ stepNumber: n++, title: "Browser automation", description: "Browser operator handles supervised web interactions. User approval required before any login handoff.", assignedAgent: "browser_operator", requiresApproval: true, safeBuildCheckpoint: false });
  }

  if (agents.includes("tester")) {
    steps.push({ stepNumber: n++, title: "Testing", description: "Tester agent runs automated tests, checks coverage, and validates the implementation meets requirements.", assignedAgent: "tester", requiresApproval: false, safeBuildCheckpoint: false });
  }

  if (safeBuildRequired) {
    steps.push({ stepNumber: n++, title: "Safe build gate", description: "Run `pnpm run safe-build`: typecheck, API tests, API build, frontend build. Must pass before deployment.", assignedAgent: "coordinator", requiresApproval: false, safeBuildCheckpoint: true });
  }

  if (agents.includes("deployment")) {
    steps.push({ stepNumber: n++, title: "Deployment", description: "Deployment agent pushes to Railway. User approval required before any production release.", assignedAgent: "deployment", requiresApproval: true, safeBuildCheckpoint: false });
  }

  if (agents.includes("reviewer")) {
    steps.push({ stepNumber: n++, title: "Final review & evidence report", description: "Reviewer agent verifies all steps completed, produces evidence report. No secrets included.", assignedAgent: "reviewer", requiresApproval: false, safeBuildCheckpoint: false });
  }

  return steps;
}

const DNS_KEYWORDS = /\b(dns|cname|a.?record|mx.?record|txt.?record|nameserver|godaddy|cloudflare|domain)\b/i;

function detectRequiredTools(request: string, taskType: string, agents: AgentType[]): RequiredTool[] {
  const tools: RequiredTool[] = [];

  // Always included
  tools.push({ toolId: "report.evidence.generate", reason: "Final evidence report for every task", riskLevel: "read_only", requiresApproval: false, supportsDryRun: false });

  if (DEPLOY_KEYWORDS.test(request) || taskType === "deployment" || agents.includes("deployment")) {
    tools.push({ toolId: "railway.env.read",       reason: "Check current Railway environment configuration", riskLevel: "read_only",   requiresApproval: false, supportsDryRun: false });
    tools.push({ toolId: "railway.deploy.status",  reason: "Monitor deployment health",                      riskLevel: "read_only",   requiresApproval: false, supportsDryRun: false });
    tools.push({ toolId: "railway.env.write",      reason: "Set production environment variables",           riskLevel: "high",        requiresApproval: true,  supportsDryRun: true });
    tools.push({ toolId: "railway.deploy.trigger", reason: "Trigger production deployment",                  riskLevel: "destructive", requiresApproval: true,  supportsDryRun: true });
    tools.push({ toolId: "build.safe_build",       reason: "Safe build gate required before deploy",         riskLevel: "read_only",   requiresApproval: false, supportsDryRun: false });
  }

  if (PAYMENT_KEYWORDS.test(request) || taskType === "payments" || agents.includes("payments")) {
    tools.push({ toolId: "stripe.products.read",  reason: "Read current Stripe product/price catalog", riskLevel: "read_only", requiresApproval: false, supportsDryRun: false });
    tools.push({ toolId: "stripe.products.write", reason: "Create or update Stripe products/prices",   riskLevel: "high",      requiresApproval: true,  supportsDryRun: true });
    tools.push({ toolId: "stripe.webhook.verify", reason: "Verify Stripe webhook signatures",          riskLevel: "read_only", requiresApproval: false, supportsDryRun: false });
    tools.push({ toolId: "credits.ledger.read",   reason: "Read user credit balance",                  riskLevel: "read_only", requiresApproval: false, supportsDryRun: false });
  }

  if (DNS_KEYWORDS.test(request)) {
    tools.push({ toolId: "dns.records.read",  reason: "Read current DNS configuration",             riskLevel: "read_only", requiresApproval: false, supportsDryRun: false });
    tools.push({ toolId: "dns.records.write", reason: "Create/update DNS records (exact preview shown)", riskLevel: "high", requiresApproval: true, supportsDryRun: true });
  }

  if (CODE_KEYWORDS.test(request) || SERVER_KEYWORDS.test(request) || taskType === "build" || taskType === "backend" || agents.includes("builder")) {
    if (!tools.some((t) => t.toolId === "build.safe_build")) {
      tools.push({ toolId: "build.safe_build", reason: "Typecheck, tests, and build must pass", riskLevel: "read_only", requiresApproval: false, supportsDryRun: false });
    }
    if (/github/i.test(request) || taskType === "build") {
      tools.push({ toolId: "github.repo.read",  reason: "Read repository files",    riskLevel: "read_only", requiresApproval: false, supportsDryRun: false });
      tools.push({ toolId: "github.repo.write", reason: "Commit changes to branch", riskLevel: "medium",    requiresApproval: false, supportsDryRun: true });
      tools.push({ toolId: "github.pr.create",  reason: "Open pull request for review", riskLevel: "low",  requiresApproval: false, supportsDryRun: true });
    }
  }

  if (SECURITY_KEYWORDS.test(request) || taskType === "security") {
    tools.push({ toolId: "security.business_plan", reason: "Security hardening plan",    riskLevel: "read_only", requiresApproval: false, supportsDryRun: false });
    tools.push({ toolId: "security.malware_plan",  reason: "Build/upload safety review", riskLevel: "read_only", requiresApproval: false, supportsDryRun: false });
    if (!tools.some((t) => t.toolId === "build.safe_build")) {
      tools.push({ toolId: "build.safe_build", reason: "Safe build required for security tasks", riskLevel: "read_only", requiresApproval: false, supportsDryRun: false });
    }
  }

  if (BROWSER_KEYWORDS.test(request) || agents.includes("browser_operator")) {
    tools.push({ toolId: "browser.open",            reason: "Open supervised browser session",          riskLevel: "low",  requiresApproval: false, supportsDryRun: true });
    tools.push({ toolId: "browser.authorized_action", reason: "Supervised form/auth action (user approval required)", riskLevel: "high", requiresApproval: true, supportsDryRun: true });
  }

  if (TEST_KEYWORDS.test(request) || taskType === "testing" || agents.includes("tester")) {
    if (!tools.some((t) => t.toolId === "build.safe_build")) {
      tools.push({ toolId: "build.safe_build", reason: "Run full test suite via safe-build gate", riskLevel: "read_only", requiresApproval: false, supportsDryRun: false });
    }
  }

  if (agents.includes("reviewer")) {
    if (!tools.some((t) => t.toolId === "vault.credential.status")) {
      tools.push({ toolId: "vault.credential.status", reason: "Check credential availability for evidence report", riskLevel: "read_only", requiresApproval: false, supportsDryRun: false });
    }
  }

  // Deduplicate by toolId
  const seen = new Set<string>();
  return tools.filter((t) => { if (seen.has(t.toolId)) return false; seen.add(t.toolId); return true; });
}

function detectRequiredCredentials(request: string, taskType: string): Array<{ provider: string; kind: string; scope: string }> {
  const creds: Array<{ provider: string; kind: string; scope: string }> = [];
  if (PAYMENT_KEYWORDS.test(request)) creds.push({ provider: "stripe", kind: "api_key", scope: "payments" });
  if (DEPLOY_KEYWORDS.test(request) || /railway/i.test(request)) creds.push({ provider: "railway", kind: "token", scope: "deployment" });
  if (/github/i.test(request)) creds.push({ provider: "github", kind: "token", scope: "repository" });
  return creds;
}

// ─── Groq coordinator pass (optional enrichment) ──────────────────────────────

async function enrichWithGroq(request: string, rulePlan: TaskPlan): Promise<Partial<TaskPlan>> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return {};

  try {
    const systemPrompt = `You are VIBA's task coordinator. Analyze the user request and improve the task plan.
Return ONLY valid JSON matching this schema (no markdown, no prose):
{
  "summary": "one-paragraph plain summary of what will be done",
  "taskType": "string",
  "blockers": ["string"],
  "riskLevel": "low|medium|high"
}
Rules:
- Groq is the default coordinator. Never say VIBA provides third-party AI models.
- Keep summary under 200 words.
- blockers should be empty [] if none.
- Be concise.`;

    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `User request: "${request}"\n\nRule-based plan summary: "${rulePlan.summary}"\nTask type: ${rulePlan.taskType}\nRisk: ${rulePlan.riskLevel}` },
        ],
        max_tokens: 300,
        temperature: 0.2,
      }),
    });

    if (!resp.ok) return {};
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as Partial<TaskPlan>;
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      taskType: typeof parsed.taskType === "string" ? parsed.taskType : undefined,
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers : undefined,
      riskLevel: (["low", "medium", "high"] as RiskLevel[]).includes(parsed.riskLevel as RiskLevel) ? (parsed.riskLevel as RiskLevel) : undefined,
    };
  } catch {
    return {};
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface PlannerInput {
  request: string;
  savedCustomAis?: Array<{ provider: string; name: string }>;
  savedCredentials?: Array<{ provider: string; kind: string }>;
}

export async function planTask(input: PlannerInput): Promise<TaskPlan> {
  const { request, savedCustomAis = [], savedCredentials = [] } = input;
  const trimmed = request.trim();

  const taskType = detectTaskType(trimmed);
  const agents = selectAgents(trimmed, taskType);
  const riskLevel = detectRisk(trimmed, taskType);
  const { required: approvalRequired, reasons: approvalReasons } = detectApproval(trimmed);
  const safeBuildRequired = detectSafeBuild(trimmed, taskType);
  const requiredCredentials = detectRequiredCredentials(trimmed, taskType);
  const requiredTools = detectRequiredTools(trimmed, taskType, agents);
  const steps = buildSteps(trimmed, agents, taskType, approvalRequired, safeBuildRequired);

  const hasCustomAis = savedCustomAis.length > 0;
  const isComplex = agents.length >= 3 || riskLevel === "high";

  const rulePlan: TaskPlan = {
    summary: `VIBA will ${trimmed.length > 120 ? trimmed.slice(0, 117) + "…" : trimmed}. Groq coordinates the workflow. ${agents.length} agent${agents.length !== 1 ? "s" : ""} assigned.`,
    taskType,
    requiredAgents: agents,
    requiredCredentials,
    requiredTools,
    recommendedBYOK: isComplex && !hasCustomAis,
    byokSuggestion: isComplex && !hasCustomAis
      ? "This is a complex task. Connecting additional AI accounts (BYOK) can improve analysis quality. Groq will be used by default."
      : hasCustomAis && isComplex
        ? "You have saved AI connections available. The coordinator can route specialist sub-tasks to them."
        : null,
    approvalRequired,
    approvalReasons,
    riskLevel,
    steps,
    blockers: [],
    safeBuildRequired,
    planSource: "rules",
  };

  // Enrich with Groq if available
  const groqEnrichment = await enrichWithGroq(trimmed, rulePlan);
  const hasGroqEnrichment = Object.keys(groqEnrichment).length > 0;

  return {
    ...rulePlan,
    ...groqEnrichment,
    // preserve these — don't let Groq override them
    requiredAgents: agents,
    requiredCredentials,
    steps,
    approvalRequired,
    approvalReasons,
    safeBuildRequired,
    recommendedBYOK: rulePlan.recommendedBYOK,
    byokSuggestion: rulePlan.byokSuggestion,
    planSource: hasGroqEnrichment ? "rules+groq" : "rules",
  };
}
