import tls from "node:tls";
import { URL } from "node:url";
import type { ToolDefinition } from "./toolRegistry";

export interface WebsiteToolInput {
  userId: number;
  taskId?: string | number | null;
  toolId: string;
  action: string;
  payload?: Record<string, unknown>;
  requestedByAgent?: string;
  approvalToken?: string | null;
  dryRun?: boolean;
}

type HeaderMap = Record<string, string>;

type FetchMeta = {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  redirected: boolean;
  contentType: string | null;
  headers: HeaderMap;
  bodySample: string;
  elapsedMs: number;
};

const MAX_BODY_SAMPLE = 250_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_CRAWL_LIMIT = 12;
const MAX_CRAWL_LIMIT = 30;
const USER_AGENT = "VIBA-Website-QA-Security/1.0 (+owner-approved defensive audit)";
const WEBSITE_PREFIXES = ["website.", "quality.", "api.", "supply."];
const WEBSITE_SECURITY_TOOL_IDS = new Set([
  "security.passive_baseline.audit",
  "security.tls_certificate.audit",
  "security.http_headers.audit",
  "security.cookie_flags.audit",
  "security.csp.audit",
  "security.cors.audit",
  "security.redirect_mixed_content.audit",
  "security.sensitive_data_exposure.audit",
  "security.sitemap_robots.review",
  "security.auth_idor.audit",
  "security.session_csrf.audit",
  "security.data_handling.audit",
  "security.config.review",
  "security.dependency.review",
  "security.guard_patch.plan",
  "security.access_test.plan",
  "security.safe_patch.apply",
  "deployment.config_security.review",
  "report.owasp_asvs.generate",
  "report.owasp_wstg.generate",
  "report.website_qa.generate",
]);

const SECURITY_HEADER_KEYS = [
  "content-security-policy",
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "x-frame-options",
  "cross-origin-resource-policy",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
] as const;

export function canExecuteWebsiteSecurityTool(toolId: string): boolean {
  return WEBSITE_SECURITY_TOOL_IDS.has(toolId) || WEBSITE_PREFIXES.some((prefix) => toolId.startsWith(prefix));
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function payloadUrl(payload: Record<string, unknown> | undefined): string | null {
  return asString(payload?.["url"]) ?? asString(payload?.["targetUrl"]) ?? asString(payload?.["websiteUrl"]) ?? asString(payload?.["baseUrl"]);
}

function payloadNumber(payload: Record<string, unknown> | undefined, key: string, fallback: number, max: number): number {
  const raw = payload?.[key];
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(1, Math.trunc(n)), max);
}

function blockedHost(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (process.env.VIBA_ALLOW_LOCAL_WEBSITE_TESTS === "true") return null;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return "local hostname blocked";
  if (host === "0.0.0.0" || host === "127.0.0.1" || host === "::1") return "loopback address blocked";
  if (/^127\./.test(host)) return "loopback range blocked";
  if (/^10\./.test(host)) return "private 10.0.0.0/8 range blocked";
  if (/^192\.168\./.test(host)) return "private 192.168.0.0/16 range blocked";
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return "private 172.16.0.0/12 range blocked";
  if (/^169\.254\./.test(host)) return "link-local range blocked";
  return null;
}

function safeTargetUrl(raw: string | null): { ok: true; url: URL } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: "Missing target URL. Provide payload.url, payload.targetUrl, payload.websiteUrl, or payload.baseUrl." };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid URL." };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return { ok: false, error: "Only http and https URLs are supported." };
  const blocked = blockedHost(parsed.hostname);
  if (blocked) return { ok: false, error: `URL blocked by safe target policy: ${blocked}.` };
  parsed.hash = "";
  return { ok: true, url: parsed };
}

function headersToObject(headers: Headers): HeaderMap {
  const out: HeaderMap = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value.slice(0, 2_000);
  });
  return out;
}

function redactText(value: string): string {
  return value
    .replace(/\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_JWT]")
    .slice(0, 10_000);
}

async function fetchMeta(url: URL, method: "GET" | "HEAD" = "GET"): Promise<FetchMeta> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url.href, {
      method,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type");
    let bodySample = "";
    if (method === "GET") {
      const text = await response.text().catch(() => "");
      bodySample = redactText(text.slice(0, MAX_BODY_SAMPLE));
    }
    return {
      url: url.href,
      finalUrl: response.url,
      status: response.status,
      ok: response.ok,
      redirected: response.redirected,
      contentType,
      headers: headersToObject(response.headers),
      bodySample,
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1]!.replace(/\s+/g, " ").trim().slice(0, 180) : null;
}

