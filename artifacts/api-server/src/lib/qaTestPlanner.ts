/**
 * VIBA QA Test Plan Engine
 *
 * Maps changed files / touched areas to the correct QA suites.
 * Pure function — no DB, no side effects.
 * Used by the QA Release Gate to determine what must be verified before release.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type QASuite =
  | "auth"
  | "dashboard"
  | "task_intake"
  | "agent_console"
  | "agent_runtime"
  | "tool_broker"
  | "vault"
  | "custom_ai_byok"
  | "browser_operator"
  | "business_security"
  | "malware_safety"
  | "payments"
  | "credits"
  | "github"
  | "railway"
  | "mobile"
  | "accessibility"
  | "route_registry"
  | "safe_build"
  | "secret_scan"
  | "console_errors";

export type CheckSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface ManualCheck {
  id: string;
  suite: QASuite;
  label: string;
  instructions: string;
  severity: CheckSeverity;
}

export interface BrowserCheck {
  id: string;
  suite: QASuite;
  route: string;
  checkTitle: boolean;
  checkHeading: string | null;
  checkText: string | null;
  checkNoConsoleErrors: boolean;
  mobileViewport: boolean;
  severity: CheckSeverity;
}

export interface ApiCheck {
  id: string;
  suite: QASuite;
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  expectStatus: number;
  forbiddenFields: string[];
  requiredFields: string[];
  severity: CheckSeverity;
}

export interface SecurityCheck {
  id: string;
  suite: QASuite;
  label: string;
  rule: string;
  severity: CheckSeverity;
}

export interface PaymentCheck {
  id: string;
  suite: QASuite;
  label: string;
  requiresApproval: boolean;
  severity: CheckSeverity;
}

export interface VaultCheck {
  id: string;
  suite: QASuite;
  label: string;
  forbiddenFields: string[];
  severity: CheckSeverity;
}

export interface MobileCheck {
  id: string;
  suite: QASuite;
  label: string;
  route: string;
  severity: CheckSeverity;
}

export interface QATestPlanInput {
  appName: string;
  changedFiles: string[];
  changedRoutes: string[];
  touchedAreas: string[];
  strictMode: boolean;
}

export interface QATestPlan {
  testPlanId: string;
  appName: string;
  generatedAt: string;
  strictMode: boolean;
  requiredSuites: QASuite[];
  optionalSuites: QASuite[];
  launchBlockers: string[];
  manualChecks: ManualCheck[];
  browserChecks: BrowserCheck[];
  apiChecks: ApiCheck[];
  securityChecks: SecurityCheck[];
  paymentChecks: PaymentCheck[];
  vaultChecks: VaultCheck[];
  mobileChecks: MobileCheck[];
}

// ─── Suite trigger maps ───────────────────────────────────────────────────────

const FILE_PATTERN_SUITES: Array<{ pattern: RegExp; suites: QASuite[] }> = [
  { pattern: /auth|login|signup|session/i,                     suites: ["auth"] },
  { pattern: /dashboard/i,                                      suites: ["dashboard"] },
  { pattern: /taskIntake|task-intake|task_intake/i,             suites: ["task_intake"] },
  { pattern: /agentConsole|agent-console|agent_console/i,       suites: ["agent_console"] },
  { pattern: /agentRuntime|agent-runtime|agent_runtime/i,       suites: ["agent_runtime"] },
  { pattern: /toolBroker|tool-broker|tool_broker|toolAction/i,  suites: ["tool_broker"] },
  { pattern: /credentials|vault|vibaVault|vibaKeys/i,           suites: ["vault"] },
  { pattern: /customAi|custom-ai|custom_ai|byok/i,              suites: ["custom_ai_byok"] },
  { pattern: /assistedBrowser|browser-operator|browserQa/i,     suites: ["browser_operator"] },
  { pattern: /businessSecurity|business-security/i,             suites: ["business_security"] },
  { pattern: /malware|malwareBuild|malware-build/i,             suites: ["malware_safety"] },
  { pattern: /stripe|billing|payment|credit/i,                  suites: ["payments", "credits"] },
  { pattern: /github/i,                                         suites: ["github"] },
  { pattern: /railway|railwayConnector/i,                       suites: ["railway"] },
  { pattern: /mobile|Navbar|AppLayout/i,                        suites: ["mobile"] },
  { pattern: /index\.ts|routes\/index/i,                        suites: ["route_registry"] },
];

const AREA_SUITES: Record<string, QASuite[]> = {
  auth:             ["auth"],
  dashboard:        ["dashboard"],
  task_intake:      ["task_intake"],
  agent_console:    ["agent_console"],
  agent_runtime:    ["agent_runtime"],
  tool_broker:      ["tool_broker"],
  vault:            ["vault"],
  custom_ai:        ["custom_ai_byok"],
  browser_operator: ["browser_operator"],
  business_security:["business_security"],
  malware:          ["malware_safety"],
  payments:         ["payments", "credits"],
  github:           ["github"],
  railway:          ["railway"],
  mobile:           ["mobile"],
  accessibility:    ["accessibility"],
};

// ─── Always-required suites ───────────────────────────────────────────────────

const ALWAYS_REQUIRED: QASuite[] = ["safe_build", "route_registry", "secret_scan"];

// ─── Code-change-required suites (when any code file changed) ────────────────

const CODE_CHANGE_SUITES: QASuite[] = ["route_registry", "secret_scan"];

// ─── Manual check catalogue ───────────────────────────────────────────────────

const ALL_MANUAL_CHECKS: ManualCheck[] = [
  { id: "mc-login-loads",            suite: "auth",             label: "Login page loads",                                  instructions: "Navigate to /login. Confirm the form renders with no console errors.",           severity: "critical" },
  { id: "mc-dashboard-loads",        suite: "dashboard",        label: "Dashboard loads",                                   instructions: "Log in. Navigate to /dashboard. Confirm session list and controls render.",      severity: "high" },
  { id: "mc-agent-console-loads",    suite: "agent_console",    label: "Agent Console loads",                               instructions: "Navigate to /agent-console. Confirm task input and plan render.",                severity: "high" },
  { id: "mc-tool-console-loads",     suite: "tool_broker",      label: "Tool Console loads",                                instructions: "Navigate to /tool-console. Confirm tool list renders with no secret values.",    severity: "high" },
  { id: "mc-vault-loads",            suite: "vault",            label: "Secure Vault page loads",                           instructions: "Navigate to /credentials. Confirm vault list renders; no encrypted_value shown.", severity: "critical" },
  { id: "mc-byok-clears-input",      suite: "custom_ai_byok",   label: "Custom AI BYOK clears input after save",            instructions: "Save a custom AI key. Confirm the API key input is cleared after save.",          severity: "high" },
  { id: "mc-browser-operator-loads", suite: "browser_operator", label: "Browser Operator page loads",                       instructions: "Navigate to /assisted-browser. Confirm controls render without running tasks.",  severity: "medium" },
  { id: "mc-owner-actions-loads",    suite: "auth",             label: "Owner Actions page loads",                          instructions: "Navigate to /owner-actions. Confirm page renders without auth errors.",           severity: "medium" },
  { id: "mc-mobile-nav",             suite: "mobile",           label: "Mobile nav has no overflow",                        instructions: "Resize browser to 375px width. Confirm Navbar renders without overflow.",         severity: "medium" },
  { id: "mc-no-console-errors",      suite: "console_errors",   label: "No browser console errors on main routes",          instructions: "Open DevTools console. Visit /, /dashboard, /agent-console. No red errors.",     severity: "high" },
];

// ─── Browser check catalogue ──────────────────────────────────────────────────

const ALL_BROWSER_CHECKS: BrowserCheck[] = [
  { id: "bc-home",              suite: "route_registry",   route: "/",                checkTitle: true, checkHeading: "VIBA",            checkText: null,                          checkNoConsoleErrors: true,  mobileViewport: false, severity: "high" },
  { id: "bc-dashboard",         suite: "dashboard",        route: "/dashboard",       checkTitle: true, checkHeading: null,               checkText: null,                          checkNoConsoleErrors: true,  mobileViewport: false, severity: "high" },
  { id: "bc-agent-console",     suite: "agent_console",    route: "/agent-console",   checkTitle: true, checkHeading: "Agent Console",    checkText: null,                          checkNoConsoleErrors: true,  mobileViewport: false, severity: "high" },
  { id: "bc-tool-console",      suite: "tool_broker",      route: "/tool-console",    checkTitle: true, checkHeading: "Tool Console",     checkText: null,                          checkNoConsoleErrors: true,  mobileViewport: false, severity: "high" },
  { id: "bc-credentials",       suite: "vault",            route: "/credentials",     checkTitle: true, checkHeading: null,               checkText: "Vault",                       checkNoConsoleErrors: true,  mobileViewport: false, severity: "critical" },
  { id: "bc-assisted-browser",  suite: "browser_operator", route: "/assisted-browser",checkTitle: true, checkHeading: null,               checkText: null,                          checkNoConsoleErrors: true,  mobileViewport: false, severity: "medium" },
  { id: "bc-owner-actions",     suite: "auth",             route: "/owner-actions",   checkTitle: true, checkHeading: null,               checkText: null,                          checkNoConsoleErrors: false, mobileViewport: false, severity: "medium" },
  { id: "bc-mobile-dashboard",  suite: "mobile",           route: "/dashboard",       checkTitle: false, checkHeading: null,              checkText: null,                          checkNoConsoleErrors: false, mobileViewport: true,  severity: "medium" },
];

// ─── API check catalogue ──────────────────────────────────────────────────────

const ALL_API_CHECKS: ApiCheck[] = [
  {
    id: "ac-credentials-no-raw",   suite: "vault",
    endpoint: "/api/credentials", method: "GET", expectStatus: 200,
    forbiddenFields: ["encrypted_value", "iv", "auth_tag", "value", "raw_key", "secret_value"],
    requiredFields: ["provider", "kind"], severity: "critical",
  },
  {
    id: "ac-custom-ai-no-key",     suite: "custom_ai_byok",
    endpoint: "/api/custom-ai", method: "GET", expectStatus: 200,
    forbiddenFields: ["api_key", "key", "token", "secret", "value", "raw_key"],
    requiredFields: [], severity: "critical",
  },
  {
    id: "ac-tools-no-secrets",     suite: "tool_broker",
    endpoint: "/api/tools", method: "GET", expectStatus: 200,
    forbiddenFields: ["api_key", "secret", "token", "password", "value", "key"],
    requiredFields: ["toolId", "label"], severity: "critical",
  },
  {
    id: "ac-health-ok",            suite: "route_registry",
    endpoint: "/api/health", method: "GET", expectStatus: 200,
    forbiddenFields: [], requiredFields: [], severity: "high",
  },
];

// ─── Security check catalogue ─────────────────────────────────────────────────

const ALL_SECURITY_CHECKS: SecurityCheck[] = [
  { id: "sc-no-raw-api-keys",      suite: "secret_scan",     label: "No raw API keys in responses",            rule: "API responses must not contain sk-*, Bearer tokens, or raw credential values", severity: "critical" },
  { id: "sc-vault-metadata-only",  suite: "vault",           label: "Vault list returns metadata only",         rule: "GET /api/credentials must not return encrypted_value, iv, or auth_tag",         severity: "critical" },
  { id: "sc-byok-metadata-only",   suite: "custom_ai_byok",  label: "Custom AI list returns metadata only",     rule: "GET /api/custom-ai must not return api_key or raw key value",                   severity: "critical" },
  { id: "sc-tool-no-secrets",      suite: "tool_broker",     label: "Tool registry returns no secret values",   rule: "GET /api/tools must not return credentials or auth tokens",                     severity: "critical" },
  { id: "sc-evidence-raw-false",   suite: "agent_runtime",   label: "Evidence report rawValuesReturned=false",  rule: "GET /api/runtime/:id/evidence-report must include rawValuesReturned: false",    severity: "critical" },
  { id: "sc-business-sec-blockers",suite: "business_security",label: "Business security returns blockers",      rule: "POST /api/business-security/plan must return launch blockers when applicable",  severity: "high" },
  { id: "sc-malware-blockers",     suite: "malware_safety",  label: "Malware safety returns upload blockers",   rule: "POST /api/malware-build-safety/plan must return blockers when uploads/builds enabled", severity: "high" },
];

// ─── Payment check catalogue ──────────────────────────────────────────────────

const ALL_PAYMENT_CHECKS: PaymentCheck[] = [
  { id: "pc-payment-requires-approval",    suite: "payments", label: "Payment routes require approval",        requiresApproval: true, severity: "critical" },
  { id: "pc-credits-not-negative",         suite: "credits",  label: "Credits cannot go below zero",           requiresApproval: false, severity: "high" },
  { id: "pc-stripe-webhook-verified",      suite: "payments", label: "Stripe webhook signature verified",      requiresApproval: false, severity: "critical" },
  { id: "pc-credits-pause-on-auth",        suite: "credits",  label: "Browser operator credits pause on auth", requiresApproval: true,  severity: "high" },
];

// ─── Vault check catalogue ────────────────────────────────────────────────────

const ALL_VAULT_CHECKS: VaultCheck[] = [
  {
    id: "vc-no-encrypted-value", suite: "vault",
    label: "Vault list never returns encrypted_value",
    forbiddenFields: ["encrypted_value", "iv", "auth_tag", "value", "raw_key", "secret_value", "password"],
    severity: "critical",
  },
  {
    id: "vc-no-byok-key", suite: "custom_ai_byok",
    label: "Custom AI list never returns raw api_key",
    forbiddenFields: ["api_key", "key", "token", "secret"],
    severity: "critical",
  },
];

// ─── Mobile check catalogue ───────────────────────────────────────────────────

const ALL_MOBILE_CHECKS: MobileCheck[] = [
  { id: "mob-nav-no-overflow",   suite: "mobile", label: "Mobile nav renders without overflow at 375px",  route: "/dashboard",    severity: "medium" },
  { id: "mob-dashboard-usable",  suite: "mobile", label: "Dashboard usable on mobile",                    route: "/dashboard",    severity: "medium" },
  { id: "mob-agent-console",     suite: "mobile", label: "Agent console readable on mobile",              route: "/agent-console",severity: "low" },
];

// ─── Plan builder ─────────────────────────────────────────────────────────────

export function buildQATestPlan(input: QATestPlanInput): QATestPlan {
  const { appName, changedFiles, changedRoutes, touchedAreas, strictMode } = input;

  const suiteSet = new Set<QASuite>(ALWAYS_REQUIRED);

  // Map changed files to suites
  for (const file of changedFiles) {
    for (const { pattern, suites } of FILE_PATTERN_SUITES) {
      if (pattern.test(file)) {
        for (const s of suites) suiteSet.add(s);
      }
    }
  }

  // Map changed routes to suites
  for (const route of changedRoutes) {
    if (/auth|login/i.test(route)) suiteSet.add("auth");
    if (/credential|vault/i.test(route)) { suiteSet.add("vault"); suiteSet.add("secret_scan"); }
    if (/runtime|agent/i.test(route)) suiteSet.add("agent_runtime");
    if (/tool|broker/i.test(route)) suiteSet.add("tool_broker");
    if (/billing|stripe|payment|credit/i.test(route)) { suiteSet.add("payments"); suiteSet.add("credits"); }
    if (/browser|assisted/i.test(route)) suiteSet.add("browser_operator");
    if (/railway/i.test(route)) suiteSet.add("railway");
  }

  // Map touched areas to suites
  for (const area of touchedAreas) {
    const mapped = AREA_SUITES[area.toLowerCase()];
    if (mapped) for (const s of mapped) suiteSet.add(s);
  }

  // Code change always adds these
  if (changedFiles.length > 0) {
    for (const s of CODE_CHANGE_SUITES) suiteSet.add(s);
  }

  // Strict mode adds all suites
  if (strictMode) {
    for (const s of ALL_SECURITY_CHECKS.map((c) => c.suite)) suiteSet.add(s);
    suiteSet.add("mobile");
    suiteSet.add("accessibility");
    suiteSet.add("console_errors");
  }

  const requiredSuites = [...suiteSet];

  // Optional suites: anything from full catalogue not in required
  const allSuites: QASuite[] = [
    "auth", "dashboard", "task_intake", "agent_console", "agent_runtime",
    "tool_broker", "vault", "custom_ai_byok", "browser_operator",
    "business_security", "malware_safety", "payments", "credits",
    "github", "railway", "mobile", "accessibility", "route_registry",
    "safe_build", "secret_scan", "console_errors",
  ];
  const optionalSuites = allSuites.filter((s) => !suiteSet.has(s));

  // Launch blockers
  const launchBlockers: string[] = [];
  if (!suiteSet.has("auth")) {
    launchBlockers.push("auth suite not triggered — verify login/signup flows are working");
  }
  if (suiteSet.has("payments") && !suiteSet.has("credits")) {
    launchBlockers.push("payments touched but credits suite not included — verify credit gate");
  }
  if (suiteSet.has("browser_operator") && !suiteSet.has("safe_build")) {
    launchBlockers.push("browser_operator touched — safe_build is required before browser automation");
  }
  if (suiteSet.has("railway") || suiteSet.has("github")) {
    launchBlockers.push("deploy tools touched — DNS/deploy routes must require approval before execution");
  }
  if (suiteSet.has("malware_safety")) {
    launchBlockers.push("upload/build area touched — malware safety plan must be verified");
  }
  if (strictMode && launchBlockers.length === 0) {
    launchBlockers.push("Strict mode: all suites required. No auto-approval. Owner must review final report.");
  }

  // Filter checks to relevant suites
  const manualChecks = ALL_MANUAL_CHECKS.filter((c) => suiteSet.has(c.suite));
  const browserChecks = ALL_BROWSER_CHECKS.filter((c) => suiteSet.has(c.suite));
  const apiChecks = ALL_API_CHECKS.filter((c) => suiteSet.has(c.suite));
  const securityChecks = ALL_SECURITY_CHECKS.filter((c) => suiteSet.has(c.suite));
  const paymentChecks = ALL_PAYMENT_CHECKS.filter((c) => suiteSet.has(c.suite));
  const vaultChecks = ALL_VAULT_CHECKS.filter((c) => suiteSet.has(c.suite));
  const mobileChecks = ALL_MOBILE_CHECKS.filter((c) => suiteSet.has(c.suite));

  return {
    testPlanId: `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    appName,
    generatedAt: new Date().toISOString(),
    strictMode,
    requiredSuites,
    optionalSuites,
    launchBlockers,
    manualChecks,
    browserChecks,
    apiChecks,
    securityChecks,
    paymentChecks,
    vaultChecks,
    mobileChecks,
  };
}
