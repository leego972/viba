import type { FailureDiagnosis } from "./deploy.types";

interface DiagnosisRule {
  pattern: RegExp;
  category: string;
  severity: FailureDiagnosis["severity"];
  likelyCause: string;
  recommendedFix: string;
  oneClickFix?: FailureDiagnosis["oneClickFix"];
}

const RULES: DiagnosisRule[] = [
  {
    pattern: /error:?\s*(port|address)\s+(in use|already|conflict)/i,
    category: "wrong_port_binding",
    severity: "high",
    likelyCause: "The application is trying to bind to a port that is already in use or not the configured PORT.",
    recommendedFix: "Ensure your app reads the PORT environment variable: `const port = process.env.PORT || 3000`",
    oneClickFix: { action: "set_port_env", label: "Set PORT env var", safe: true },
  },
  {
    pattern: /ENOENT.*package\.json|Cannot find module/i,
    category: "missing_start_command",
    severity: "high",
    likelyCause: "The start command references a file that does not exist.",
    recommendedFix: "Check your start command in VIBA Deploy settings matches your build output.",
    oneClickFix: { action: "suggest_start_command", label: "Auto-detect start command", safe: true },
  },
  {
    pattern: /npm ERR!|yarn error|pnpm ERR!/i,
    category: "package_install_failure",
    severity: "high",
    likelyCause: "Package installation failed — possibly due to network issues, version conflicts, or missing native dependencies.",
    recommendedFix: "Check your package.json for version conflicts. Try clearing the node_modules cache.",
    oneClickFix: { action: "switch_package_manager", label: "Auto-detect package manager from lockfile", safe: true },
  },
  {
    pattern: /error TS\d+:|TypeScript.*error|tsc.*failed/i,
    category: "typescript_build_failure",
    severity: "high",
    likelyCause: "TypeScript compilation failed.",
    recommendedFix: "Review TypeScript errors in the build log and fix type errors in your code.",
  },
  {
    pattern: /DATABASE_URL.*not|cannot connect.*database|ECONNREFUSED.*:5432|password authentication failed/i,
    category: "database_connection_failure",
    severity: "critical",
    likelyCause: "The application cannot connect to the database. DATABASE_URL may be missing or incorrect.",
    recommendedFix: "Add a managed Postgres add-on or verify your DATABASE_URL environment variable.",
    oneClickFix: { action: "create_postgres_addon", label: "Create Postgres add-on", safe: true },
  },
  {
    pattern: /REDIS_URL.*not|ECONNREFUSED.*:6379|redis.*connection/i,
    category: "redis_connection_failure",
    severity: "high",
    likelyCause: "The application cannot connect to Redis. REDIS_URL may be missing.",
    recommendedFix: "Add a managed Redis add-on or verify your REDIS_URL environment variable.",
    oneClickFix: { action: "create_redis_addon", label: "Create Redis add-on", safe: true },
  },
  {
    pattern: /health.?check.*fail|container.*unhealthy|timeout.*health/i,
    category: "health_check_timeout",
    severity: "high",
    likelyCause: "The container started but did not respond to health check requests within the timeout.",
    recommendedFix: "Ensure your app has a health endpoint at / or /health and starts within 60 seconds.",
  },
  {
    pattern: /dockerfile.*error|COPY.*not found|RUN.*exit 1/i,
    category: "dockerfile_failure",
    severity: "high",
    likelyCause: "The generated or provided Dockerfile has an error.",
    recommendedFix: "Review the Dockerfile in your project root and ensure all COPY sources exist.",
  },
  {
    pattern: /out of memory|OOMKilled|Killed.*process/i,
    category: "out_of_memory",
    severity: "critical",
    likelyCause: "The container was killed due to exceeding the memory limit.",
    recommendedFix: "Increase the memory limit in your VIBA Deploy project settings.",
  },
  {
    pattern: /framework.*not.*support|unsupported.*framework/i,
    category: "unsupported_framework",
    severity: "medium",
    likelyCause: "VIBA Deploy could not detect or build your framework.",
    recommendedFix: "Add a Dockerfile to your project root and set explicit build/start commands.",
  },
  {
    pattern: /Missing.*env|env.*not.*set|required.*environment/i,
    category: "missing_env_variable",
    severity: "high",
    likelyCause: "A required environment variable is not set.",
    recommendedFix: "Add the missing environment variable in your VIBA Deploy project settings.",
  },
];

export function diagnoseFailure(logs: string[]): FailureDiagnosis | null {
  const fullLog = logs.join("\n");

  for (const rule of RULES) {
    const match = rule.pattern.exec(fullLog);
    if (!match) continue;

    const matchStart = Math.max(0, match.index - 100);
    const matchEnd = Math.min(fullLog.length, match.index + match[0].length + 200);
    const excerpt = fullLog.slice(matchStart, matchEnd).trim();

    return {
      category: rule.category,
      severity: rule.severity,
      likelyCause: rule.likelyCause,
      logExcerpt: excerpt,
      recommendedFix: rule.recommendedFix,
      oneClickFix: rule.oneClickFix,
    };
  }

  return null;
}

export function classifyLogLevel(line: string): "error" | "warn" | "info" {
  if (/error|fail|fatal/i.test(line)) return "error";
  if (/warn|warning/i.test(line)) return "warn";
  return "info";
}