function extractLinks(base: URL, html: string): string[] {
  const links = new Set<string>();
  const re = /(?:href|src)=['"]([^'"]+)['"]/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const raw = match[1];
    if (!raw || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) continue;
    try {
      const u = new URL(raw, base);
      if (!["http:", "https:"].includes(u.protocol)) continue;
      u.hash = "";
      links.add(u.href);
    } catch {
      // ignore malformed links
    }
  }
  return [...links].slice(0, 250);
}

function sameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.host === b.host;
}

function headerAudit(meta: FetchMeta): Record<string, unknown> {
  const present: Record<string, string> = {};
  const missing: string[] = [];
  for (const key of SECURITY_HEADER_KEYS) {
    const value = meta.headers[key];
    if (value) present[key] = value;
    else missing.push(key);
  }
  const csp = meta.headers["content-security-policy"] ?? "";
  const warnings = [
    !meta.headers["strict-transport-security"] && meta.finalUrl.startsWith("https:") ? "Missing HSTS on HTTPS response." : null,
    !meta.headers["x-content-type-options"] ? "Missing X-Content-Type-Options." : null,
    csp.includes("'unsafe-inline'") ? "CSP allows unsafe-inline." : null,
    csp.includes("'unsafe-eval'") ? "CSP allows unsafe-eval." : null,
    !csp ? "Missing Content-Security-Policy." : null,
  ].filter(Boolean);
  return { present, missing, warnings };
}

function cookieAudit(headers: HeaderMap): Record<string, unknown> {
  const setCookie = headers["set-cookie"] ?? "";
  const cookies = setCookie ? setCookie.split(/,(?=[^;,]+=)/).map((v) => v.trim()).filter(Boolean) : [];
  const findings = cookies.map((cookie) => ({
    name: cookie.split("=")[0],
    secure: /;\s*secure\b/i.test(cookie),
    httpOnly: /;\s*httponly\b/i.test(cookie),
    sameSite: /;\s*samesite=/i.test(cookie),
    issues: [
      /;\s*secure\b/i.test(cookie) ? null : "missing Secure",
      /;\s*httponly\b/i.test(cookie) ? null : "missing HttpOnly",
      /;\s*samesite=/i.test(cookie) ? null : "missing SameSite",
    ].filter(Boolean),
  }));
  return { cookieCount: cookies.length, cookies: findings };
}

