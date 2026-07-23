import { test, expect, type Page } from "@playwright/test";
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
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function fixtureForApi(pathname: string, method: string): unknown {
  if (pathname === "/api/auth/me") {
    return { id: 900001, email: "mobile-audit@viba.test", name: "Mobile Audit" };
  }
  if (pathname.includes("billing") || pathname.includes("subscription")) {
    return {
      plan: "pro",
      status: "active",
      credits: 10000,
      balance: 10000,
      currentPeriodEnd: null,
      usage: 0,
      limit: 10000,
    };
  }
  if (pathname.includes("credits")) {
    return { balance: 10000, credits: 10000, remaining: 10000 };
  }
  if (pathname.includes("health")) return { status: "ok" };
  if (pathname.includes("providers")) return { providers: [], saved: [], available: [] };
  if (pathname.includes("sessions")) return { sessions: [], items: [], data: [] };
  if (pathname.includes("projects")) return { projects: [], items: [], data: [] };
  if (pathname.includes("usage")) return { usage: [], history: [], items: [], totals: {} };
  if (pathname.includes("budget")) return { budgets: [], items: [], totals: {} };
  if (pathname.includes("memory")) return { memories: [], items: [], data: [] };
  if (pathname.includes("doctor")) return { reports: [], history: [], findings: [], items: [] };
  if (pathname.includes("audit")) return { audits: [], findings: [], items: [], status: "idle" };
  if (pathname.includes("readiness")) return { checks: [], items: [], score: 0, status: "idle" };
  if (pathname.includes("security")) return { findings: [], events: [], items: [], score: 100 };
  if (pathname.includes("connections") || pathname.includes("credentials")) {
    return { connections: [], credentials: [], items: [], providers: [] };
  }
  if (pathname.includes("seo") || pathname.includes("advertising") || pathname.includes("content") || pathname.includes("outreach")) {
    return { campaigns: [], items: [], data: [], results: [] };
  }
  if (pathname.includes("admin")) return { isAdmin: true, items: [], users: [] };
  if (method !== "GET") return { ok: true, success: true, id: "mobile-audit" };
  return { items: [], data: [], results: [], status: "idle" };
}

