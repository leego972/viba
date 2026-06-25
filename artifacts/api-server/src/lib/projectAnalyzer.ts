/**
 * VIBA Project Analyzer
 *
 * Inspects project metadata (file lists, package.json, description, known errors)
 * and produces a structured analysis without executing any unknown code.
 *
 * Rules:
 * - Never execute uploaded or cloned code before safety checks
 * - Never return raw secrets or env var values
 * - Zip uploads are flagged for malware scan before any analysis proceeds
 * - All env gap detection uses names only — never raw vault values
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SourceType = "github_repo" | "zip_upload" | "railway_project" | "manual";

export type DetectedFramework =
  | "react_vite"
  | "nextjs"
  | "express"
  | "fastify"
  | "trpc"
  | "node"
  | "python_fastapi"
  | "python_django"
  | "python_flask"
  | "docker"
  | "unknown";

export type PackageManager = "pnpm" | "npm" | "yarn" | "pip" | "cargo" | "unknown";

export interface CredentialStatus {
  name: string;
  provider: string;
  kind: string;
  configured: boolean;
  source: "env" | "vault" | "missing";
}

export interface SecurityFinding {
  id: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  category: string;
  description: string;
  remediation: string;
}

export interface DependencyFinding {
  id: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  packageName: string;
  description: string;
}

export interface BuildFinding {
  id: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  description: string;
  remediation: string;
}

export interface RepairRecommendation {
  id: string;
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  agentName: string;
}

export interface ProjectAnalysis {
  projectName: string;
  sourceType: SourceType;
  detectedFramework: DetectedFramework;
  packageManager: PackageManager;
  languages: string[];
  isMonorepo: boolean;
  frontendPath: string | null;
  backendPath: string | null;
  apiPath: string | null;
  buildCommands: string[];
  testCommands: string[];
  startCommands: string[];
  envRequired: string[];
  envConfigured: string[];
  envMissing: string[];
  credentialStatus: CredentialStatus[];
  routeMap: Array<{ method: string; path: string; description: string }>;
  frontendPages: string[];
  backendRoutes: string[];
  deploymentTarget: string | null;
  railwayReadiness: "ready" | "needs_config" | "not_ready" | "unknown";
  securityFindings: SecurityFinding[];
  uploadSafetyFindings: SecurityFinding[];
  dependencyFindings: DependencyFinding[];
  buildFindings: BuildFinding[];
  repairRecommendations: RepairRecommendation[];
  launchBlockers: string[];
  confidence: "high" | "medium" | "low";
  analysisNote: string;
  rawValuesReturned: false;
}

export interface AnalyzerInput {
  sourceType: SourceType;
  repoUrl?: string;
  fileList?: string[];
  packageJsonContent?: Record<string, unknown>;
  description?: string;
  knownErrors?: string[];
  configuredEnvNames?: string[];
  vaultCredentialNames?: string[];
  strictMode?: boolean;
}

// ─── Framework detection ──────────────────────────────────────────────────────

const FRAMEWORK_PATTERNS: Array<{ deps: string[]; files: string[]; framework: DetectedFramework }> = [
  { deps: ["next"],           files: ["next.config.ts", "next.config.js", "next.config.mjs"], framework: "nextjs" },
  { deps: ["vite", "react"],  files: ["vite.config.ts", "vite.config.js"],                   framework: "react_vite" },
  { deps: ["fastify"],        files: [],                                                       framework: "fastify" },
  { deps: ["express"],        files: ["src/app.ts", "src/app.js", "server.ts", "server.js"],  framework: "express" },
  { deps: ["@trpc/server"],   files: [],                                                       framework: "trpc" },
];

const PYTHON_FILES = ["requirements.txt", "setup.py", "pyproject.toml", "main.py", "app.py", "manage.py"];
const DOCKER_FILES = ["Dockerfile", "docker-compose.yml", "docker-compose.yaml"];

function detectFramework(files: string[], deps: Record<string, string>): DetectedFramework {
  const allDeps = { ...deps };
  const fileSet = new Set(files.map((f) => f.split("/").pop() ?? f));

  for (const { deps: dList, files: fList, framework } of FRAMEWORK_PATTERNS) {
    const hasAnyDep = dList.length === 0 || dList.some((d) => d in allDeps);
    const hasAnyFile = fList.length === 0 || fList.some((f) => fileSet.has(f) || files.some((p) => p.includes(f)));
    if (hasAnyDep && (fList.length === 0 || hasAnyFile)) return framework;
  }

  if (files.some((f) => PYTHON_FILES.some((p) => f.endsWith(p)))) {
    if (files.some((f) => f.includes("fastapi") || f.endsWith("requirements.txt"))) return "python_fastapi";
    if (files.some((f) => f.includes("django") || f.includes("manage.py"))) return "python_django";
    return "python_flask";
  }
  if (files.some((f) => DOCKER_FILES.some((p) => f.endsWith(p)))) return "docker";
  if ("node" in allDeps || files.some((f) => f.endsWith(".ts") || f.endsWith(".js"))) return "node";
  return "unknown";
}

// ─── Package manager detection ────────────────────────────────────────────────

function detectPackageManager(files: string[]): PackageManager {
  const fileSet = new Set(files.map((f) => f.split("/").pop() ?? f));
  if (fileSet.has("pnpm-lock.yaml") || fileSet.has("pnpm-workspace.yaml")) return "pnpm";
  if (fileSet.has("yarn.lock")) return "yarn";
  if (fileSet.has("package-lock.json")) return "npm";
  if (fileSet.has("requirements.txt") || fileSet.has("pyproject.toml")) return "pip";
  if (fileSet.has("Cargo.lock") || fileSet.has("Cargo.toml")) return "cargo";
  if (files.some((f) => f.includes("package.json"))) return "npm";
  return "unknown";
}

// ─── Language detection ───────────────────────────────────────────────────────

function detectLanguages(files: string[], framework: DetectedFramework): string[] {
  const langs = new Set<string>();
  if (files.some((f) => f.endsWith(".ts") || f.endsWith(".tsx"))) langs.add("TypeScript");
  if (files.some((f) => f.endsWith(".js") || f.endsWith(".jsx"))) langs.add("JavaScript");
  if (files.some((f) => f.endsWith(".py"))) langs.add("Python");
  if (files.some((f) => f.endsWith(".rs"))) langs.add("Rust");
  if (files.some((f) => f.endsWith(".go"))) langs.add("Go");
  if (framework.startsWith("python")) langs.add("Python");
  if (langs.size === 0) langs.add("Unknown");
  return [...langs];
}

// ─── Env requirement detection ────────────────────────────────────────────────

const COMMON_ENV_PATTERNS: Array<{ framework: DetectedFramework | "any"; required: string[] }> = [
  { framework: "any",       required: ["NODE_ENV", "PORT"] },
  { framework: "express",   required: ["SESSION_SECRET", "DATABASE_URL"] },
  { framework: "react_vite",required: [] },
  { framework: "nextjs",    required: ["NEXTAUTH_SECRET", "NEXTAUTH_URL"] },
];

const ENV_PATTERNS_IN_ERRORS = [
  /([A-Z][A-Z0-9_]{3,})(?:\s+is\s+(?:not|undefined|missing)|_KEY|_SECRET|_URL|_TOKEN)/g,
];

function detectRequiredEnv(framework: DetectedFramework, knownErrors: string[], description: string): string[] {
  const envNames = new Set<string>(["NODE_ENV"]);

  // Framework defaults
  for (const { framework: f, required } of COMMON_ENV_PATTERNS) {
    if (f === "any" || f === framework) required.forEach((e) => envNames.add(e));
  }

  // Extract from errors
  const combined = [...knownErrors, description].join("\n");
  for (const pattern of ENV_PATTERNS_IN_ERRORS) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(combined)) !== null) {
      if (m[1] && m[1].length > 3) envNames.add(m[1]);
    }
  }

  // Common known patterns
  if (combined.toLowerCase().includes("database") || combined.toLowerCase().includes("postgres")) envNames.add("DATABASE_URL");
  if (combined.toLowerCase().includes("stripe")) { envNames.add("STRIPE_SECRET_KEY"); envNames.add("STRIPE_PUBLISHABLE_KEY"); }
  if (combined.toLowerCase().includes("session")) envNames.add("SESSION_SECRET");
  if (combined.toLowerCase().includes("railway")) envNames.add("RAILWAY_TOKEN");
  if (combined.toLowerCase().includes("openai") || combined.toLowerCase().includes("gpt")) envNames.add("OPENAI_API_KEY");
  if (combined.toLowerCase().includes("anthropic") || combined.toLowerCase().includes("claude")) envNames.add("ANTHROPIC_API_KEY");
  if (combined.toLowerCase().includes("smtp") || combined.toLowerCase().includes("email")) { envNames.add("SMTP_HOST"); envNames.add("SMTP_USER"); envNames.add("SMTP_PASS"); }

  return [...envNames];
}

// ─── Security findings ────────────────────────────────────────────────────────

function buildSecurityFindings(
  sourceType: SourceType,
  files: string[],
  deps: Record<string, string>,
  framework: DetectedFramework,
  strictMode: boolean,
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // Secret scan — always recommended
  findings.push({
    id: "sec-secret-scan",
    severity: "high",
    category: "secret_scan",
    description: "Source code should be scanned for accidentally committed secrets (API keys, tokens, passwords).",
    remediation: "Run: npx secretlint '**/*' or git-secrets before committing.",
  });

  // Dependency audit
  if (["pnpm", "npm", "yarn"].some((pm) => files.some((f) => f.includes("package.json")))) {
    findings.push({
      id: "sec-dep-audit",
      severity: "medium",
      category: "dependency_audit",
      description: "Run dependency audit to detect known vulnerabilities.",
      remediation: "Run: pnpm audit / npm audit / yarn audit",
    });
  }

  // Docker: check for non-root user
  if (files.some((f) => f.includes("Dockerfile"))) {
    findings.push({
      id: "sec-docker-root",
      severity: "medium",
      category: "docker",
      description: "Verify Docker container does not run as root.",
      remediation: "Add USER node or USER nonroot to Dockerfile.",
    });
  }

  // No .env in git
  if (files.some((f) => f === ".env" || f.endsWith("/.env"))) {
    findings.push({
      id: "sec-env-in-repo",
      severity: "critical",
      category: "secrets",
      description: ".env file detected in repository file list — may contain committed secrets.",
      remediation: "Add .env to .gitignore immediately. Rotate any committed secrets.",
    });
  }

  // Express: check for known security headers
  if (framework === "express") {
    findings.push({
      id: "sec-express-helmet",
      severity: "medium",
      category: "server",
      description: "Verify Helmet.js (security headers) is configured for the Express app.",
      remediation: "Install helmet and add app.use(helmet()) before routes.",
    });
  }

  return findings;
}

