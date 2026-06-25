export interface UrlSafetyResult {
  allowed: boolean;
  reason: string;
  normalizedUrl: string | null;
  hostname: string | null;
  protocol: string | null;
}

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain"]);
const BLOCKED_IPV4_EXACT = new Set(["0.0.0.0", "127.0.0.1", "169.254.169.254", "255.255.255.255"]);

function isIpv4(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function parseIpv4(hostname: string): number[] | null {
  if (!isIpv4(hostname)) return null;
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = parseIpv4(hostname);
  if (!parts) return false;
  const [a, b] = parts;
  if (a === undefined || b === undefined) return false;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 0) return true;
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(lower)) return true;
  if (BLOCKED_IPV4_EXACT.has(lower)) return true;
  if (lower.endsWith(".local") || lower.endsWith(".internal") || lower.endsWith(".lan")) return true;
  if (isPrivateIpv4(lower)) return true;
  return false;
}

export function validatePublicHttpUrl(input: unknown): UrlSafetyResult {
  if (typeof input !== "string" || input.trim().length === 0) {
    return { allowed: false, reason: "URL_REQUIRED", normalizedUrl: null, hostname: null, protocol: null };
  }

  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return { allowed: false, reason: "URL_INVALID", normalizedUrl: null, hostname: null, protocol: null };
  }

  const protocol = parsed.protocol.replace(":", "").toLowerCase();
  const hostname = parsed.hostname.toLowerCase();

  if (protocol !== "http" && protocol !== "https") {
    return { allowed: false, reason: "URL_BLOCKED_PROTOCOL", normalizedUrl: parsed.toString(), hostname, protocol };
  }

  if (!hostname) {
    return { allowed: false, reason: "URL_HOST_REQUIRED", normalizedUrl: parsed.toString(), hostname: null, protocol };
  }

  if (isBlockedHostname(hostname)) {
    return { allowed: false, reason: "URL_BLOCKED_PRIVATE_NETWORK", normalizedUrl: parsed.toString(), hostname, protocol };
  }

  if (parsed.username || parsed.password) {
    return { allowed: false, reason: "URL_BLOCKED_EMBEDDED_CREDENTIALS", normalizedUrl: parsed.toString(), hostname, protocol };
  }

  return { allowed: true, reason: "URL_ALLOWED", normalizedUrl: parsed.toString(), hostname, protocol };
}

export function assertPublicHttpUrl(input: unknown): string {
  const result = validatePublicHttpUrl(input);
  if (!result.allowed || !result.normalizedUrl) {
    throw new Error(result.reason);
  }
  return result.normalizedUrl;
}
