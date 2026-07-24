import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.MOBILE_AUDIT_BASE_URL ?? "http://127.0.0.1:4173";
const RUN_PROTECTED = process.env.MOBILE_AUDIT_PROTECTED !== "false";

const viewports = [
  { name: "iphone-se", width: 320, height: 568 },
  { name: "iphone-13-mini", width: 375, height: 812 },
  { name: "iphone-15", width: 393, height: 852 },
  { name: "iphone-15-pro-max", width: 430, height: 932 },
  { name: "small-tablet", width: 768, height: 1024 },
] as const;

const publicRoutes = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/pricing",
  "/terms",
  "/privacy",
  "/user-instructions",
  "/demo",
  "/demo/doctor-report",
  "/demo/proof-report",
] as const;

const protectedRoutes = [
  "/dashboard",
  "/sessions/new",
  "/settings",
  "/billing",
  "/workbench",
  "/bridge",
  "/providers",
  "/credentials",
  "/agent-console",
  "/tool-console",
  "/doctor",
  "/doctor/history",
  "/owner-actions",
  "/setup-assistant",
  "/connectors",
  "/self-audit",
  "/crews",
  "/production-smoke-test",
  "/mobile-readiness",
  "/team",
  "/usage",
  "/recovery",
  "/doctor/trends",
  "/clients",
  "/security-evidence",
  "/reports/compare",
  "/market-readiness",
  "/assisted-browser",
  "/qa-release-gate",
  "/project-import",
  "/production-ops",
  "/security-center",
  "/domain-setup",
  "/onboarding",
  "/connections",
  "/launch-readiness",
  "/seo",
  "/advertising",
  "/content-creator",
  "/brand-outreach",
  "/render-connector",
  "/ai-optimizer",
  "/ai-savings",
  "/usage-history",
  "/budgets",
  "/project-memory",
  "/app-publisher",
] as const;

type Severity = "error" | "warning";
type AuditIssue = {
  severity: Severity;
  kind: string;
  route: string;
  viewport: string;
  details: string;
};

const issues: AuditIssue[] = [];
const auditDir = join(process.cwd(), "test-results", "mobile-visibility");
mkdirSync(auditDir, { recursive: true });

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

/**
 * Authenticate the browser without a customer account and provide only
 * contract-correct fixtures for endpoints required to render the page shell.
 * Unknown reads return 401 so components must show their normal empty/error
 * state rather than receiving fabricated data with the wrong shape.
 */
async function installApiMocks(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/auth/me") {
      await route.fulfill(json({ id: 900001, email: "mobile-audit@viba.test", name: "Mobile Audit" }));
      return;
    }
    if (path === "/api/auth/logout") {
      await route.fulfill(json({ ok: true }));
      return;
    }
    if (path === "/api/billing/status") {
      await route.fulfill(json({
        subscriptionStatus: "active",
        creditsRemaining: 10000,
        creditsPeriodEnd: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        planKey: "pro",
      }));
      return;
    }
    if (path === "/api/billing/plans") {
      await route.fulfill(json({ creditPacks: [] }));
      return;
    }
    if (path === "/api/billing/auto-topup") {
      await route.fulfill(json({ enabled: false, threshold: 100, packKey: "" }));
      return;
    }
    if (path === "/api/billing/transactions") {
      await route.fulfill(json({ transactions: [] }));
      return;
    }

    if (path === "/api/railway-connector/status") {
      await route.fulfill(json({
        status: {
          apiAvailable: false,
          cliAvailable: false,
          cliVersion: null,
          mcpAvailable: false,
          browserFallbackAvailable: true,
          modeOrder: ["browser"],
          railwayTokenConfigured: false,
        },
      }));
      return;
    }
    if (path === "/api/connectors/status") {
      await route.fulfill(json({ connectors: [], generatedAt: new Date(0).toISOString() }));
      return;
    }
    if (path === "/api/ai/usage/history") {
      await route.fulfill(json({ events: [], total: 0, page: 1, limit: 50 }));
      return;
    }
    if (/\/api\/providers\/[^/]+\/keys$/.test(path)) {
      await route.fulfill(json({ keys: [] }));
      return;
    }
    if (path.includes("/health") || path.endsWith("/status")) {
      await route.fulfill(json({ status: "ok", healthy: true, ready: true }));
      return;
    }
    if (path.startsWith("/api/admin")) {
      await route.fulfill(json({ isAdmin: true, items: [], users: [], data: [] }));
      return;
    }
    if (method !== "GET") {
      await route.fulfill(json({ ok: true, success: true, id: "mobile-audit" }));
      return;
    }

    await route.fulfill(json({ error: "Unavailable in isolated mobile audit" }, 401));
  });
}