function buildUploadSafetyFindings(sourceType: SourceType, strictMode: boolean): SecurityFinding[] {
  if (sourceType !== "zip_upload") return [];
  return [
    {
      id: "upload-quarantine",
      severity: "critical",
      category: "upload_safety",
      description: "Zip upload must be quarantined before extraction.",
      remediation: "Extract only to sandbox path. Do not execute any scripts from the zip.",
    },
    {
      id: "upload-zip-bomb",
      severity: "high",
      category: "upload_safety",
      description: "Check for zip bomb risk (compressed ratio > 100:1 or expanded size > 500MB).",
      remediation: "Limit extraction size and check compression ratio before full extraction.",
    },
    {
      id: "upload-malware-scan",
      severity: strictMode ? "critical" : "high",
      category: "upload_safety",
      description: "Malware scan required before processing zip upload. Scanner availability must be verified.",
      remediation: "Run ClamAV or equivalent. If unavailable, mark as manual_required and block execution.",
    },
    {
      id: "upload-mime-validation",
      severity: "high",
      category: "upload_safety",
      description: "Validate MIME type and file extension before extraction.",
      remediation: "Reject uploads whose MIME type does not match .zip extension.",
    },
  ];
}

// ─── Repair recommendations ───────────────────────────────────────────────────

