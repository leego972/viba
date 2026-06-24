import { Router, type IRouter } from "express";

const router: IRouter = Router();

interface SecurityControl {
  id: string;
  category: string;
  label: string;
  description: string;
  required: boolean;
  launchBlocker: boolean;
  envNames?: string[];
  buildCommands?: string[];
  evidenceRequired?: string[];
}

const ALL_CONTROLS: SecurityControl[] = [
  // Server hardening
  { id: "security_headers", category: "server", label: "Security Headers", description: "CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS (prod)", required: true, launchBlocker: true },
  { id: "hsts", category: "server", label: "HSTS in production", description: "Strict-Transport-Security: max-age=31536000; includeSubDomains; preload", required: true, launchBlocker: true },
  { id: "cors_allowlist", category: "server", label: "CORS Allowlist", description: "CORS restricted to known origins. CORS_ALLOWED_ORIGINS env var in production.", required: true, launchBlocker: true, envNames: ["CORS_ALLOWED_ORIGINS"] },
  { id: "trust_proxy", category: "server", label: "Trust Proxy = 1", description: "Required on Railway/load-balancers so req.ip is the real client IP.", required: true, launchBlocker: false },
  { id: "body_size_limit", category: "server", label: "Body Size Limit", description: "JSON/urlencoded body capped (512kb default) to prevent memory exhaustion.", required: true, launchBlocker: true },
  { id: "error_redaction", category: "server", label: "Error Redaction", description: "Stack traces and internal details not exposed in production error responses.", required: true, launchBlocker: true },
  { id: "request_correlation_id", category: "server", label: "Request Correlation ID", description: "Each request gets a correlation/trace ID for log attribution.", required: false, launchBlocker: false },

  // Rate limiting
  { id: "rate_limit_auth", category: "rate_limiting", label: "Auth Rate Limit", description: "Login, register, and password reset routes capped (10 req/min default).", required: true, launchBlocker: true },
  { id: "rate_limit_api", category: "rate_limiting", label: "API Rate Limit", description: "General API routes capped (300 req/min default).", required: true, launchBlocker: true },
  { id: "rate_limit_payments", category: "rate_limiting", label: "Payment Rate Limit", description: "Checkout and billing routes separately rate-limited.", required: true, launchBlocker: true },
  { id: "rate_limit_uploads", category: "rate_limiting", label: "Upload Rate Limit", description: "File upload routes separately rate-limited.", required: false, launchBlocker: false },

  // Auth & session
  { id: "session_secret", category: "auth", label: "SESSION_SECRET Env Var", description: "Strong random SESSION_SECRET required in production. Not 'dev' or short strings.", required: true, launchBlocker: true, envNames: ["SESSION_SECRET"] },
  { id: "session_secure_cookie", category: "auth", label: "Secure Session Cookie", description: "Cookie: secure=true, sameSite=none in production.", required: true, launchBlocker: true },
  { id: "oauth_state", category: "auth", label: "OAuth State Parameter", description: "All OAuth flows use CSRF-protected state parameter.", required: true, launchBlocker: true },

  // Payments
  { id: "stripe_webhook_verify", category: "payments", label: "Stripe Webhook Signature Verification", description: "Raw body preserved for /api/stripe/webhook. Signature verified before processing.", required: true, launchBlocker: true, envNames: ["STRIPE_WEBHOOK_SECRET"] },
  { id: "credit_ledger_integrity", category: "payments", label: "Credit Ledger Integrity", description: "Credit deductions are atomic. Credits not double-spent. Negative balance blocked.", required: true, launchBlocker: true },

  // Secrets vault
  { id: "credential_encryption_key", category: "vault", label: "Credential Encryption Key", description: "CREDENTIAL_ENCRYPTION_KEY or MASTER_ENCRYPTION_KEY set in production.", required: true, launchBlocker: true, envNames: ["CREDENTIAL_ENCRYPTION_KEY", "MASTER_ENCRYPTION_KEY"] },
  { id: "keys_not_in_settings_table", category: "vault", label: "API Keys Not in Settings Table", description: "Provider API keys stored in vault (AES-256-GCM). Never in plaintext settingsTable.", required: true, launchBlocker: true },
  { id: "raw_key_not_returned", category: "vault", label: "Raw Keys Never Returned", description: "API responses never include raw credential values.", required: true, launchBlocker: true },

  // DNS / TLS / Public origin
  { id: "tls_production", category: "dns_tls", label: "TLS in Production", description: "App served over HTTPS only. Railway provides TLS automatically.", required: true, launchBlocker: true },
  { id: "custom_domain", category: "dns_tls", label: "Custom Domain CNAME", description: "Custom domain (viba.guru) CNAME points to cname.railway.app.", required: false, launchBlocker: false, envNames: ["RAILWAY_CUSTOM_DOMAIN"] },

  // Uploads
  { id: "upload_file_type_validation", category: "uploads", label: "File Type Validation", description: "Uploaded files validated by MIME type and extension.", required: false, launchBlocker: false },
  { id: "upload_size_limit", category: "uploads", label: "Upload Size Limit", description: "Max upload size enforced (e.g. 10MB).", required: false, launchBlocker: false },
  { id: "upload_malware_scan", category: "uploads", label: "Malware Scan", description: "Uploaded files scanned before processing. Required if app accepts user uploads.", required: false, launchBlocker: false, evidenceRequired: ["ClamAV or equivalent integrated"] },
  { id: "upload_zip_bomb_protection", category: "uploads", label: "Zip-bomb Protection", description: "Archive extraction size-checked before decompression.", required: false, launchBlocker: false },
  { id: "upload_quarantine", category: "uploads", label: "Upload Quarantine", description: "Uploaded files quarantined before any processing.", required: false, launchBlocker: false },

  // Build safety
  { id: "dependency_audit", category: "build", label: "Dependency Audit", description: "pnpm audit before every build in CI.", required: true, launchBlocker: false, buildCommands: ["pnpm audit"] },
  { id: "secret_scan", category: "build", label: "Secret Scan", description: "Source code scanned for accidentally committed secrets.", required: true, launchBlocker: true, buildCommands: ["npx secretlint '**/*'"] },
  { id: "malicious_package_scan", category: "build", label: "Malicious Package Scan", description: "Dependencies audited for known malicious packages.", required: true, launchBlocker: false, buildCommands: ["pnpm audit --audit-level moderate"] },
  { id: "build_no_exec_unknown_scripts", category: "build", label: "No Auto-execute Unknown Scripts", description: "Build pipeline does not run postinstall scripts from unknown packages without review.", required: true, launchBlocker: true },

  // Browser operator
  { id: "browser_downloads_blocked", category: "browser", label: "Browser Downloads Blocked by Default", description: "Browser operator does not download files unless explicitly allowed.", required: false, launchBlocker: false },
  { id: "browser_download_quarantine", category: "browser", label: "Browser Download Quarantine", description: "Any browser download is quarantined and not auto-executed.", required: false, launchBlocker: false },
  { id: "browser_no_exec_downloads", category: "browser", label: "No Auto-Execute Browser Downloads", description: "Files downloaded by the browser operator are never automatically executed.", required: false, launchBlocker: true },
];