async function stabilise(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        scroll-behavior: auto !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.waitForTimeout(1_000);
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const rootWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);

    const selectorFor = (element: Element) => {
      const html = element as HTMLElement;
      const id = html.id ? `#${html.id}` : "";
      const name = html.getAttribute("aria-label") || html.getAttribute("name") || "";
      const classes = typeof html.className === "string"
        ? html.className.trim().split(/\s+/).slice(0, 4).join(".")
        : "";
      return `${html.tagName.toLowerCase()}${id}${classes ? `.${classes}` : ""}${name ? `[name=${name}]` : ""}`;
    };

    const isVisible = (element: Element) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.03) return false;
      if (html.closest('[aria-hidden="true"], [data-state="closed"], [hidden]')) return false;
      return rect.width > 1 && rect.height > 1;
    };

    const hasHorizontalScrollAncestor = (element: Element) => {
      let current: Element | null = element.parentElement;
      while (current && current !== document.documentElement) {
        const style = getComputedStyle(current);
        if (["auto", "scroll"].includes(style.overflowX) && current.scrollWidth > current.clientWidth + 1) return true;
        current = current.parentElement;
      }
      return false;
    };

    const isToastNotification = (element: Element) => {
      let current: Element | null = element;
      while (current && current !== document.body) {
        const html = current as HTMLElement;
        const style = getComputedStyle(html);
        const zIndex = Number.parseInt(style.zIndex, 10);
        if (
          current.matches('[data-radix-toast-viewport], [data-radix-toast-root], [role="status"]') ||
          ((current.tagName === "OL" || current.tagName === "LI") && style.position === "fixed" && Number.isFinite(zIndex) && zIndex >= 90) ||
          (current.tagName === "OL" && html.classList.contains("z-[100]"))
        ) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    };

    const isFieldAdornmentPair = (a: HTMLElement, b: HTMLElement) => {
      const pair = [a, b];
      const field = pair.find((element) => element.matches("input, textarea"));
      const button = pair.find((element) => element.tagName === "BUTTON");
      if (!field || !button || getComputedStyle(button).position !== "absolute") return false;
      return field.parentElement === button.parentElement || field.parentElement?.contains(button) === true;
    };

    const all = Array.from(document.querySelectorAll("body *"));
    const interactives = all.filter((element) => {
      const html = element as HTMLElement;
      return isVisible(element) && html.matches('button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])');
    }) as HTMLElement[];

    const outOfFrame: string[] = [];
    const clippedText: string[] = [];
    const tinyTargets: string[] = [];

    for (const element of all) {
      if (!isVisible(element)) continue;
      const html = element as HTMLElement;
      const rect = html.getBoundingClientRect();
      const style = getComputedStyle(html);
      const interactive = interactives.includes(html);
      const text = html.children.length === 0 ? html.innerText?.trim() : "";
      const meaningfulText = !!text && text.length >= 2 && !html.classList.contains("sr-only");
      const outside = rect.left < -1 || rect.right > viewportWidth + 1;

      if ((interactive || meaningfulText) && outside && !hasHorizontalScrollAncestor(element) && !isToastNotification(element)) {
        outOfFrame.push(`${selectorFor(element)} rect=${Math.round(rect.left)},${Math.round(rect.right)}${text ? ` text=${text.slice(0, 80)}` : ""}`);
      }

      if (meaningfulText) {
        const deliberateEllipsis = style.textOverflow === "ellipsis";
        const clippedX = html.scrollWidth > html.clientWidth + 2;
        const clippedY = html.scrollHeight > html.clientHeight + 2;
        if ((clippedX || clippedY) && !deliberateEllipsis && ["hidden", "clip"].includes(style.overflow)) {
          clippedText.push(`${selectorFor(element)} text=${text.slice(0, 80)}`);
        }
      }

      if (interactive && (rect.width < 36 || rect.height < 36) && !isToastNotification(element)) {
        const inlineTextLink = html.tagName === "A" && style.display === "inline";
        if (!inlineTextLink) tinyTargets.push(`${selectorFor(element)} size=${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }

    const overlaps: string[] = [];
    for (let i = 0; i < interactives.length; i += 1) {
      const a = interactives[i]!;
      const ar = a.getBoundingClientRect();
      if (ar.bottom < 0 || ar.top > viewportHeight || ar.right < 0 || ar.left > viewportWidth) continue;
      for (let j = i + 1; j < interactives.length; j += 1) {
        const b = interactives[j]!;
        if (a.contains(b) || b.contains(a)) continue;
        if (isToastNotification(a) || isToastNotification(b) || isFieldAdornmentPair(a, b)) continue;
        const br = b.getBoundingClientRect();
        if (br.bottom < 0 || br.top > viewportHeight || br.right < 0 || br.left > viewportWidth) continue;
        const width = Math.max(0, Math.min(ar.right, br.right) - Math.max(ar.left, br.left));
        const height = Math.max(0, Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top));
        if (width > 3 && height > 3 && width * height > 16) {
          overlaps.push(`${selectorFor(a)} <> ${selectorFor(b)} overlap=${Math.round(width)}x${Math.round(height)}`);
        }
      }
    }

    return {
      viewportWidth,
      rootWidth,
      horizontalOverflow: Math.max(0, rootWidth - viewportWidth),
      outOfFrame: [...new Set(outOfFrame)].slice(0, 30),
      overlaps: [...new Set(overlaps)].slice(0, 20),
      clippedText: [...new Set(clippedText)].slice(0, 20),
      tinyTargets: [...new Set(tinyTargets)].slice(0, 30),
    };
  });
}

function slug(route: string) {
  return route === "/" ? "home" : route.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-");
}

for (const viewport of viewports) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    const routes = RUN_PROTECTED
      ? [...publicRoutes.map((route) => ({ route, protected: false })), ...protectedRoutes.map((route) => ({ route, protected: true }))]
      : publicRoutes.map((route) => ({ route, protected: false }));

    for (const item of routes) {
      test(`${item.route} remains visible`, async ({ page }) => {
        if (item.protected) await installApiMocks(page);

        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        const response = await page.goto(`${BASE_URL}${item.route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        expect(response, `No response for ${item.route}`).not.toBeNull();
        await stabilise(page);

        const finalPath = new URL(page.url()).pathname;
        const screenshotPath = join(auditDir, `${viewport.name}__${slug(item.route)}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await page.waitForTimeout(250);
        const result = await inspect(page);
        const boundaryCount = await page.locator("h2").filter({ hasText: /Something went wrong/i }).count();

        const blocking: string[] = [];
        if (item.protected && finalPath === "/login") blocking.push("Protected route redirected to /login.");
        if (boundaryCount > 0) blocking.push("VIBA application error boundary is visible.");
        if (result.horizontalOverflow > 1) blocking.push(`${result.horizontalOverflow}px horizontal document overflow.`);
        blocking.push(...result.outOfFrame.map((detail) => `Out of frame: ${detail}`));
        blocking.push(...result.overlaps.map((detail) => `Interactive overlap: ${detail}`));
        blocking.push(...pageErrors.slice(0, 5).map((detail) => `Page error: ${detail}`));

        for (const detail of blocking) {
          issues.push({ severity: "error", kind: "blocking", route: item.route, viewport: viewport.name, details: detail });
        }
        for (const detail of result.clippedText) issues.push({ severity: "warning", kind: "text-clipping", route: item.route, viewport: viewport.name, details: detail });
        for (const detail of result.tinyTargets) issues.push({ severity: "warning", kind: "small-touch-target", route: item.route, viewport: viewport.name, details: detail });

        expect(blocking, `${viewport.name} ${item.route} visibility failures:\n${blocking.join("\n")}`).toEqual([]);
      });
    }
  });
}

test.afterAll(async () => {
  const deduped = [...new Map(issues.map((issue) => [`${issue.severity}|${issue.kind}|${issue.route}|${issue.viewport}|${issue.details}`, issue])).values()];
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    viewports,
    publicRoutes,
    protectedRoutes: RUN_PROTECTED ? protectedRoutes : [],
    summary: {
      errors: deduped.filter((issue) => issue.severity === "error").length,
      warnings: deduped.filter((issue) => issue.severity === "warning").length,
      total: deduped.length,
    },
    issues: deduped,
  };
  writeFileSync(join(auditDir, "report.json"), JSON.stringify(report, null, 2));
});
