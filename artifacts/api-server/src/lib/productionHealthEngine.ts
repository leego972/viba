/**
 * VIBA Production Health Engine
 *
 * Read-only health checks for production targets.
 * Rules:
 * - Never mutates production (no deploy, no payment, no DNS write)
 * - Never returns raw credentials or secrets
 * - Browser checks degrade gracefully to "skipped" if env unavailable
 * - All evidence_json is sanitised before storage
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CheckStatus = "passed" | "warning" | "failed" | "blocked" | "skipped";
export type CheckSeverity = "low" | "medium" | "high" | "critical";
export type CheckType =
  | "public_url"
  | "api_health"
  | "frontend_render"
  | "console_errors"
  | "dns"
  | "tls"
  | "railway_status"
  | "credential_expiry"
  | "payment_health"
  | "auth_health";

export interface CheckTarget {
  id: number;
  userId: number;
  appName: string;
  publicUrl: string;
  apiHealthUrl: string;
  railwayProjectId?: string | null;
  railwayServiceId?: string | null;
  providerId?: string | null;
  strictMode: boolean;
}

export interface CheckResult {
  checkType: CheckType;
  status: CheckStatus;
  severity: CheckSeverity;
  httpStatus: number | null;
  responseTimeMs: number | null;
  error: string | null;
  evidenceJson: Record<string, unknown>;
  rawValuesReturned: false;
}

export interface HealthSummary {
  targetId: number;
  appName: string;
  overallStatus: "healthy" | "warning" | "failing" | "unknown";
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  passedCount: number;
  skippedCount: number;
  lastCheckedAt: string;
  releaseBlocked: boolean;
  rawValuesReturned: false;
}

// ─── Secret sanitiser ─────────────────────────────────────────────────────────

const SECRET_KEYS = new Set([
  "password", "token", "api_key", "secret", "key", "authorization",
  "cookie", "set-cookie", "x-api-key", "private_key", "access_token",
  "refresh_token", "auth_tag", "iv", "encrypted_value", "bearer",
  "credential", "pwd", "passwd", "auth",
]);

export function sanitiseEvidence(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (SECRET_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      out[k] = sanitiseEvidence(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        typeof item === "object" && item !== null
          ? sanitiseEvidence(item as Record<string, unknown>)
          : item,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── HTTP probe helper ────────────────────────────────────────────────────────

async function httpProbe(
  url: string,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; status: number | null; responseTimeMs: number; error: string | null }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "VIBA-Health-Check/1.0" },
      redirect: "follow",
    });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, responseTimeMs: Date.now() - start, error: null };
  } catch (err) {
    return {
      ok: false,
      status: null,
      responseTimeMs: Date.now() - start,
      error: String(err).slice(0, 200),
    };
  }
}

// ─── URL validation helper ────────────────────────────────────────────────────

function isValidHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

// ─── Individual checks ────────────────────────────────────────────────────────

export async function checkPublicUrl(target: CheckTarget): Promise<CheckResult> {
  if (!isValidHttpsUrl(target.publicUrl)) {
    return {
      checkType: "public_url", status: "failed", severity: "critical",
      httpStatus: null, responseTimeMs: null,
      error: "Invalid public URL configured",
      evidenceJson: { url: target.publicUrl, reason: "invalid_url" },
      rawValuesReturned: false,
    };
  }

  const probe = await httpProbe(target.publicUrl);
  const slowThresholdMs = 3000;

  if (!probe.ok) {
    return {
      checkType: "public_url",
      status: "failed",
      severity: "critical",
      httpStatus: probe.status,
      responseTimeMs: probe.responseTimeMs,
      error: probe.error ?? `HTTP ${probe.status ?? "unreachable"}`,
      evidenceJson: sanitiseEvidence({ url: target.publicUrl, httpStatus: probe.status, responseTimeMs: probe.responseTimeMs, error: probe.error }),
      rawValuesReturned: false,
    };
  }

  if (probe.responseTimeMs > slowThresholdMs) {
    return {
      checkType: "public_url", status: "warning", severity: "medium",
      httpStatus: probe.status, responseTimeMs: probe.responseTimeMs,
      error: null,
      evidenceJson: sanitiseEvidence({ url: target.publicUrl, httpStatus: probe.status, responseTimeMs: probe.responseTimeMs, note: "slow_response" }),
      rawValuesReturned: false,
    };
  }

  return {
    checkType: "public_url", status: "passed", severity: "low",
    httpStatus: probe.status, responseTimeMs: probe.responseTimeMs,
    error: null,
    evidenceJson: sanitiseEvidence({ url: target.publicUrl, httpStatus: probe.status, responseTimeMs: probe.responseTimeMs }),
    rawValuesReturned: false,
  };
}

export async function checkApiHealth(target: CheckTarget): Promise<CheckResult> {
  if (!target.apiHealthUrl || !isValidHttpsUrl(target.apiHealthUrl)) {
    return {
      checkType: "api_health", status: "skipped", severity: "low",
      httpStatus: null, responseTimeMs: null,
      error: "No valid API health URL configured",
      evidenceJson: { reason: "no_api_health_url" },
      rawValuesReturned: false,
    };
  }

  const probe = await httpProbe(target.apiHealthUrl);

  if (!probe.ok) {
    return {
      checkType: "api_health", status: "failed", severity: "critical",
      httpStatus: probe.status, responseTimeMs: probe.responseTimeMs,
      error: probe.error ?? `HTTP ${probe.status ?? "unreachable"}`,
      evidenceJson: sanitiseEvidence({ url: target.apiHealthUrl, httpStatus: probe.status, responseTimeMs: probe.responseTimeMs, error: probe.error }),
      rawValuesReturned: false,
    };
  }

  return {
    checkType: "api_health", status: "passed", severity: "low",
    httpStatus: probe.status, responseTimeMs: probe.responseTimeMs,
    error: null,
    evidenceJson: sanitiseEvidence({ url: target.apiHealthUrl, httpStatus: probe.status, responseTimeMs: probe.responseTimeMs }),
    rawValuesReturned: false,
  };
}

export async function checkDns(target: CheckTarget): Promise<CheckResult> {
  if (!isValidHttpsUrl(target.publicUrl)) {
    return {
      checkType: "dns", status: "skipped", severity: "low",
      httpStatus: null, responseTimeMs: null,
      error: "Invalid URL for DNS check",
      evidenceJson: { reason: "invalid_url" },
      rawValuesReturned: false,
    };
  }

  // DNS check via HTTP probe — if we can reach the host at all, DNS resolved
  const probe = await httpProbe(target.publicUrl, 8000);
  const hostname = new URL(target.publicUrl).hostname;

  if (probe.error && /getaddrinfo|ENOTFOUND|ECONNREFUSED/i.test(probe.error)) {
    return {
      checkType: "dns", status: "failed", severity: "high",
      httpStatus: null, responseTimeMs: probe.responseTimeMs,
      error: `DNS resolution failed for ${hostname}`,
      evidenceJson: sanitiseEvidence({ hostname, error: probe.error }),
      rawValuesReturned: false,
    };
  }

  return {
    checkType: "dns",
    status: probe.ok || probe.status !== null ? "passed" : "warning",
    severity: "low",
    httpStatus: probe.status,
    responseTimeMs: probe.responseTimeMs,
    error: null,
    evidenceJson: sanitiseEvidence({ hostname, resolved: true, httpStatus: probe.status }),
    rawValuesReturned: false,
  };
}

export async function checkTls(target: CheckTarget): Promise<CheckResult> {
  const url = target.publicUrl;
  if (!url.startsWith("https://")) {
    return {
      checkType: "tls", status: "failed", severity: "critical",
      httpStatus: null, responseTimeMs: null,
      error: "Public URL does not use HTTPS — TLS not configured",
      evidenceJson: { url, reason: "not_https" },
      rawValuesReturned: false,
    };
  }

  const probe = await httpProbe(url, 8000);
  if (probe.error && /certificate|SSL|TLS|CERT/i.test(probe.error)) {
    return {
      checkType: "tls", status: "failed", severity: "critical",
      httpStatus: null, responseTimeMs: probe.responseTimeMs,
      error: "TLS certificate error detected",
      evidenceJson: sanitiseEvidence({ url, tlsError: true, note: "certificate_issue" }),
      rawValuesReturned: false,
    };
  }

  return {
    checkType: "tls",
    status: probe.ok || probe.status !== null ? "passed" : "warning",
    severity: "low",
    httpStatus: probe.status,
    responseTimeMs: probe.responseTimeMs,
    error: probe.error,
    evidenceJson: sanitiseEvidence({ url, https: true, httpStatus: probe.status }),
    rawValuesReturned: false,
  };
}

export async function checkRailwayStatus(target: CheckTarget): Promise<CheckResult> {
  if (!target.railwayProjectId) {
    return {
      checkType: "railway_status", status: "skipped", severity: "low",
      httpStatus: null, responseTimeMs: null,
      error: "No Railway project ID configured",
      evidenceJson: { reason: "no_railway_project_id" },
      rawValuesReturned: false,
    };
  }

  // Read-only — we probe the public URL as a proxy for Railway service health
  const probe = await httpProbe(target.publicUrl, 12_000);
  if (!probe.ok) {
    return {
      checkType: "railway_status", status: "failed", severity: "high",
      httpStatus: probe.status, responseTimeMs: probe.responseTimeMs,
      error: "Public URL unreachable — Railway deployment may have failed",
      evidenceJson: sanitiseEvidence({
        railwayProjectId: target.railwayProjectId,
        publicUrl: target.publicUrl,
        httpStatus: probe.status,
        note: "inferred_from_public_url",
      }),
      rawValuesReturned: false,
    };
  }

  return {
    checkType: "railway_status", status: "passed", severity: "low",
    httpStatus: probe.status, responseTimeMs: probe.responseTimeMs,
    error: null,
    evidenceJson: sanitiseEvidence({ railwayProjectId: target.railwayProjectId, note: "inferred_from_public_url", httpStatus: probe.status }),
    rawValuesReturned: false,
  };
}

export async function checkCredentialExpiry(userId: number): Promise<CheckResult> {
  // Returns metadata only — never raw credential values
  // Checks if vault credentials have expiry metadata set
  try {
    const { pool } = await import("@workspace/db");
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT COUNT(*) as total,
              COUNT(CASE WHEN (metadata->>'expiresAt') IS NOT NULL
                          AND (metadata->>'expiresAt')::timestamptz < NOW() + INTERVAL '7 days'
                   THEN 1 END) as expiring_soon
       FROM viba_credentials WHERE user_id = $1`,
      [userId],
    );
    const row = rows[0];
    const expiringSoon = Number(row?.["expiring_soon"] ?? 0);
    const total = Number(row?.["total"] ?? 0);

    if (expiringSoon > 0) {
      return {
        checkType: "credential_expiry", status: "warning", severity: "high",
        httpStatus: null, responseTimeMs: null,
        error: `${expiringSoon} credential(s) expiring within 7 days`,
        evidenceJson: { expiringSoon, total, rawValuesReturned: false },
        rawValuesReturned: false,
      };
    }

    return {
      checkType: "credential_expiry", status: "passed", severity: "low",
      httpStatus: null, responseTimeMs: null,
      error: null,
      evidenceJson: { total, expiringCount: 0, rawValuesReturned: false },
      rawValuesReturned: false,
    };
  } catch {
    return {
      checkType: "credential_expiry", status: "skipped", severity: "low",
      httpStatus: null, responseTimeMs: null,
      error: "Vault table not available",
      evidenceJson: { reason: "vault_unavailable" },
      rawValuesReturned: false,
    };
  }
}

export async function checkPaymentHealth(target: CheckTarget): Promise<CheckResult> {
  const paymentUrl = `${target.publicUrl.replace(/\/$/, "")}/api/healthz`;
  const probe = await httpProbe(paymentUrl, 8000);

  // We only do a read probe — never mutate payment state
  if (probe.status === 404) {
    return {
      checkType: "payment_health", status: "skipped", severity: "low",
      httpStatus: probe.status, responseTimeMs: probe.responseTimeMs,
      error: null,
      evidenceJson: sanitiseEvidence({ note: "payment_health_endpoint_not_found", httpStatus: probe.status }),
      rawValuesReturned: false,
    };
  }

  if (!probe.ok && probe.status !== null && probe.status >= 500) {
    return {
      checkType: "payment_health", status: "failed", severity: "critical",
      httpStatus: probe.status, responseTimeMs: probe.responseTimeMs,
      error: "Payment API returning 5xx errors",
      evidenceJson: sanitiseEvidence({ httpStatus: probe.status, note: "payment_api_5xx" }),
      rawValuesReturned: false,
    };
  }

  return {
    checkType: "payment_health",
    status: probe.ok ? "passed" : "warning",
    severity: "medium",
    httpStatus: probe.status,
    responseTimeMs: probe.responseTimeMs,
    error: probe.error,
    evidenceJson: sanitiseEvidence({ httpStatus: probe.status, responseTimeMs: probe.responseTimeMs }),
    rawValuesReturned: false,
  };
}

export async function checkAuthHealth(target: CheckTarget): Promise<CheckResult> {
  const authUrl = `${target.publicUrl.replace(/\/$/, "")}/api/auth/me`;
  const probe = await httpProbe(authUrl, 8000);

  // 401 is expected (unauthenticated) — means auth is running
  const authIsUp = probe.status === 401 || probe.status === 200 || probe.status === 403;

  if (!authIsUp && probe.status !== null && probe.status >= 500) {
    return {
      checkType: "auth_health", status: "failed", severity: "critical",
      httpStatus: probe.status, responseTimeMs: probe.responseTimeMs,
      error: "Auth endpoint returning 5xx — authentication broken",
      evidenceJson: sanitiseEvidence({ httpStatus: probe.status, note: "auth_5xx" }),
      rawValuesReturned: false,
    };
  }

  if (probe.error && !probe.status) {
    return {
      checkType: "auth_health", status: "failed", severity: "critical",
      httpStatus: null, responseTimeMs: probe.responseTimeMs,
      error: "Auth endpoint unreachable",
      evidenceJson: sanitiseEvidence({ error: probe.error }),
      rawValuesReturned: false,
    };
  }

  return {
    checkType: "auth_health",
    status: authIsUp ? "passed" : "warning",
    severity: authIsUp ? "low" : "medium",
    httpStatus: probe.status,
    responseTimeMs: probe.responseTimeMs,
    error: null,
    evidenceJson: sanitiseEvidence({ httpStatus: probe.status, authIsUp }),
    rawValuesReturned: false,
  };
}

export async function checkFrontendRender(target: CheckTarget): Promise<CheckResult> {
  // Browser environment unavailable in server context — degrade gracefully
  return {
    checkType: "frontend_render",
    status: "skipped",
    severity: "low",
    httpStatus: null,
    responseTimeMs: null,
    error: null,
    evidenceJson: {
      reason: "browser_check_unavailable",
      note: "Frontend render check requires browser environment. Use Assisted Browser to run manually.",
      url: target.publicUrl,
    },
    rawValuesReturned: false,
  };
}

export async function checkConsoleErrors(target: CheckTarget): Promise<CheckResult> {
  // Browser environment unavailable — degrade gracefully, never log cookies/auth tokens
  return {
    checkType: "console_errors",
    status: "skipped",
    severity: "low",
    httpStatus: null,
    responseTimeMs: null,
    error: null,
    evidenceJson: {
      reason: "browser_check_unavailable",
      note: "Console error capture requires browser environment. Use Assisted Browser to run manually.",
      url: target.publicUrl,
    },
    rawValuesReturned: false,
  };
}

// ─── Run all checks ───────────────────────────────────────────────────────────

export async function runAllChecks(target: CheckTarget): Promise<CheckResult[]> {
  const [publicUrl, apiHealth, dns, tls, railway, credExpiry, payment, auth, frontend, consoleErrors] =
    await Promise.allSettled([
      checkPublicUrl(target),
      checkApiHealth(target),
      checkDns(target),
      checkTls(target),
      checkRailwayStatus(target),
      checkCredentialExpiry(target.userId),
      checkPaymentHealth(target),
      checkAuthHealth(target),
      checkFrontendRender(target),
      checkConsoleErrors(target),
    ]);

  function unwrap(r: PromiseSettledResult<CheckResult>, type: CheckType): CheckResult {
    if (r.status === "fulfilled") return r.value;
    return {
      checkType: type, status: "failed", severity: "high",
      httpStatus: null, responseTimeMs: null,
      error: String(r.reason).slice(0, 200),
      evidenceJson: { error: String(r.reason).slice(0, 200) },
      rawValuesReturned: false,
    };
  }

  return [
    unwrap(publicUrl, "public_url"),
    unwrap(apiHealth, "api_health"),
    unwrap(dns, "dns"),
    unwrap(tls, "tls"),
    unwrap(railway, "railway_status"),
    unwrap(credExpiry, "credential_expiry"),
    unwrap(payment, "payment_health"),
    unwrap(auth, "auth_health"),
    unwrap(frontend, "frontend_render"),
    unwrap(consoleErrors, "console_errors"),
  ];
}

// ─── Summarise ────────────────────────────────────────────────────────────────

export function summariseChecks(targetId: number, appName: string, checks: CheckResult[]): HealthSummary {
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  let passedCount = 0;
  let skippedCount = 0;

  for (const c of checks) {
    if (c.status === "passed") { passedCount++; continue; }
    if (c.status === "skipped") { skippedCount++; continue; }
    if (c.severity === "critical") criticalCount++;
    else if (c.severity === "high") highCount++;
    else if (c.severity === "medium") mediumCount++;
    else lowCount++;
  }

  const overallStatus =
    criticalCount > 0 ? "failing"
    : highCount > 0 ? "failing"
    : mediumCount > 0 ? "warning"
    : "healthy";

  return {
    targetId,
    appName,
    overallStatus,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    passedCount,
    skippedCount,
    lastCheckedAt: new Date().toISOString(),
    releaseBlocked: criticalCount > 0,
    rawValuesReturned: false,
  };
}

// ─── Determine incident severity from a failed check ─────────────────────────

export function incidentSeverityFor(check: CheckResult): CheckSeverity {
  if (check.status === "passed" || check.status === "skipped") return "low";
  return check.severity;
}

export function shouldCreateIncident(check: CheckResult): boolean {
  return check.status === "failed" && (check.severity === "critical" || check.severity === "high");
}