function detectMissingControls(): { present: string[]; missing: string[]; launchBlockers: string[] } {
  const present: string[] = [];
  const missing: string[] = [];
  const launchBlockers: string[] = [];

  for (const ctrl of ALL_CONTROLS) {
    let isPresent = true;

    if (ctrl.envNames && ctrl.envNames.length > 0) {
      const hasAny = ctrl.envNames.some((e) => Boolean(process.env[e]));
      if (!hasAny) isPresent = false;
    }

    if (isPresent) {
      present.push(ctrl.id);
    } else {
      missing.push(ctrl.id);
      if (ctrl.launchBlocker) launchBlockers.push(ctrl.id);
    }
  }

  return { present, missing, launchBlockers };
}

function detectAppFeatures(): { acceptsUploads: boolean; hasPayments: boolean; hasBrowserOperator: boolean; isPublic: boolean } {
  return {
    acceptsUploads: Boolean(process.env.UPLOAD_ENABLED),
    hasPayments: Boolean(process.env.STRIPE_SECRET_KEY),
    hasBrowserOperator: true,
    isPublic: process.env.NODE_ENV === "production",
  };
}

// GET /api/business-security/requirements
router.get("/business-security/requirements", (_req, res): void => {
  const features = detectAppFeatures();
  const { present, missing, launchBlockers } = detectMissingControls();

  const relevantControls = ALL_CONTROLS.filter((ctrl) => {
    if (ctrl.category === "uploads" && !features.acceptsUploads) return false;
    if (ctrl.category === "payments" && !features.hasPayments) return false;
    if (ctrl.category === "browser" && !features.hasBrowserOperator) return false;
    return true;
  });

  const requiredEnvNames = [
    ...new Set(
      relevantControls
        .filter((c) => c.required && c.envNames)
        .flatMap((c) => c.envNames ?? []),
    ),
  ];

  res.json({
    app: "VIBA",
    detectedFeatures: features,
    controls: relevantControls,
    presentControls: present.filter((p) => relevantControls.find((c) => c.id === p)),
    missingControls: missing.filter((m) => relevantControls.find((c) => c.id === m)),
    launchBlockers: launchBlockers.filter((b) => relevantControls.find((c) => c.id === b)),
    requiredEnvNames,
    note: "Raw secrets are never returned by this endpoint.",
  });
});