function buildRepairRecommendations(
  launchBlockers: string[],
  missingEnv: string[],
  securityFindings: SecurityFinding[],
  buildFindings: BuildFinding[],
  knownErrors: string[],
): RepairRecommendation[] {
  const recs: RepairRecommendation[] = [];

  if (missingEnv.length > 0) {
    recs.push({
      id: "repair-missing-env",
      priority: "critical",
      title: "Configure missing environment variables",
      description: `${missingEnv.length} required env var(s) not found: ${missingEnv.slice(0, 5).join(", ")}${missingEnv.length > 5 ? "…" : ""}`,
      agentName: "vault",
    });
  }

  const criticalSec = securityFindings.filter((f) => f.severity === "critical");
  if (criticalSec.length > 0) {
    recs.push({
      id: "repair-security",
      priority: "critical",
      title: "Resolve critical security findings",
      description: `${criticalSec.length} critical security finding(s) must be resolved before deployment.`,
      agentName: "security",
    });
  }

  if (knownErrors.some((e) => /install|dependency|module not found|cannot find/i.test(e))) {
    recs.push({
      id: "repair-dependencies",
      priority: "high",
      title: "Repair dependency installation",
      description: "Dependency install errors detected. Run package install and audit.",
      agentName: "builder",
    });
  }

  if (knownErrors.some((e) => /build|compile|tsc|typecheck|webpack|vite/i.test(e))) {
    recs.push({
      id: "repair-build",
      priority: "high",
      title: "Fix build errors",
      description: "Build/compile errors detected. Run typecheck and build to identify issues.",
      agentName: "builder",
    });
  }

  if (launchBlockers.length > 0) {
    recs.push({
      id: "repair-blockers",
      priority: "critical",
      title: "Resolve launch blockers",
      description: `${launchBlockers.length} launch blocker(s) must be resolved before deployment.`,
      agentName: "coordinator",
    });
  }

  return recs;
}