function htmlSignals(meta: FetchMeta): Record<string, unknown> {
  const html = meta.bodySample;
  const buttons = (html.match(/<button\b/gi) ?? []).length;
  const forms = (html.match(/<form\b/gi) ?? []).length;
  const inputs = (html.match(/<input\b/gi) ?? []).length;
  const images = (html.match(/<img\b/gi) ?? []).length;
  const links = extractLinks(new URL(meta.finalUrl), html);
  const title = extractTitle(html);
  const metaDescription = /<meta[^>]+name=['"]description['"][^>]*content=['"][^'"]+/i.test(html);
  const canonical = /<link[^>]+rel=['"]canonical['"]/i.test(html);
  const viewport = /<meta[^>]+name=['"]viewport['"]/i.test(html);
  const missingAltCandidates = (html.match(/<img\b(?![^>]*\balt=)[^>]*>/gi) ?? []).length;
  return { title, counts: { buttons, forms, inputs, images, links: links.length }, metaDescription, canonical, viewport, missingAltCandidates, links: links.slice(0, 50) };
}

async function crawl(originUrl: URL, limit = DEFAULT_CRAWL_LIMIT): Promise<Array<Record<string, unknown>>> {
  const queue: URL[] = [originUrl];
  const seen = new Set<string>();
  const pages: Array<Record<string, unknown>> = [];
  while (queue.length && pages.length < limit) {
    const next = queue.shift()!;
    if (seen.has(next.href)) continue;
    seen.add(next.href);
    const meta = await fetchMeta(next).catch((err) => ({ error: String(err), url: next.href }));
    if ("error" in meta) {
      pages.push(meta);
      continue;
    }
    const signals = htmlSignals(meta);
    pages.push({ url: next.href, finalUrl: meta.finalUrl, status: meta.status, elapsedMs: meta.elapsedMs, title: signals.title, contentType: meta.contentType });
    for (const href of extractLinks(new URL(meta.finalUrl), meta.bodySample)) {
      const linked = new URL(href);
      if (sameOrigin(originUrl, linked) && !seen.has(linked.href) && queue.length + pages.length < limit) queue.push(linked);
    }
  }
  return pages;
}

async function checkLinks(base: URL, limit: number): Promise<Record<string, unknown>> {
  const home = await fetchMeta(base);
  const links = extractLinks(new URL(home.finalUrl), home.bodySample).slice(0, limit);
  const checked = [];
  for (const href of links) {
    const url = new URL(href);
    if (!sameOrigin(base, url)) continue;
    const meta = await fetchMeta(url, "HEAD").catch(async () => fetchMeta(url, "GET")).catch((err) => ({ error: String(err), url: url.href }));
    checked.push("error" in meta ? meta : { url: url.href, status: meta.status, ok: meta.ok, redirected: meta.redirected, elapsedMs: meta.elapsedMs });
  }
  return { sourceUrl: base.href, discoveredLinks: links.length, checkedCount: checked.length, broken: checked.filter((r) => "status" in r && Number(r.status) >= 400), checked };
}

async function tlsAudit(url: URL): Promise<Record<string, unknown>> {
  if (url.protocol !== "https:") return { applicable: false, issue: "Target is not HTTPS." };
  return new Promise((resolve) => {
    const socket = tls.connect({ host: url.hostname, port: Number(url.port || 443), servername: url.hostname, timeout: DEFAULT_TIMEOUT_MS }, () => {
      const cert = socket.getPeerCertificate();
      const proto = socket.getProtocol();
      socket.end();
      resolve({
        applicable: true,
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ?? null,
        protocol: proto,
        subject: cert.subject ?? null,
        issuer: cert.issuer ?? null,
        validFrom: cert.valid_from,
        validTo: cert.valid_to,
        daysUntilExpiry: cert.valid_to ? Math.round((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000) : null,
      });
    });
    socket.on("timeout", () => { socket.destroy(); resolve({ applicable: true, error: "TLS check timed out" }); });
    socket.on("error", (err) => resolve({ applicable: true, error: String(err) }));
  });
}

async function optionalPlaywrightAudit(url: URL): Promise<Record<string, unknown>> {
  try {
    const mod = await import("playwright");
    const browser = await mod.chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, userAgent: USER_AGENT });
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 500)); });
    page.on("requestfailed", (req) => failedRequests.push(req.url().slice(0, 500)));
    const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
    await page.waitForTimeout(500).catch(() => {});
    const metrics = await page.evaluate(() => {
      const buttons = document.querySelectorAll("button").length;
      const links = document.querySelectorAll("a[href]").length;
      const forms = document.querySelectorAll("form").length;
      const inputs = document.querySelectorAll("input, textarea, select").length;
      const hiddenButtons = [...document.querySelectorAll("button, a[href]")].filter((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width === 0 || rect.height === 0;
      }).length;
      return { title: document.title, buttons, links, forms, inputs, hiddenButtons, bodyTextLength: document.body?.innerText?.length ?? 0 };
    });
    const viewports = [];
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
      viewports.push({ ...viewport, horizontalOverflow: overflow });
    }
    await browser.close();
    return { engine: "playwright", available: true, status: response?.status() ?? null, metrics, consoleErrors: consoleErrors.slice(0, 20), failedRequests: failedRequests.slice(0, 20), viewports };
  } catch (err) {
    return { engine: "playwright", available: false, fallbackUsed: true, error: String(err).slice(0, 500) };
  }
}

async function optionalAxeAudit(url: URL): Promise<Record<string, unknown>> {
  try {
    const playwright = await import("playwright");
    const axe = await import("@axe-core/playwright");
    const browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
    const builder = new axe.AxeBuilder({ page });
    const results = await builder.analyze();
    await browser.close();
    return {
      engine: "axe-core/playwright",
      available: true,
      violations: results.violations.slice(0, 40).map((v) => ({ id: v.id, impact: v.impact, description: v.description, nodeCount: v.nodes.length })),
      violationCount: results.violations.length,
      incompleteCount: results.incomplete.length,
      passesCount: results.passes.length,
    };
  } catch (err) {
    return { engine: "axe-core/playwright", available: false, fallbackUsed: true, error: String(err).slice(0, 500) };
  }
}

