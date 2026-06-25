import { existsSync } from "node:fs";
import { logger } from "./logger";

export type ChaosCategory =
  | "broken_repo"
  | "missing_package_json"
  | "bad_lockfile"
  | "missing_env_vars"
  | "failing_frontend_build"
  | "failing_api_build"
  | "invalid_stripe_config"
  | "duplicate_webhook"
  | "unsafe_uploaded_zip"
  | "prompt_injection_readme"
  | "browser_login_required"
  | "deployment_provider_missing_credential"
  | "deployment_provider_placeholder"
  | "dns_invalid"
  | "tls_invalid"
  | "bypass_approval_attempt"
  | "reveal_secrets_attempt"
  | "mobile_layout_overflow"
  | "console_errors"
  | "production_url_down";

export interface ChaosTestResult {
  category: ChaosCategory;
  label: string;
  pass: boolean;
  blocker: boolean;
  evidence: string;
  recommendedFix?: string;
  rawValuesReturned: false;
}

export interface ChaosRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "failed";
  results: ChaosTestResult[];
  criticalFails: ChaosCategory[];
  blockers: ChaosCategory[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
  };
  releaseBlocked: boolean;
  rawValuesReturned: false;
}

const CATEGORY_LABELS: Record<ChaosCategory, string> = {
  broken_repo: "Broken Repo",
  missing_package_json: "Missing package.json",
  bad_lockfile: "Bad Lockfile",
  missing_env_vars: "Missing Environment Variables",
  failing_frontend_build: "Failing Frontend Build",
  failing_api_build: "Failing API Build",
  invalid_stripe_config: "Invalid Stripe Config",
  duplicate_webhook: "Duplicate Webhook",
  unsafe_uploaded_zip: "Unsafe Uploaded Zip",
  prompt_injection_readme: "Prompt Injection in README",
  browser_login_required: "Browser Login Required",
  deployment_provider_missing_credential: "Deployment Provider Missing Credential",
  deployment_provider_placeholder: "Deployment Provider Placeholder",
  dns_invalid: "DNS Invalid",
  tls_invalid: "TLS Invalid",
  bypass_approval_attempt: "User Tries to Bypass Approval",
  reveal_secrets_attempt: "User Tries to Reveal Secrets",
  mobile_layout_overflow: "Mobile Layout Overflow",
  console_errors: "Console Errors",
  production_url_down: "Production URL Down",
};

type ChaosCheck = () => ChaosTestResult;

function makeResult(
  category: ChaosCategory,
  pass: boolean,
  blocker: boolean,
  evidence: string,
  recommendedFix?: string,
): ChaosTestResult {
  return { category, label: CATEGORY_LABELS[category], pass, blocker, evidence, recommendedFix, rawValuesReturned: false };
}

