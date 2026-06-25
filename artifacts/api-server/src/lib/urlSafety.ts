/**
 * VIBA URL Safety — SSRF Prevention
 *
 * Validates URLs before they are used for:
 * - Project import repo URLs
 * - Production target health-check URLs
 * - Browser operator target URLs
 * - Deployment provider dashboard URLs
 * - Web research URLs
 * - Custom webhook / callback endpoints
 */

export interface UrlSafetyResult {
  allowed: boolean;
  reason: string | null;
  url?: string;
}

// ─── Private/reserved IP ranges ───────────────────────────────────────────────

/**
 * Returns true when the hostname resolves to a private/reserved IP space.
 * We check by string pattern (no DNS lookup) to stay synchronous.
 */
function isPrivateHostname(hostname: string): boolean {
  // Strip IPv6 brackets
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "");

  // Loopback
  if (host === "localhost") return true;
  if (host === "::1") return true;
  if (/^127\./.test(host)) return true;

  // All-zeros
  if (host === "0.0.0.0") return true;
  if (host === "::") return true;

  // RFC 1918 private
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  // 172.16.0.0/12  →  172.16.x.x – 172.31.x.x
  const m172 = host.match(/^172\.(\d+)\./);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;

  // Link-local  169.254.x.x / fe80::/10
  if (/^169\.254\./.test(host)) return true;
  if (/^fe80:/i.test(host)) return true;

  // Cloud metadata services
  if (host === "169.254.169.254") return true;  // AWS/GCP/Azure IMDS
  if (host === "metadata.google.internal") return true;
  if (host === "metadata") return true;
  if (/^100\.64\./.test(host)) return true; // CGNAT / RFC 6598

  // Catch bare local hostnames (no dot → internal DNS)
  // We allow "localhost" check above; other no-dot names (e.g. "db", "redis") are blocked
  if (!host.includes(".") && host !== "localhost") return true;

  return false;
}

// ─── Allowed protocols ────────────────────────────────────────────────────────

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

// ─── Main validator ───────────────────────────────────────────────────────────

/**
 * Validate a URL for use in any outbound network operation.
 *
 * @param raw       The raw URL string supplied by user or agent.
 * @param options   Optional overrides for specific use cases.
 */
export function validateUrl(
  raw: string,
  options: {
    /** Allow http:// in addition to https:// (default: true) */
    allowHttp?: boolean;
    /** Label for error messages */
    context?: string;
  } = {}
): UrlSafetyResult {
  const { allowHttp = true, context = "URL" } = options;

  // Must be a non-empty string
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return { allowed: false, reason: "URL_EMPTY" };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { allowed: false, reason: "URL_INVALID" };
  }

  // Protocol check
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      allowed: false,
      reason: `URL_BLOCKED_PROTOCOL:${parsed.protocol}`,
    };
  }

  if (!allowHttp && parsed.protocol === "http:") {
    return { allowed: false, reason: "URL_BLOCKED_HTTP_NOT_ALLOWED" };
  }

  // Private network check
  if (isPrivateHostname(parsed.hostname)) {
    return {
      allowed: false,
      reason: "URL_BLOCKED_PRIVATE_NETWORK",
    };
  }

  return { allowed: true, reason: null, url: parsed.toString() };
}

/**
 * Assert that a URL is safe, throwing a structured error if not.
 * Suitable for use in route handlers where invalid URLs should 422.
 */
export function assertUrlSafe(
  raw: string,
  context = "URL"
): asserts raw is string {
  const result = validateUrl(raw, { context });
  if (!result.allowed) {
    const err = new Error(
      `${context} is not allowed: ${result.reason}`
    ) as Error & { status: number; code: string };
    err.status = 422;
    err.code = result.reason ?? "URL_BLOCKED";
    throw err;
  }
}
