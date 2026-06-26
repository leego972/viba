export interface UrlSafetyResult {
  allowed: boolean;
  reason: string | null;
  url?: string;
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost") return true;
  if (host.startsWith("127.")) return true;
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;
  if (host.startsWith("169.254.")) return true;
  return false;
}

export function validateUrl(raw: string, options: { allowHttp?: boolean; context?: string } = {}): UrlSafetyResult {
  const allowHttp = options.allowHttp ?? true;
  if (!raw.trim()) return { allowed: false, reason: "URL_EMPTY" };

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { allowed: false, reason: "URL_INVALID" };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return { allowed: false, reason: "URL_BLOCKED_PROTOCOL" };
  if (!allowHttp && parsed.protocol === "http:") return { allowed: false, reason: "URL_BLOCKED_HTTP_NOT_ALLOWED" };
  if (isBlockedHost(parsed.hostname)) return { allowed: false, reason: "URL_BLOCKED_PRIVATE_NETWORK" };

  return { allowed: true, reason: null, url: parsed.toString() };
}

export function assertUrlSafe(raw: string, context = "URL"): asserts raw is string {
  const result = validateUrl(raw, { context });
  if (!result.allowed) {
    const err = new Error(`${context} is not allowed: ${result.reason}`) as Error & { status: number; code: string };
    err.status = 422;
    err.code = result.reason ?? "URL_BLOCKED";
    throw err;
  }
}
