import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export interface SafeProbeResult {
  ok: boolean;
  status: number | null;
  responseTimeMs: number;
  error: string | null;
  finalUrl: string | null;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
]);

function isBlockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith("ff")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isBlockedIpv4(mapped[1]!) : false;
}

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

export function validatePublicHttpUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Only HTTP and HTTPS URLs are allowed" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "URLs containing credentials are not allowed" };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost") || !hostname.includes(".")) {
    return { ok: false, error: "Private or local network destinations are not allowed" };
  }
  if (net.isIP(hostname) && isBlockedAddress(hostname)) {
    return { ok: false, error: "Private or reserved IP destinations are not allowed" };
  }

  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (port !== "443" && port !== "80") {
    return { ok: false, error: "Only standard HTTP/HTTPS ports are allowed" };
  }

  return { ok: true, url };
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("Hostname did not resolve");
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new Error("Hostname resolves to a private or reserved network address");
  }
  const selected = addresses[0]!;
  return { address: selected.address, family: selected.family as 4 | 6 };
}

async function requestOnce(url: URL, timeoutMs: number): Promise<{ status: number; location: string | null }> {
  const resolved = await resolvePublicAddress(url.hostname);
  const transport = url.protocol === "https:" ? https : http;

  return await new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: "GET",
      headers: {
        "User-Agent": "VIBA-Health-Check/1.0",
        Accept: "text/html,application/json;q=0.9,*/*;q=0.1",
      },
      lookup: (_hostname, _options, callback) => {
        callback(null, resolved.address, resolved.family);
      },
      timeout: timeoutMs,
    }, (response) => {
      response.resume();
      resolve({
        status: response.statusCode ?? 0,
        location: typeof response.headers.location === "string" ? response.headers.location : null,
      });
    });

    request.on("timeout", () => request.destroy(new Error("Request timed out")));
    request.on("error", reject);
    request.end();
  });
}

export async function safeHttpProbe(rawUrl: string, timeoutMs = 10_000, maxRedirects = 3): Promise<SafeProbeResult> {
  const startedAt = Date.now();
  let currentRaw = rawUrl;

  try {
    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
      const validation = validatePublicHttpUrl(currentRaw);
      if (!validation.ok) throw new Error(validation.error);

      const result = await requestOnce(validation.url, timeoutMs);
      const isRedirect = result.status >= 300 && result.status < 400 && result.location;
      if (isRedirect) {
        if (redirect === maxRedirects) throw new Error("Too many redirects");
        currentRaw = new URL(result.location!, validation.url).toString();
        continue;
      }

      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status || null,
        responseTimeMs: Date.now() - startedAt,
        error: null,
        finalUrl: validation.url.toString(),
      };
    }
    throw new Error("Too many redirects");
  } catch (error) {
    return {
      ok: false,
      status: null,
      responseTimeMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
      finalUrl: null,
    };
  }
}
