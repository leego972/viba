import { Router, type IRouter } from "express";

const router: IRouter = Router();

type AppProfile = {
  appName?: string;
  hasServer?: boolean;
  usesLogin?: boolean;
  usesOAuth?: boolean;
  usesCredits?: boolean;
  usesPayments?: boolean;
  paymentProvider?: "stripe" | "paypal" | "square" | "other" | "none";
  hasPublicDomain?: boolean;
  domain?: string;
  usesBrowserAutomation?: boolean;
  strictMode?: boolean;
};

type SecurityControl = {
  id: string;
  category: string;
  title: string;
  required: boolean;
  reason: string;
  implementation: string;
  evidence: string[];
};

const BASE_CONTROLS: SecurityControl[] = [
  {
    id: "server-security-headers",
    category: "server",
    title: "HTTP security headers",
    required: true,
    reason: "Public servers need baseline browser and transport protections.",
    implementation: "Enable Helmet or equivalent headers: HSTS, no-sniff, frame protection, referrer policy, and controlled CSP.",
    evidence: ["helmet enabled", "HSTS present on HTTPS", "CSP policy documented"],
  },
  {
    id: "server-rate-limits",
    category: "server",
    title: "Rate limits and body limits",
    required: true,
    reason: "Auth, payment, setup, and browser-control endpoints must resist abuse and oversized payloads.",
    implementation: "Apply rate limits per route class and enforce JSON/body upload size limits.",
    evidence: ["auth limiter", "api limiter", "body limit configured"],
  },
  {
    id: "server-cors-allowlist",
    category: "server",
    title: "CORS allowlist",
    required: true,
    reason: "Credentialed browser apps must not accept arbitrary origins.",
    implementation: "Restrict CORS to PUBLIC_ORIGIN and approved admin/dev origins only.",
    evidence: ["CORS_ALLOWED_ORIGINS present", "wildcard disabled in production"],
  },
  {
    id: "server-error-redaction",
    category: "server",
    title: "Error and log redaction",
    required: true,
    reason: "Server logs must never leak credentials, tokens, session cookies, or payment secrets.",
    implementation: "Redact token, secret, password, cookie, code, key, and credential fields in logs and API responses.",
    evidence: ["redaction helper", "test covers secret body not echoed", "logger does not print env values"],
  },
  {
    id: "auth-session-security",
    category: "auth",
    title: "Secure login sessions",
    required: true,
    reason: "Accounts need secure cookies, session expiry, and server-side validation.",
    implementation: "Use httpOnly, secure, sameSite cookies, session expiry, server-side auth checks, and route guards.",
    evidence: ["httpOnly cookies", "secure cookies in production", "protected routes verified"],
  },
  {
    id: "oauth-secure-flow",
    category: "auth",
    title: "OAuth provider security",
    required: false,
    reason: "OAuth apps need state validation and redirect allowlists.",
    implementation: "Use state/nonce, exact redirect URI allowlist, short-lived authorization, and audit logs for linked providers.",
    evidence: ["state checked", "redirect URI exact match", "provider connection audit"],
  },
  {
    id: "payment-webhook-signature",
    category: "payments",
    title: "Payment webhook signature verification",
    required: false,
    reason: "Payment events must be verified before changing subscription or credits.",
    implementation: "Use raw request body for webhook verification and reject unsigned/invalid events.",
    evidence: ["raw webhook route", "webhook secret configured", "invalid signature test"],
  },
  {
    id: "credits-ledger-integrity",
    category: "credits",
    title: "Credit ledger integrity",
    required: false,
    reason: "Credit systems need append-only accounting and idempotent payment handling.",
    implementation: "Use transaction records, idempotency keys, non-negative balances, and separate debit/credit audit events.",
    evidence: ["credit ledger table", "idempotent webhook handling", "negative balance blocked"],
  },
  {
    id: "secrets-vault",
    category: "secrets",
    title: "Encrypted credential vault",
    required: true,
    reason: "Provider tokens and setup credentials must not be stored as plain text.",
    implementation: "Encrypt stored provider credentials at rest, redact values in responses, support rotation and deletion.",
    evidence: ["encryption key configured", "raw value never returned", "delete/rotate supported"],
  },
  {
    id: "domain-tls-dns",
    category: "deployment",
    title: "Domain, TLS, and DNS verification",
    required: true,
    reason: "A production app must verify HTTPS, canonical origin, DNS records, and secure redirects.",
    implementation: "Verify PUBLIC_ORIGIN, HTTPS availability, canonical www/root handling, and HSTS readiness.",
    evidence: ["PUBLIC_ORIGIN set", "HTTPS 200", "DNS target documented", "root/www behavior verified"],
  },
  {
    id: "build-hardening",
    category: "build",
    title: "Build hardening pipeline",
    required: true,
    reason: "Builds must fail before deployment when security-critical checks fail.",
    implementation: "Run typecheck, tests, build, browser check when used, dependency audit, secret scan, and env readiness checks.",
    evidence: ["typecheck pass", "tests pass", "build pass", "secret scan clean", "required env report"],
  },
];

function profileBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function buildControls(profile: AppProfile): SecurityControl[] {
  const controls = [...BASE_CONTROLS];
  const usesOAuth = profileBool(profile.usesOAuth, false);
  const usesPayments = profileBool(profile.usesPayments, false) || profile.paymentProvider === "stripe";
  const usesCredits = profileBool(profile.usesCredits, false);
  const hasServer = profileBool(profile.hasServer, true);
  const usesBrowserAutomation = profileBool(profile.usesBrowserAutomation, false);

  return controls.map((control) => {
    if (control.id === "oauth-secure-flow") return { ...control, required: usesOAuth };
    if (control.id === "payment-webhook-signature") return { ...control, required: usesPayments };
    if (control.id === "credits-ledger-integrity") return { ...control, required: usesCredits };
    if (control.category === "server") return { ...control, required: hasServer };
    if (control.id === "build-hardening" && usesBrowserAutomation) {
      return {
        ...control,
        implementation: `${control.implementation} Include Chromium install/check and browser worker smoke test.`,
        evidence: [...control.evidence, "browser:install pass", "browser:check pass"],
      };
    }
    return control;
  });
}

function buildEnvRequirements(profile: AppProfile): string[] {
  const env = new Set<string>([
    "DATABASE_URL",
    "SESSION_SECRET",
    "PUBLIC_ORIGIN",
    "ACCESS_TOKEN",
    "CREDENTIAL_ENCRYPTION_KEY",
    "CORS_ALLOWED_ORIGINS",
  ]);
  if (profile.usesPayments || profile.paymentProvider === "stripe") {
    env.add("STRIPE_SECRET_KEY");
    env.add("STRIPE_PUBLISHABLE_KEY");
    env.add("STRIPE_WEBHOOK_SECRET");
    env.add("STRIPE_PRICE_ID");
  }
  if (profile.usesCredits) {
    env.add("CREDIT_LEDGER_ENABLED");
    env.add("CREDIT_WEBHOOK_IDEMPOTENCY_REQUIRED");
  }
  if (profile.usesOAuth) {
    env.add("OAUTH_REDIRECT_ORIGIN");
    env.add("OAUTH_STATE_SECRET");
  }
  return Array.from(env).sort();
}

function buildHardeningCommands(profile: AppProfile): string[] {
  const commands = [
    "pnpm install --no-frozen-lockfile",
    "pnpm run typecheck",
    "pnpm --filter @workspace/api-server run test",
    "pnpm --filter @workspace/api-server run build",
    "pnpm --filter @workspace/bridge-ai run build",
  ];
  if (profile.usesBrowserAutomation) {
    commands.splice(2, 0, "pnpm --filter @workspace/api-server run browser:install", "pnpm --filter @workspace/api-server run browser:check");
  }
  commands.push("git grep -nE '(sk_live_|rk_live_|whsec_|RAILWAY_TOKEN=|SMTP_PASS=|DATABASE_URL=)' -- . ':!pnpm-lock.yaml' || true");
  return commands;
}

function blockersFor(profile: AppProfile, controls: SecurityControl[]): string[] {
  const blockers: string[] = [];
  if (profile.hasServer !== false && !profile.domain && profile.hasPublicDomain) blockers.push("PUBLIC_DOMAIN_MISSING");
  if (profile.usesPayments && profile.paymentProvider === "none") blockers.push("PAYMENT_PROVIDER_REQUIRED");
  if (profile.usesCredits && !profile.usesPayments) blockers.push("CREDITS_REQUIRE_PAYMENT_OR_MANUAL_CREDIT_POLICY");
  for (const control of controls) {
    if (control.required) blockers.push(`VERIFY_${control.id.toUpperCase().replaceAll("-", "_")}`);
  }
  return blockers;
}

router.get("/business-security/requirements", (_req, res): void => {
  res.json({
    controls: BASE_CONTROLS,
    categories: ["server", "auth", "payments", "credits", "secrets", "deployment", "build"],
    valuesReturned: false,
  });
});

router.post("/business-security/plan", (req, res): void => {
  const profile = (req.body ?? {}) as AppProfile;
  const controls = buildControls(profile);
  res.json({
    appName: profile.appName ?? "Unnamed app",
    profile,
    controls,
    requiredControls: controls.filter((control) => control.required),
    envRequired: buildEnvRequirements(profile),
    buildHardeningCommands: buildHardeningCommands(profile),
    launchBlockers: blockersFor(profile, controls),
    valuesReturned: false,
  });
});

router.post("/business-security/build-hardening", (req, res): void => {
  const profile = (req.body ?? {}) as AppProfile;
  const commands = buildHardeningCommands(profile);
  const requiredEvidence = [
    "typecheck pass",
    "api tests pass",
    "api build pass",
    "frontend build pass",
    "secret scan clean",
    "required env checked",
    ...(profile.usesBrowserAutomation ? ["browser install pass", "browser runtime check pass"] : []),
  ];
  res.json({
    commands,
    requiredEvidence,
    failBuildIfMissing: requiredEvidence,
    valuesReturned: false,
  });
});

export default router;