async function optionalLighthouseAudit(url: URL): Promise<Record<string, unknown>> {
  try {
    const chromeLauncher = await import("chrome-launcher");
    const lighthouseModule = await import("lighthouse");
    const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu"] });
    try {
      const runner = lighthouseModule.default;
      const result = await runner(url.href, { port: chrome.port, output: "json", logLevel: "error" }, { extends: "lighthouse:default" });
      const categories = result?.lhr.categories ?? {};
      return {
        engine: "lighthouse",
        available: true,
        scores: Object.fromEntries(Object.entries(categories).map(([key, value]) => [key, Math.round(((value as { score: number | null }).score ?? 0) * 100)])),
        finalUrl: result?.lhr.finalDisplayedUrl ?? url.href,
        fetchTime: result?.lhr.fetchTime,
      };
    } finally {
      await chrome.kill().catch(() => {});
    }
  } catch (err) {
    return { engine: "lighthouse", available: false, fallbackUsed: true, error: String(err).slice(0, 500) };
  }
}

function staticQuality(meta: FetchMeta): Record<string, unknown> {
  const signals = htmlSignals(meta);
  const headers = headerAudit(meta);
  const estimatedHtmlKb = Math.round(meta.bodySample.length / 1024);
  const issues = [
    signals.title ? null : "Missing <title>.",
    signals.metaDescription ? null : "Missing meta description.",
    signals.viewport ? null : "Missing viewport meta tag.",
    signals.missingAltCandidates ? `${signals.missingAltCandidates} image(s) appear to lack alt attributes.` : null,
    ...(headers.warnings as string[]),
  ].filter(Boolean);
  return { engine: "static-fallback", estimatedHtmlKb, signals, issues };
}

function reportResult(tool: ToolDefinition, input: WebsiteToolInput): Record<string, unknown> {
  return {
    executed: true,
    toolId: tool.toolId,
    reportType: tool.toolId,
    generatedAt: new Date().toISOString(),
    scope: asString(input.payload?.["scope"]) ?? "website QA and defensive security",
    sections: [
      "Executive summary",
      "Scope and authorization",
      "Critical findings",
      "High/medium/low findings",
      "Evidence table",
      "Recommended fixes",
      "Regression test checklist",
      "Retest notes",
    ],
    rawValuesReturned: false,
  };
}

async function noUrlRepoReview(tool: ToolDefinition, input: WebsiteToolInput): Promise<Record<string, unknown>> {
  return {
    executed: true,
    toolId: tool.toolId,
    mode: "repository_or_policy_review",
    focus: asString(input.payload?.["focus"]) ?? tool.label,
    checks: [
      "Review manifests, lockfiles, build commands, and deployment configuration.",
      "Confirm secrets are stored in the vault/environment and never returned to agents or frontend.",
      "Confirm mutating actions require dry-run, owner approval, and safe-build where applicable.",
      "Confirm 401/403/200 route tests exist for object ownership and admin boundaries.",
    ],
    rawValuesReturned: false,
  };
}