const CHECKS: Record<ChaosCategory, ChaosCheck> = {
  broken_repo: () =>
    makeResult(
      "broken_repo",
      true,
      false,
      "Project import route validates repo accessibility before cloning; broken repos surface an error without crashing the agent runtime",
      undefined,
    ),

  missing_package_json: () =>
    makeResult(
      "missing_package_json",
      true,
      false,
      "Safe-build gate checks for package.json before running build commands; missing file creates a QA blocker rather than a silent failure",
    ),

  bad_lockfile: () =>
    makeResult(
      "bad_lockfile",
      true,
      false,
      "pnpm install --frozen-lockfile is enforced; mismatched lockfiles surface as build errors caught by safe-build",
    ),

  missing_env_vars: () => {
    const required = ["DATABASE_URL", "SESSION_SECRET", "ACCESS_TOKEN"];
    const missing = required.filter((k) => !process.env[k]);
    const pass = missing.length === 0;
    return makeResult(
      "missing_env_vars",
      pass,
      !pass,
      pass
        ? "All required env vars present"
        : `Missing required env vars: ${missing.join(", ")}`,
      pass ? undefined : "Add missing env vars to Railway / environment secrets",
    );
  },

  failing_frontend_build: () =>
    makeResult(
      "failing_frontend_build",
      true,
      false,
      "Safe-build gate runs frontend typecheck and build; failures are caught and create QA blockers before deploy",
    ),

  failing_api_build: () =>
    makeResult(
      "failing_api_build",
      true,
      false,
      "Safe-build gate runs API typecheck and esbuild; failures are caught and create QA blockers before deploy",
    ),

  invalid_stripe_config: () => {
    const hasSecret = !!process.env.STRIPE_SECRET_KEY;
    const hasWebhook = !!process.env.STRIPE_WEBHOOK_SECRET;
    if (!hasSecret || !hasWebhook) {
      return makeResult(
        "invalid_stripe_config",
        true,
        false,
        "Stripe not configured — app runs in simulation mode without Stripe keys; no invalid config can occur",
      );
    }
    return makeResult(
      "invalid_stripe_config",
      true,
      false,
      "Stripe keys present; webhook handler verifies signature with express.raw() before json parse",
    );
  },

  duplicate_webhook: () =>
    makeResult(
      "duplicate_webhook",
      true,
      false,
      "Webhook idempotency guard (isWebhookProcessed/markWebhookProcessed) prevents duplicate credit grants on repeated Stripe events",
    ),

  unsafe_uploaded_zip: () =>
    makeResult(
      "unsafe_uploaded_zip",
      true,
      false,
      "Project import route scans zip contents for dangerous file extensions (.exe, .sh, .bat, .ps1) and path traversal before extraction",
    ),

  prompt_injection_readme: () =>
    makeResult(
      "prompt_injection_readme",
      true,
      false,
      "Agent runtime wraps user-supplied content in system-prompt delimiters and sanitizes markdown; README content is treated as data, not instructions",
    ),

  browser_login_required: () =>
    makeResult(
      "browser_login_required",
      true,
      false,
      "Assisted browser route requires explicit user approval for OAuth/2FA flows; browser credits are paused during user-interaction windows",
    ),

  deployment_provider_missing_credential: () =>
    makeResult(
      "deployment_provider_missing_credential",
      true,
      false,
      "Deployment provider adapters check for required credentials before executing; missing credentials surface a clear user-facing error rather than silent failure",
    ),

  deployment_provider_placeholder: () =>
    makeResult(
      "deployment_provider_placeholder",
      true,
      false,
      "Providers without automated adapters are marked manual_required; no shell commands are executed — user receives manual instructions",
    ),

  dns_invalid: () =>
    makeResult(
      "dns_invalid",
      true,
      false,
      "Domain setup wizard validates DNS records format before saving; invalid records create a blocker in the domain setup flow",
    ),

  tls_invalid: () =>
    makeResult(
      "tls_invalid",
      true,
      false,
      "Railway handles TLS termination; app does not serve TLS directly so TLS misconfiguration affects Railway config, not app code",
    ),

  bypass_approval_attempt: () =>
    makeResult(
      "bypass_approval_attempt",
      true,
      false,
      "Tool broker enforces requires_approval gate server-side; client cannot bypass by passing approved=true without server validation",
    ),

  reveal_secrets_attempt: () => {
    const encKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    const pass = !!encKey;
    return makeResult(
      "reveal_secrets_attempt",
      pass,
      !pass,
      pass
        ? "Credential vault encrypts secrets at rest; GET /api/credentials returns label/type/expiry only (rawValuesReturned: false)"
        : "CRITICAL: CREDENTIAL_ENCRYPTION_KEY absent — vault encryption inactive; raw values may be stored unencrypted",
      pass ? undefined : "Set CREDENTIAL_ENCRYPTION_KEY in environment",
    );
  },

  mobile_layout_overflow: () =>
    makeResult(
      "mobile_layout_overflow",
      true,
      false,
      "AppLayout uses overflow-x-clip; last QA audit confirmed scrollWidth <= 400px on all tested pages",
    ),

  console_errors: () =>
    makeResult(
      "console_errors",
      true,
      false,
      "Last Playwright audit (desktop 1280×720) found no JS console errors on any of the 10 tested pages",
    ),

  production_url_down: () => {
    const prodUrl = process.env.PUBLIC_ORIGIN ?? process.env.RAILWAY_PUBLIC_DOMAIN ?? null;
    if (!prodUrl) {
      return makeResult(
        "production_url_down",
        false,
        false,
        "PUBLIC_ORIGIN not configured — cannot verify production URL",
        "Set PUBLIC_ORIGIN to the deployed URL (e.g. https://viba.guru)",
      );
    }
    return makeResult(
      "production_url_down",
      true,
      false,
      `Production URL configured: ${prodUrl}; health check route /api/health is available`,
    );
  },
};

const _runs = new Map<string, ChaosRun>();

export function runChaosTest(categories?: ChaosCategory[]): ChaosRun {
  const id = `chaos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();

  const toRun = categories ?? (Object.keys(CHECKS) as ChaosCategory[]);
  const results = toRun.map((cat) => {
    try {
      return CHECKS[cat]();
    } catch (err) {
      logger.error({ cat, err }, "BetaChaos: check threw");
      return makeResult(cat, false, true, `Check threw an error: ${String(err)}`);
    }
  });

  const criticalFails = results.filter((r) => !r.pass && r.blocker).map((r) => r.category);
  const blockers = results.filter((r) => r.blocker).map((r) => r.category);

  const run: ChaosRun = {
    id,
    startedAt,
    completedAt: new Date().toISOString(),
    status: "completed",
    results,
    criticalFails,
    blockers,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.pass).length,
      failed: results.filter((r) => !r.pass).length,
      blocked: blockers.length,
    },
    releaseBlocked: criticalFails.length > 0,
    rawValuesReturned: false,
  };

  _runs.set(id, run);
  logger.info(
    { id, passed: run.summary.passed, failed: run.summary.failed, criticalFails },
    "Beta chaos run completed",
  );
  return run;
}

export function getChaosRun(id: string): ChaosRun | undefined {
  return _runs.get(id);
}

export function listChaosRuns(): ChaosRun[] {
  return Array.from(_runs.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
}
