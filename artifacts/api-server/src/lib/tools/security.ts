/**
 * VIBA Security Tools
 *
 * headers_audit   — check HTTP security headers (HSTS, CSP, X-Frame-Options, etc.)
 * ssl_check       — inspect TLS/SSL certificate validity, expiry, and issuer
 * cors_check      — test CORS configuration of an API endpoint
 * secrets_scan    — scan code/text for exposed secrets, tokens, and API keys
 * password_audit  — check if a password has appeared in known data breaches (HaveIBeenPwned k-anon)
 * url_reputation  — check a URL against URLhaus malware/phishing database
 */

import tls from "node:tls";
import crypto from "node:crypto";

export interface SecurityTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }

// ── Secret patterns ──────────────────────────────────────────────────────────
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "AWS Access Key",        pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "AWS Secret Key",        pattern: /[A-Za-z0-9/+=]{40}(?=\s|$|["'])/g },
  { name: "OpenAI API Key",        pattern: /sk-[A-Za-z0-9]{20,}/g },
  { name: "Anthropic API Key",     pattern: /sk-ant-[A-Za-z0-9\-_]{40,}/g },
  { name: "GitHub Token (classic)",pattern: /ghp_[A-Za-z0-9]{36}/g },
  { name: "GitHub Token (fine)",   pattern: /github_pat_[A-Za-z0-9_]{82}/g },
  { name: "Stripe Secret Key",     pattern: /sk_(?:live|test)_[A-Za-z0-9]{24,}/g },
  { name: "Stripe Publishable Key",pattern: /pk_(?:live|test)_[A-Za-z0-9]{24,}/g },
  { name: "Slack Bot Token",       pattern: /xoxb-[0-9A-Za-z\-]{40,}/g },
  { name: "Slack Webhook",         pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g },
  { name: "Discord Token",         pattern: /[MN][A-Za-z0-9]{23}\.[A-Za-z0-9_\-]{6}\.[A-Za-z0-9_\-]{27}/g },
  { name: "Discord Webhook",       pattern: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_\-]+/g },
  { name: "JWT Token",             pattern: /eyJ[A-Za-z0-9\-_=]+\.eyJ[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]*/g },
  { name: "Private Key (PEM)",     pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "Generic API Key",       pattern: /(?:api[_\-]?key|apikey|api[_\-]?secret|access[_\-]?token|auth[_\-]?token)\s*[:=]\s*["']?[A-Za-z0-9\-_.]{16,}["']?/gi },
  { name: "Hardcoded Password",    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"'\s]{6,}["']/gi },
  { name: "Database URL",          pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^@\s]+:[^@\s]+@[^\s]+/gi },
];

// ── Security headers reference ───────────────────────────────────────────────
const SECURITY_HEADERS: Array<{ name: string; key: string; severity: "critical" | "high" | "medium" | "low"; description: string }> = [
  { name: "Strict-Transport-Security", key: "strict-transport-security", severity: "high", description: "HSTS — forces HTTPS. Missing means downgrade attacks are possible." },
  { name: "Content-Security-Policy",   key: "content-security-policy",   severity: "high", description: "CSP — prevents XSS and injection attacks." },
  { name: "X-Frame-Options",           key: "x-frame-options",           severity: "medium", description: "Prevents clickjacking. Superseded by CSP frame-ancestors but still important." },
  { name: "X-Content-Type-Options",    key: "x-content-type-options",    severity: "medium", description: "Prevents MIME-type sniffing. Should be 'nosniff'." },
  { name: "Referrer-Policy",           key: "referrer-policy",           severity: "low", description: "Controls how much referrer info is sent with requests." },
  { name: "Permissions-Policy",        key: "permissions-policy",        severity: "low", description: "Restricts access to browser APIs (camera, mic, geolocation)." },
  { name: "X-XSS-Protection",         key: "x-xss-protection",          severity: "low", description: "Legacy XSS filter (deprecated in modern browsers, but a signal of security awareness)." },
  { name: "Cross-Origin-Opener-Policy",key: "cross-origin-opener-policy",severity: "medium", description: "Isolates browsing context — protects against Spectre-style attacks." },
  { name: "Cross-Origin-Resource-Policy", key: "cross-origin-resource-policy", severity: "low", description: "Controls which origins can load this resource." },
];

export function getSecurityTools(): SecurityTool[] {
  return [

    // ── headers_audit ────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "headers_audit",
          description: "Audit the HTTP security headers of any website or API. Checks for HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and more. Returns a scored security report with present/missing headers and their severity.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL to audit (e.g. https://viba.guru)" },
            },
            required: ["url"],
          },
        },
      },
      async execute(args) {
        const url = str(args["url"]);
        if (!url.startsWith("http")) return "Error: valid URL required";
        try {
          const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(10_000) });
          const headers = Object.fromEntries([...res.headers.entries()]);

          const present: string[] = [];
          const missing: Array<{ name: string; severity: string; description: string }> = [];

          for (const h of SECURITY_HEADERS) {
            if (headers[h.key]) {
              present.push(`✅ ${h.name}: ${headers[h.key]}`);
            } else {
              missing.push({ name: h.name, severity: h.severity, description: h.description });
            }
          }

          const criticalMissing = missing.filter(m => m.severity === "critical").length;
          const highMissing     = missing.filter(m => m.severity === "high").length;
          const mediumMissing   = missing.filter(m => m.severity === "medium").length;
          const score = Math.max(0, 100 - criticalMissing * 30 - highMissing * 20 - mediumMissing * 10 - missing.filter(m => m.severity === "low").length * 5);

          const lines = [
            `Security Header Audit: ${url}`,
            `HTTP ${res.status} | Score: ${score}/100`,
            "",
            `PRESENT (${present.length}):`,
            ...present,
            "",
            `MISSING (${missing.length}):`,
            ...missing.map(m => `❌ [${m.severity.toUpperCase()}] ${m.name} — ${m.description}`),
          ];

          return lines.join("\n");
        } catch (err) {
          return `Audit failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ── ssl_check ────────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "ssl_check",
          description: "Inspect the TLS/SSL certificate of any domain. Returns certificate validity, expiry date, issuer, subject alternative names, and whether it's trusted. Flags certificates expiring within 30 days.",
          parameters: {
            type: "object",
            properties: {
              hostname: { type: "string", description: "Domain to check (e.g. viba.guru — no https://, no path)" },
              port: { type: "number", description: "Port to connect on (default: 443)" },
            },
            required: ["hostname"],
          },
        },
      },
      async execute(args) {
        const hostname = str(args["hostname"]).replace(/^https?:\/\//, "").split("/")[0] ?? "";
        const port = typeof args["port"] === "number" ? args["port"] : 443;
        if (!hostname) return "Error: hostname is required";

        return new Promise((resolve) => {
          const socket = tls.connect({ host: hostname, port, servername: hostname, rejectUnauthorized: false }, () => {
            try {
              const cert = socket.getPeerCertificate(true);
              socket.destroy();

              if (!cert || !cert.subject) {
                resolve("No certificate found — the host may not support TLS or the connection was refused.");
                return;
              }

              const validFrom = new Date(cert.valid_from);
              const validTo   = new Date(cert.valid_to);
              const now = new Date();
              const daysLeft = Math.floor((validTo.getTime() - now.getTime()) / 86_400_000);
              const isValid = now >= validFrom && now <= validTo;
              const isAuthorized = socket.authorized;

              const san = cert.subjectaltname?.split(", ").map(s => s.replace("DNS:", "")).join(", ") ?? "none";

              const lines = [
                `SSL/TLS Certificate: ${hostname}:${port}`,
                `Status:    ${isValid ? "✅ Valid" : "❌ EXPIRED"} | ${isAuthorized ? "✅ Trusted" : "⚠️ Untrusted/Self-signed"}`,
                `Subject:   ${cert.subject?.CN ?? "unknown"}`,
                `Issuer:    ${cert.issuer?.O ?? "unknown"} (${cert.issuer?.CN ?? "unknown"})`,
                `Valid From:${validFrom.toISOString()}`,
                `Expires:   ${validTo.toISOString()} (${daysLeft >= 0 ? `${daysLeft} days left` : `EXPIRED ${Math.abs(daysLeft)} days ago`})`,
                daysLeft < 30 && daysLeft >= 0 ? `⚠️  WARNING: Certificate expires in ${daysLeft} days — renew soon!` : "",
                `SANs:      ${san}`,
                `Serial:    ${cert.serialNumber ?? "unknown"}`,
              ].filter(Boolean);

              resolve(lines.join("\n"));
            } catch (e) {
              socket.destroy();
              resolve(`Parse error: ${e instanceof Error ? e.message : String(e)}`);
            }
          });
          socket.on("error", (e) => resolve(`Connection error: ${e.message}`));
          socket.setTimeout(10_000, () => { socket.destroy(); resolve("Timeout connecting to host"); });
        });
      },
    },

    // ── cors_check ───────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "cors_check",
          description: "Test the CORS (Cross-Origin Resource Sharing) configuration of an API endpoint. Checks if wildcard origins are allowed, whether credentials are permitted with wildcards (a critical misconfiguration), and what methods/headers are exposed.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "API endpoint URL to test" },
              origin: { type: "string", description: "Origin to simulate in the CORS request (default: https://evil.com)" },
            },
            required: ["url"],
          },
        },
      },
      async execute(args) {
        const url = str(args["url"]);
        const origin = str(args["origin"], "https://evil.com");
        if (!url.startsWith("http")) return "Error: valid URL required";
        try {
          const res = await fetch(url, {
            method: "OPTIONS",
            headers: {
              "Origin": origin,
              "Access-Control-Request-Method": "GET",
              "Access-Control-Request-Headers": "Authorization, Content-Type",
            },
            signal: AbortSignal.timeout(10_000),
          });

          const acao  = res.headers.get("access-control-allow-origin") ?? "not set";
          const acac  = res.headers.get("access-control-allow-credentials") ?? "not set";
          const acam  = res.headers.get("access-control-allow-methods") ?? "not set";
          const acah  = res.headers.get("access-control-allow-headers") ?? "not set";
          const acma  = res.headers.get("access-control-max-age") ?? "not set";

          const wildcardWithCredentials = acao === "*" && acac === "true";
          const wildcardOrigin = acao === "*";
          const reflectsOrigin = acao === origin;

          const issues: string[] = [];
          if (wildcardWithCredentials) issues.push("🚨 CRITICAL: Wildcard origin (*) combined with credentials=true — allows any site to make authenticated requests!");
          if (reflectsOrigin) issues.push("⚠️  HIGH: Server reflects any Origin header — effectively same as wildcard but bypasses some browser checks.");
          if (wildcardOrigin && !wildcardWithCredentials) issues.push("ℹ️  INFO: Wildcard origin — fine for public APIs, but avoid if endpoint serves sensitive data.");

          return [
            `CORS Check: ${url}`,
            `Test Origin: ${origin} | HTTP ${res.status}`,
            "",
            `Access-Control-Allow-Origin:       ${acao}`,
            `Access-Control-Allow-Credentials:  ${acac}`,
            `Access-Control-Allow-Methods:      ${acam}`,
            `Access-Control-Allow-Headers:      ${acah}`,
            `Access-Control-Max-Age:            ${acma}`,
            "",
            issues.length ? `FINDINGS:\n${issues.join("\n")}` : "✅ No obvious CORS misconfigurations detected.",
          ].join("\n");
        } catch (err) {
          return `CORS check failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ── secrets_scan ─────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "secrets_scan",
          description: "Scan code, configuration files, or any text for exposed secrets, API keys, tokens, passwords, and credentials. Uses pattern matching for AWS keys, OpenAI keys, GitHub tokens, Stripe keys, JWTs, private keys, database URLs, and more. Use before committing code or when reviewing a codebase for security issues.",
          parameters: {
            type: "object",
            properties: {
              content: { type: "string", description: "Code or text to scan for secrets" },
              filename: { type: "string", description: "Optional filename for context in the report" },
            },
            required: ["content"],
          },
        },
      },
      async execute(args) {
        const content = str(args["content"]);
        const filename = str(args["filename"], "input");
        if (!content) return "Error: content is required";

        const findings: Array<{ type: string; match: string; line: number }> = [];
        const lines = content.split("\n");

        for (const { name, pattern } of SECRET_PATTERNS) {
          pattern.lastIndex = 0;
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? "";
            const matches = line.match(pattern);
            if (matches) {
              for (const match of matches) {
                const redacted = match.length > 12
                  ? match.slice(0, 6) + "..." + match.slice(-4)
                  : "***";
                findings.push({ type: name, match: redacted, line: i + 1 });
              }
            }
          }
        }

        if (findings.length === 0) return `✅ No secrets detected in ${filename} (${lines.length} lines scanned, ${SECRET_PATTERNS.length} patterns checked).`;

        const report = [
          `🚨 Secrets Scan: ${filename}`,
          `Found ${findings.length} potential secret(s) in ${lines.length} lines:`,
          "",
          ...findings.map(f => `  Line ${f.line}: [${f.type}] ${f.match}`),
          "",
          "ACTION REQUIRED: Rotate any exposed credentials immediately. Remove from code and use environment variables instead.",
        ];
        return report.join("\n");
      },
    },

    // ── password_audit ───────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "password_audit",
          description: "Check if a password has appeared in known data breaches using the HaveIBeenPwned API (k-anonymity — your password is never sent, only the first 5 chars of its SHA1 hash). Also scores password strength.",
          parameters: {
            type: "object",
            properties: {
              password: { type: "string", description: "Password to check (transmitted securely via k-anonymity — only hash prefix is sent to the API)" },
            },
            required: ["password"],
          },
        },
      },
      async execute(args) {
        const password = str(args["password"]);
        if (!password) return "Error: password is required";

        const sha1 = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
        const prefix = sha1.slice(0, 5);
        const suffix = sha1.slice(5);

        // Strength checks
        const strength = {
          length: password.length >= 12,
          upper: /[A-Z]/.test(password),
          lower: /[a-z]/.test(password),
          digit: /[0-9]/.test(password),
          special: /[^A-Za-z0-9]/.test(password),
        };
        const score = Object.values(strength).filter(Boolean).length;
        const strengthLabel = score <= 2 ? "WEAK" : score === 3 ? "FAIR" : score === 4 ? "STRONG" : "VERY STRONG";

        try {
          const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
            headers: { "User-Agent": "VIBA-Security-Agent/1.0", "Add-Padding": "true" },
            signal: AbortSignal.timeout(8_000),
          });

          if (!res.ok) throw new Error(`HIBP returned ${res.status}`);
          const text = await res.text();
          const match = text.split("\n").find(line => line.startsWith(suffix));
          const breachCount = match ? parseInt(match.split(":")[1] ?? "0") : 0;

          return [
            `Password Audit Report`,
            `Strength: ${strengthLabel} (${score}/5)`,
            `  Length ≥12: ${strength.length ? "✅" : "❌"}`,
            `  Uppercase:  ${strength.upper ? "✅" : "❌"}`,
            `  Lowercase:  ${strength.lower ? "✅" : "❌"}`,
            `  Numbers:    ${strength.digit ? "✅" : "❌"}`,
            `  Symbols:    ${strength.special ? "✅" : "❌"}`,
            "",
            breachCount > 0
              ? `🚨 BREACH: This password has appeared in ${breachCount.toLocaleString()} known data breach(es). DO NOT USE IT.`
              : `✅ Not found in any known breaches (checked against HaveIBeenPwned database).`,
          ].join("\n");
        } catch (err) {
          return `HIBP check failed: ${err instanceof Error ? err.message : String(err)}\n\nStrength: ${strengthLabel} (${score}/5)`;
        }
      },
    },

    // ── url_reputation ───────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "url_reputation",
          description: "Check a URL's reputation against URLhaus malware and phishing database. Returns threat classification if the URL is known to be malicious.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL to check for malware/phishing classification" },
            },
            required: ["url"],
          },
        },
      },
      async execute(args) {
        const url = str(args["url"]);
        if (!url.startsWith("http")) return "Error: valid URL required";
        try {
          const res = await fetch("https://urlhaus-api.abuse.ch/v1/url/", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `url=${encodeURIComponent(url)}`,
            signal: AbortSignal.timeout(10_000),
          });
          const data = await res.json() as { query_status: string; url_status?: string; threat?: string; tags?: string[]; blacklists?: Record<string, string> };

          if (data.query_status === "no_results") return `✅ ${url}\nNot found in URLhaus malware database — no known threats detected.`;

          return [
            `URL Reputation: ${url}`,
            `Status:  ${data.url_status ?? "unknown"}`,
            `Threat:  ${data.threat ?? "none"}`,
            `Tags:    ${(data.tags ?? []).join(", ") || "none"}`,
            data.blacklists ? `Blacklists: ${Object.entries(data.blacklists).map(([k, v]) => `${k}=${v}`).join(", ")}` : "",
            data.url_status === "online" ? "\n🚨 WARNING: This URL is currently hosting malware!" : "",
          ].filter(Boolean).join("\n");
        } catch (err) {
          return `Reputation check failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

  ];
}