// POST /api/business-security/plan
router.post("/business-security/plan", (req, res): void => {
  const body = req.body as {
    acceptsUploads?: boolean;
    hasPayments?: boolean;
    hasBrowserOperator?: boolean;
    isPublic?: boolean;
  };

  const features = {
    acceptsUploads: body.acceptsUploads ?? false,
    hasPayments: body.hasPayments ?? Boolean(process.env.STRIPE_SECRET_KEY),
    hasBrowserOperator: body.hasBrowserOperator ?? true,
    isPublic: body.isPublic ?? (process.env.NODE_ENV === "production"),
  };

  const relevantControls = ALL_CONTROLS.filter((ctrl) => {
    if (ctrl.category === "uploads" && !features.acceptsUploads) return false;
    if (ctrl.category === "payments" && !features.hasPayments) return false;
    if (ctrl.category === "browser" && !features.hasBrowserOperator) return false;
    return true;
  });

  const { launchBlockers } = detectMissingControls();
  const applicableBlockers = launchBlockers.filter((b) => relevantControls.find((c) => c.id === b));

  const uploadControls: string[] = [];
  if (features.acceptsUploads) {
    uploadControls.push(
      "REQUIRED: File type validation (MIME + extension whitelist)",
      "REQUIRED: Upload size limit (e.g. max 10MB)",
      "REQUIRED: Zip-bomb protection (max decompressed size check)",
      "REQUIRED: Quarantine uploaded files before processing",
      "BLOCKER: Malware scan (ClamAV or equivalent) required before launch",
    );
  }

  const browserControls: string[] = [];
  if (features.hasBrowserOperator) {
    browserControls.push(
      "BLOCKER: Browser operator must NOT auto-execute downloaded files",
      "REQUIRED: Downloads blocked by default — explicit user allowlist only",
      "REQUIRED: Any allowed download quarantined before processing",
    );
  }

  res.json({
    app: "VIBA",
    features,
    requiredControls: relevantControls.filter((c) => c.required).map((c) => c.label),
    launchBlockers: applicableBlockers,
    uploadSecurityRequirements: uploadControls,
    browserSecurityRequirements: browserControls,
    buildHardeningCommands: [
      ...new Set(relevantControls.filter((c) => c.buildCommands).flatMap((c) => c.buildCommands ?? [])),
    ],
    evidenceRequiredBeforeLaunch: [
      ...new Set(relevantControls.filter((c) => c.evidenceRequired).flatMap((c) => c.evidenceRequired ?? [])),
    ],
  });
});

// POST /api/business-security/build-hardening
router.post("/business-security/build-hardening", (_req, res): void => {
  const { present, missing, launchBlockers } = detectMissingControls();
  const features = detectAppFeatures();

  const checks: Array<{ id: string; status: "pass" | "fail" | "warn"; message: string }> = [];

  for (const ctrl of ALL_CONTROLS) {
    if (ctrl.category === "uploads" && !features.acceptsUploads) continue;
    if (ctrl.category === "payments" && !features.hasPayments) continue;
    if (ctrl.category === "browser" && !features.hasBrowserOperator) continue;

    if (present.includes(ctrl.id)) {
      checks.push({ id: ctrl.id, status: "pass", message: `${ctrl.label}: configured` });
    } else if (ctrl.launchBlocker) {
      checks.push({ id: ctrl.id, status: "fail", message: `BLOCKER — ${ctrl.label}: ${ctrl.description}` });
    } else {
      checks.push({ id: ctrl.id, status: "warn", message: `MISSING — ${ctrl.label}: ${ctrl.description}` });
    }
  }

  const failed = checks.filter((c) => c.status === "fail");
  const readyForLaunch = failed.length === 0;

  res.json({
    app: "VIBA",
    readyForLaunch,
    launchBlockers,
    checks,
    missingControls: missing,
    summary: readyForLaunch
      ? "All launch blockers cleared. Review warnings before deploying."
      : `${failed.length} launch blocker(s) must be resolved before deployment.`,
  });
});

export default router;