async function installApiMocks(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    await route.fulfill(json(fixtureForApi(url.pathname, request.method())));
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
  await page.waitForTimeout(650);
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const rootWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );

    const selectorFor = (element: Element) => {
      const html = element as HTMLElement;
      const id = html.id ? `#${html.id}` : "";
      const role = html.getAttribute("role");
      const name = html.getAttribute("aria-label") || html.getAttribute("name") || "";
      const classes = typeof html.className === "string"
        ? html.className.trim().split(/\s+/).slice(0, 4).join(".")
        : "";
      return `${html.tagName.toLowerCase()}${id}${classes ? `.${classes}` : ""}${role ? `[role=${role}]` : ""}${name ? `[name=${name}]` : ""}`;
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

    const outOfFrame: string[] = [];
    const clippedInteractive: string[] = [];
    const tinyTargets: string[] = [];

    const all = Array.from(document.querySelectorAll("body *"));
    for (const element of all) {
      if (!isVisible(element)) continue;
      const html = element as HTMLElement;
      const rect = html.getBoundingClientRect();
      const style = getComputedStyle(html);
      const interactive = html.matches('button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])');
      const inHorizontalDocumentBand = rect.bottom > 0 && rect.top < Math.max(viewportHeight, document.documentElement.scrollHeight);
      const escapesViewport = rect.left < -1 || rect.right > viewportWidth + 1;

      if (inHorizontalDocumentBand && escapesViewport && !hasHorizontalScrollAncestor(element)) {
        const transformedDecoration = style.pointerEvents === "none" && (style.position === "absolute" || style.position === "fixed");
        if (!transformedDecoration) outOfFrame.push(`${selectorFor(element)} rect=${Math.round(rect.left)},${Math.round(rect.right)}`);
      }

      if (interactive) {
        const horizontallyClipped = rect.left < -1 || rect.right > viewportWidth + 1;
        const verticallyClipped = rect.top < -1 || rect.bottom > viewportHeight + 1;
        if ((horizontallyClipped || verticallyClipped) && style.position === "fixed") {
          clippedInteractive.push(`${selectorFor(element)} rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)}`);
        }
        if (rect.width < 36 || rect.height < 36) {
          const inlineTextLink = html.tagName === "A" && style.display === "inline";
          if (!inlineTextLink) tinyTargets.push(`${selectorFor(element)} size=${Math.round(rect.width)}x${Math.round(rect.height)}`);
        }
      }
    }

    const interactives = all.filter((element) => isVisible(element) && (element as HTMLElement).matches('button, a[href], input, select, textarea, [role="button"], [role="link"]')) as HTMLElement[];
    const overlaps: string[] = [];
    for (let i = 0; i < interactives.length; i += 1) {
      const a = interactives[i];
      const ar = a.getBoundingClientRect();
      if (ar.bottom < 0 || ar.top > viewportHeight || ar.right < 0 || ar.left > viewportWidth) continue;
      for (let j = i + 1; j < interactives.length; j += 1) {
        const b = interactives[j];
        if (a.contains(b) || b.contains(a)) continue;
        const br = b.getBoundingClientRect();
        if (br.bottom < 0 || br.top > viewportHeight || br.right < 0 || br.left > viewportWidth) continue;
        const overlapWidth = Math.max(0, Math.min(ar.right, br.right) - Math.max(ar.left, br.left));
        const overlapHeight = Math.max(0, Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top));
        const overlapArea = overlapWidth * overlapHeight;
        if (overlapArea > 16 && overlapWidth > 3 && overlapHeight > 3) {
          overlaps.push(`${selectorFor(a)} <> ${selectorFor(b)} overlap=${Math.round(overlapWidth)}x${Math.round(overlapHeight)}`);
        }
      }
    }

    const truncatedText: string[] = [];
    for (const element of all) {
      if (!isVisible(element)) continue;
      const html = element as HTMLElement;
      const text = html.innerText?.trim();
      if (!text || text.length < 4 || html.children.length > 0) continue;
      const style = getComputedStyle(html);
      const clippedX = html.scrollWidth > html.clientWidth + 2;
      const clippedY = html.scrollHeight > html.clientHeight + 2;
      const deliberateEllipsis = style.textOverflow === "ellipsis";
      if ((clippedX || clippedY) && !deliberateEllipsis && ["hidden", "clip"].includes(style.overflow)) {
        truncatedText.push(`${selectorFor(element)} text=${text.slice(0, 80)}`);
      }
    }

    return {
      viewportWidth,
      rootWidth,
      horizontalOverflow: Math.max(0, rootWidth - viewportWidth),
      outOfFrame: [...new Set(outOfFrame)].slice(0, 30),
      clippedInteractive: [...new Set(clippedInteractive)].slice(0, 20),
      overlaps: [...new Set(overlaps)].slice(0, 20),
      truncatedText: [...new Set(truncatedText)].slice(0, 20),
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
      test(`${item.route} remains visible`, async ({ page }, testInfo) => {
        if (item.protected) await installApiMocks(page);

        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => pageErrors.push(error.message));

        const response = await page.goto(`${BASE_URL}${item.route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        expect(response, `No response for ${item.route}`).not.toBeNull();
        await stabilise(page);

        const finalPath = new URL(page.url()).pathname;
        if (item.protected && finalPath === "/login") {
          issues.push({
            severity: "error",
            kind: "auth-mock-failed",
            route: item.route,
            viewport: viewport.name,
            details: "Protected route redirected to /login during the local audit.",
          });
        }

        const result = await inspect(page);
        const screenshotPath = join(auditDir, `${viewport.name}__${slug(item.route)}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        if (result.horizontalOverflow > 1) {
          issues.push({ severity: "error", kind: "document-overflow", route: item.route, viewport: viewport.name, details: `${result.horizontalOverflow}px horizontal overflow (document ${result.rootWidth}px, viewport ${result.viewportWidth}px)` });
        }
        for (const detail of result.outOfFrame) issues.push({ severity: "error", kind: "out-of-frame", route: item.route, viewport: viewport.name, details: detail });
        for (const detail of result.clippedInteractive) issues.push({ severity: "error", kind: "clipped-fixed-control", route: item.route, viewport: viewport.name, details: detail });
        for (const detail of result.overlaps) issues.push({ severity: "error", kind: "interactive-overlap", route: item.route, viewport: viewport.name, details: detail });
        for (const detail of result.truncatedText) issues.push({ severity: "warning", kind: "text-clipping", route: item.route, viewport: viewport.name, details: detail });
        for (const detail of result.tinyTargets) issues.push({ severity: "warning", kind: "small-touch-target", route: item.route, viewport: viewport.name, details: detail });
        for (const detail of pageErrors.slice(0, 5)) issues.push({ severity: "error", kind: "page-error", route: item.route, viewport: viewport.name, details: detail });
        for (const detail of consoleErrors.filter((message) => !message.includes("404") && !message.includes("Failed to load resource")).slice(0, 5)) {
          issues.push({ severity: "warning", kind: "console-error", route: item.route, viewport: viewport.name, details: detail });
        }

        await testInfo.attach("mobile-visibility", {
          body: JSON.stringify({ route: item.route, viewport, finalPath, ...result, consoleErrors, pageErrors }, null, 2),
          contentType: "application/json",
        });
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

  const errors = deduped.filter((issue) => issue.severity === "error");
  expect(errors, `Mobile visibility errors:\n${errors.slice(0, 80).map((issue) => `${issue.viewport} ${issue.route} ${issue.kind}: ${issue.details}`).join("\n")}`).toEqual([]);
});