// ─── Main analyzer function ───────────────────────────────────────────────────

export function analyzeProject(input: AnalyzerInput): ProjectAnalysis {
  const {
    sourceType,
    repoUrl,
    fileList = [],
    packageJsonContent = {},
    description = "",
    knownErrors = [],
    configuredEnvNames = [],
    vaultCredentialNames = [],
    strictMode = false,
  } = input;

  // Never execute unknown code — analysis is purely metadata-based
  const allDeps: Record<string, string> = {
    ...(packageJsonContent["dependencies"] as Record<string, string> | undefined ?? {}),
    ...(packageJsonContent["devDependencies"] as Record<string, string> | undefined ?? {}),
  };

  const scripts = packageJsonContent["scripts"] as Record<string, string> | undefined ?? {};
  const pkgName = String(packageJsonContent["name"] ?? "unknown-project");

  // Derive project name
  let projectName = pkgName;
  if (sourceType === "github_repo" && repoUrl) {
    const parts = repoUrl.replace(/\.git$/, "").split("/");
    projectName = parts[parts.length - 1] ?? pkgName;
  }

  // Framework + package manager detection
  const detectedFramework = detectFramework(fileList, allDeps);
  const packageManager = detectPackageManager(fileList);
  const languages = detectLanguages(fileList, detectedFramework);
  const isMonorepo = fileList.some((f) => f.includes("pnpm-workspace.yaml") || f.includes("lerna.json") || f.includes("turbo.json"));

  // Path detection
  const frontendPath = fileList.find((f) => f.includes("src/App.tsx") || f.includes("src/app/page.tsx") || f.includes("src/main.tsx"))
    ? fileList.find((f) => f.match(/^(apps\/web|frontend|client|packages\/ui)/)) ?? "."
    : null;
  const backendPath = fileList.find((f) => f.includes("src/app.ts") || f.includes("server.ts") || f.includes("src/index.ts"))
    ? fileList.find((f) => f.match(/^(apps\/api|backend|server|packages\/api)/)) ?? "."
    : null;
  const apiPath = fileList.find((f) => f.match(/src\/routes\/index\.ts|src\/app\.ts/)) ? "src/routes" : null;

  // Commands
  const buildCommands: string[] = [];
  const testCommands: string[] = [];
  const startCommands: string[] = [];

  if (scripts["build"]) buildCommands.push(`${packageManager} run build`);
  if (scripts["test"] || scripts["test:unit"]) testCommands.push(`${packageManager} run test`);
  if (scripts["dev"]) startCommands.push(`${packageManager} run dev`);
  if (scripts["start"]) startCommands.push(`${packageManager} run start`);

  // Fallback
  if (buildCommands.length === 0 && detectedFramework !== "unknown") buildCommands.push("pnpm run build");
  if (testCommands.length === 0) testCommands.push("pnpm run test");

  // Env gap detection (name-only, no raw values)
  const envRequired = detectRequiredEnv(detectedFramework, knownErrors, description);
  const allConfigured = new Set([...configuredEnvNames, ...vaultCredentialNames]);
  const envConfigured = envRequired.filter((e) => allConfigured.has(e));
  const envMissing = envRequired.filter((e) => !allConfigured.has(e));

  const credentialStatus: CredentialStatus[] = envRequired.map((name) => {
    const inEnv = configuredEnvNames.includes(name);
    const inVault = vaultCredentialNames.includes(name);
    return {
      name,
      provider: name.split("_")[0]?.toLowerCase() ?? "unknown",
      kind: "api_key",
      configured: inEnv || inVault,
      source: inEnv ? "env" : inVault ? "vault" : "missing",
    };
  });

  // Security findings
  const securityFindings = buildSecurityFindings(sourceType, fileList, allDeps, detectedFramework, strictMode);
  const uploadSafetyFindings = buildUploadSafetyFindings(sourceType, strictMode);

  // Build findings
  const buildFindings: BuildFinding[] = [];
  if (!scripts["build"] && detectedFramework !== "unknown" && detectedFramework !== "manual" as DetectedFramework) {
    buildFindings.push({ id: "bf-no-build-script", severity: "high", description: "No build script found in package.json.", remediation: "Add a build script to package.json." });
  }
  if (!scripts["test"]) {
    buildFindings.push({ id: "bf-no-test-script", severity: "medium", description: "No test script found in package.json.", remediation: "Add a test script to package.json." });
  }

  // Dependency findings
  const dependencyFindings: DependencyFinding[] = [];
  if (!fileList.some((f) => f.includes("pnpm-lock.yaml") || f.includes("package-lock.json") || f.includes("yarn.lock"))) {
    if (fileList.some((f) => f.includes("package.json"))) {
      dependencyFindings.push({ id: "dep-no-lockfile", severity: "medium", packageName: "all", description: "No lockfile detected. Dependency versions may be unpinned.", });
    }
  }

  // Launch blockers
  const launchBlockers: string[] = [];

  if (sourceType === "zip_upload") {
    launchBlockers.push("Zip upload requires malware safety scan before any code execution.");
    if (strictMode) launchBlockers.push("Strict mode: malware scan result must be documented before owner review.");
  }

  if (envMissing.length > 0) {
    launchBlockers.push(`${envMissing.length} required environment variable(s) not configured: ${envMissing.slice(0, 3).join(", ")}${envMissing.length > 3 ? "…" : ""}`);
  }

  const criticalSec = [...securityFindings, ...uploadSafetyFindings].filter((f) => f.severity === "critical");
  if (criticalSec.length > 0) {
    launchBlockers.push(`${criticalSec.length} critical security finding(s) must be resolved.`);
  }

  if (knownErrors.length > 0 && knownErrors.some((e) => /cannot find module|module not found|ERR_MODULE_NOT_FOUND/i.test(e))) {
    launchBlockers.push("Module-not-found errors indicate broken dependencies — must be resolved before running.");
  }

  // Route map (from file structure heuristics)
  const routeMap: Array<{ method: string; path: string; description: string }> = [];
  for (const f of fileList) {
    if (f.match(/routes\/(\w+)\.ts$/) && !f.includes("test")) {
      const name = f.match(/routes\/(\w+)\.ts$/)?.[1] ?? "";
      routeMap.push({ method: "ANY", path: `/api/${name}`, description: `Router: ${name}` });
    }
  }

  // Frontend pages
  const frontendPages = fileList
    .filter((f) => f.match(/pages\/[\w-]+\.tsx$/) && !f.includes("test"))
    .map((f) => `/${f.match(/pages\/([\w-]+)\.tsx$/)?.[1] ?? ""}`.replace("-", "-"));

  // Deployment target
  let deploymentTarget: string | null = null;
  let railwayReadiness: "ready" | "needs_config" | "not_ready" | "unknown" = "unknown";
  if (fileList.some((f) => f.includes("railway.json") || f.includes("nixpacks.toml"))) {
    deploymentTarget = "Railway";
    railwayReadiness = envMissing.length === 0 ? "ready" : "needs_config";
  } else if (fileList.some((f) => f.includes("vercel.json"))) {
    deploymentTarget = "Vercel";
  } else if (fileList.some((f) => f.includes("Dockerfile"))) {
    deploymentTarget = "Docker";
  }
  if (sourceType === "railway_project") {
    deploymentTarget = "Railway";
    railwayReadiness = envMissing.length === 0 ? "ready" : "needs_config";
  }

  // Repair recommendations
  const repairRecommendations = buildRepairRecommendations(
    launchBlockers,
    envMissing,
    securityFindings,
    buildFindings,
    knownErrors,
  );

  // Confidence
  const confidence: "high" | "medium" | "low" =
    sourceType === "manual" ? "low"
    : fileList.length > 10 && packageJsonContent["name"] ? "high"
    : fileList.length > 0 ? "medium"
    : "low";

  const analysisNote =
    sourceType === "zip_upload"
      ? "Zip upload: analysis is based on file structure only. Code was NOT executed. Malware safety scan required before any execution."
      : sourceType === "manual"
      ? "Manual import: analysis based on user-provided description and known errors only. Confidence is low."
      : "Analysis based on file metadata and package.json inspection. No code was executed.";

  return {
    projectName,
    sourceType,
    detectedFramework,
    packageManager,
    languages,
    isMonorepo,
    frontendPath,
    backendPath,
    apiPath,
    buildCommands,
    testCommands,
    startCommands,
    envRequired,
    envConfigured,
    envMissing,
    credentialStatus,
    routeMap,
    frontendPages,
    backendRoutes: routeMap.map((r) => r.path),
    deploymentTarget,
    railwayReadiness,
    securityFindings,
    uploadSafetyFindings,
    dependencyFindings,
    buildFindings,
    repairRecommendations,
    launchBlockers,
    confidence,
    analysisNote,
    rawValuesReturned: false,
  };
}