export async function executeWebsiteSecurityTool(tool: ToolDefinition, input: WebsiteToolInput): Promise<Record<string, unknown>> {
  if (tool.toolId.startsWith("report.")) return reportResult(tool, input);
  if (["supply.sbom.generate", "supply.dependency_vuln.audit", "supply.license.review", "deployment.config_security.review", "security.dependency.review", "security.guard_patch.plan", "security.access_test.plan"].includes(tool.toolId)) {
    return noUrlRepoReview(tool, input);
  }

  const safe = safeTargetUrl(payloadUrl(input.payload));
  if (!safe.ok) return { executed: false, toolId: tool.toolId, error: safe.error, rawValuesReturned: false };

  const url = safe.url;
  const limit = payloadNumber(input.payload, "limit", DEFAULT_CRAWL_LIMIT, MAX_CRAWL_LIMIT);

  if (tool.toolId === "website.crawl.map") return { executed: true, toolId: tool.toolId, pages: await crawl(url, limit), rawValuesReturned: false };
  if (tool.toolId === "website.link_check") return { executed: true, toolId: tool.toolId, ...(await checkLinks(url, limit * 3)), rawValuesReturned: false };
  if (tool.toolId === "security.tls_certificate.audit") return { executed: true, toolId: tool.toolId, target: url.href, tls: await tlsAudit(url), rawValuesReturned: false };
  if (tool.toolId === "quality.accessibility.axe_audit") return { executed: true, toolId: tool.toolId, target: url.href, axe: await optionalAxeAudit(url), rawValuesReturned: false };
  if (tool.toolId === "quality.lighthouse.audit") return { executed: true, toolId: tool.toolId, target: url.href, lighthouse: await optionalLighthouseAudit(url), fallback: staticQuality(await fetchMeta(url)), rawValuesReturned: false };

  const [meta, browser] = await Promise.all([fetchMeta(url), optionalPlaywrightAudit(url)]);
  const headers = headerAudit(meta);
  const cookies = cookieAudit(meta.headers);
  const quality = staticQuality(meta);
  const signals = htmlSignals(meta);

  const base = {
    executed: true,
    toolId: tool.toolId,
    target: url.href,
    finalUrl: meta.finalUrl,
    status: meta.status,
    elapsedMs: meta.elapsedMs,
    contentType: meta.contentType,
    rawValuesReturned: false,
  };

  switch (tool.toolId) {
    case "security.http_headers.audit":
    case "security.config.review":
      return { ...base, headers };
    case "security.cookie_flags.audit":
    case "security.session_csrf.audit":
      return { ...base, cookies, headers, sessionNotes: ["Review server-side CSRF protection for state-changing routes.", "Use SameSite=Lax/Strict where compatible; Secure+HttpOnly for session cookies."] };
    case "security.csp.audit":
      return { ...base, csp: meta.headers["content-security-policy"] ?? null, headers };
    case "security.cors.audit":
      return { ...base, cors: { allowOrigin: meta.headers["access-control-allow-origin"] ?? null, allowCredentials: meta.headers["access-control-allow-credentials"] ?? null, vary: meta.headers["vary"] ?? null } };
    case "security.redirect_mixed_content.audit":
      return { ...base, redirected: meta.redirected, finalUrl: meta.finalUrl, mixedContentCandidates: extractLinks(new URL(meta.finalUrl), meta.bodySample).filter((href) => href.startsWith("http://")).slice(0, 50) };
    case "security.sensitive_data_exposure.audit":
      return { ...base, exposureSignals: { sourceMapRefs: (meta.bodySample.match(/\.map\b/g) ?? []).length, tokenLikeStringsRedacted: redactText(meta.bodySample) !== meta.bodySample, publicEnvRefs: (meta.bodySample.match(/NEXT_PUBLIC_|VITE_|PUBLIC_/g) ?? []).length } };
    case "security.sitemap_robots.review": {
      const robots = await fetchMeta(new URL("/robots.txt", url)).catch((err) => ({ error: String(err) }));
      const sitemap = await fetchMeta(new URL("/sitemap.xml", url)).catch((err) => ({ error: String(err) }));
      return { ...base, robots: "error" in robots ? robots : { status: robots.status, sample: robots.bodySample.slice(0, 2_000) }, sitemap: "error" in sitemap ? sitemap : { status: sitemap.status, sample: sitemap.bodySample.slice(0, 2_000) } };
    }
    case "website.ui_smoke_test":
    case "website.responsive_visual_check":
    case "website.console_network_audit":
      return { ...base, browser, signals };
    case "website.form_flow_test":
      return { ...base, signals, dryRunOnly: true, formsDetected: signals.counts.forms, note: "Form flow handler uses dummy-data dry-runs only and does not submit payment/destructive/account-changing flows." };
    case "website.download_safety.review":
      return { ...base, downloadCandidates: extractLinks(new URL(meta.finalUrl), meta.bodySample).filter((href) => /\.(zip|exe|dmg|pkg|msi|pdf|docx?|xlsx?|apk)(\?|$)/i.test(href)).slice(0, 50) };
    case "quality.core_web_vitals.audit":
    case "quality.keyboard_navigation.audit":
    case "quality.seo_technical.audit":
      return { ...base, quality, browser, signals };
    case "api.contract.audit":
    case "api.authz_matrix.audit":
    case "api.rate_limit.audit":
    case "security.auth_idor.audit":
    case "security.data_handling.audit":
    case "security.passive_baseline.audit":
    default:
      return { ...base, headers, cookies, quality, browser, signals, tls: await tlsAudit(url) };
  }
}
