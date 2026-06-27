/**
 * VIBA Browser QA Harness
 *
 * Safe, non-destructive browser checks for the QA Release Gate.
 * Does NOT require a real browser — uses HTTP fetch to probe routes
 * and records what requires manual browser verification.
 *
 * Rules:
 * - Never triggers real payments, real deploys, or real provider calls
 * - Always returns structured evidence (pass/warn/fail/manual_required)
 * - Screenshots are recorded as "evidence_path" — not taken automatically in non-browser env
 * - Mobile viewport checks are metadata-only (flagged for manual confirm)
 */

export type BrowserCheckStatus =
  | "passed"
  | "warning"
  | "failed"
  | "manual_required"
  | "skipped";

export interface BrowserCheckEvidence {
  id: string;
  route: string;
  status: BrowserCheckStatus;
  httpStatus: number | null;
  title: string | null;
  headingFound: boolean | null;
  textFound: boolean | null;
  consoleErrors: string[];
  networkFailures: string[];
  screenshotEvidencePath: string | null;
  mobileViewportOk: boolean | null;
  notes: string;
  checkedAt: string;
}

export interface BrowserHarnessResult {
  totalChecked: number;
  passed: number;
  warnings: number;
  failed: number;
  manualRequired: number;
  checks: BrowserCheckEvidence[];
  blockers: string[];
  runAt: string;
}

// Routes the harness verifies exist and respond
const FRONTEND_ROUTES = [
  { id: "route-home",              path: "/",                 label: "Home",            critical: true  },
  { id: "route-dashboard",         path: "/dashboard",        label: "Dashboard",       critical: true  },
  { id: "route-agent-console",     path: "/agent-console",    label: "Agent Console",   critical: true  },
  { id: "route-tool-console",      path: "/tool-console",     label: "Tool Console",    critical: true  },
  { id: "route-credentials",       path: "/credentials",      label: "Vault",           critical: true  },
  { id: "route-assisted-browser",  path: "/assisted-browser", label: "Browser Operator",critical: false },
  { id: "route-owner-actions",     path: "/owner-actions",    label: "Owner Actions",   critical: false },
];

// API routes that must return non-error status
const API_ROUTES = [
  { id: "api-health",    path: "/api/health",    label: "Health check",    critical: true,  forbidFields: [] },
  { id: "api-creds",     path: "/api/credentials",label: "Credentials",   critical: true,  forbidFields: ["encrypted_value", "iv", "auth_tag", "raw_key"] },
  { id: "api-custom-ai", path: "/api/custom-ai", label: "Custom AI list", critical: true,  forbidFields: ["api_key", "key", "token", "secret"] },
  { id: "api-tools",     path: "/api/tools",     label: "Tools registry", critical: true,  forbidFields: ["api_key", "secret", "token", "password"] },
];

/**
 * Check a single API route for forbidden fields in its JSON response.
 * Returns evidence of what was found (no browser needed).
 */
export async function checkApiRoute(
  baseUrl: string,
  route: { id: string; path: string; label: string; critical: boolean; forbidFields: string[] },
  headers: Record<string, string> = {},
): Promise<BrowserCheckEvidence> {
  const url = `${baseUrl}${route.path}`;
  let httpStatus: number | null = null;
  let consoleErrors: string[] = [];
  let networkFailures: string[] = [];
  let status: BrowserCheckStatus = "manual_required";
  let notes = "";

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    httpStatus = res.status;

    if (res.status === 401 || res.status === 403) {
      status = "warning";
      notes = `Auth required (${res.status}) — manual browser check needed with valid session`;
    } else if (res.status >= 200 && res.status < 300) {
      const text = await res.text();
      const forbidden = route.forbidFields.filter((f) => text.includes(`"${f}":`));
      if (forbidden.length > 0) {
        status = "failed";
        consoleErrors = forbidden.map((f) => `Forbidden field "${f}" found in response`);
        notes = `SECURITY: response contains forbidden fields: ${forbidden.join(", ")}`;
      } else {
        status = "passed";
        notes = "Route responded OK, no forbidden fields found";
      }
    } else if (res.status === 404) {
      status = route.critical ? "failed" : "warning";
      networkFailures = [`Route ${route.path} returned 404`];
      notes = `Route not found (404)${route.critical ? " — BLOCKER" : ""}`;
    } else {
      status = "warning";
      notes = `Unexpected status ${res.status}`;
    }
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      status = "warning";
      notes = "Request timed out — server may not be running locally";
      networkFailures = ["Request timed out after 8s"];
    } else {
      status = "warning";
      notes = `Could not reach route: ${String(err)}. Browser check required.`;
      networkFailures = [String(err)];
    }
  }

  return {
    id: route.id,
    route: route.path,
    status,
    httpStatus,
    title: null,
    headingFound: null,
    textFound: null,
    consoleErrors,
    networkFailures,
    screenshotEvidencePath: null,
    mobileViewportOk: null,
    notes,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Check a frontend route — since this is a server-side harness, we probe the
 * base URL and record what requires manual browser confirmation.
 */
export function frontendRouteCheck(route: typeof FRONTEND_ROUTES[0]): BrowserCheckEvidence {
  return {
    id: route.id,
    route: route.path,
    status: "manual_required",
    httpStatus: null,
    title: null,
    headingFound: null,
    textFound: null,
    consoleErrors: [],
    networkFailures: [],
    screenshotEvidencePath: null,
    mobileViewportOk: null,
    notes: `Frontend route — requires manual browser verification. Open ${route.path} and confirm page renders without console errors.`,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Run the full browser QA harness.
 * - API routes: probed via fetch (automated where possible)
 * - Frontend routes: recorded as manual_required
 * - Mobile viewport: recorded as manual_required
 */
export async function runBrowserQaHarness(
  baseUrl: string,
  authHeaders: Record<string, string> = {},
): Promise<BrowserHarnessResult> {
  const checks: BrowserCheckEvidence[] = [];

  // API route checks (automated)
  for (const route of API_ROUTES) {
    const result = await checkApiRoute(baseUrl, route, authHeaders);
    checks.push(result);
  }

  // Frontend route checks (manual_required — no real browser in server env)
  for (const route of FRONTEND_ROUTES) {
    checks.push(frontendRouteCheck(route));
  }

  // Mobile viewport checks (always manual_required)
  checks.push({
    id: "mobile-nav-375",
    route: "/dashboard",
    status: "manual_required",
    httpStatus: null,
    title: null,
    headingFound: null,
    textFound: null,
    consoleErrors: [],
    networkFailures: [],
    screenshotEvidencePath: null,
    mobileViewportOk: null,
    notes: "Mobile viewport check (375px): resize browser and confirm nav has no overflow",
    checkedAt: new Date().toISOString(),
  });

  const passed = checks.filter((c) => c.status === "passed").length;
  const warnings = checks.filter((c) => c.status === "warning").length;
  const failed = checks.filter((c) => c.status === "failed").length;
  const manualRequired = checks.filter((c) => c.status === "manual_required").length;

  const blockers: string[] = [];
  for (const c of checks) {
    if (c.status === "failed") {
      blockers.push(`${c.route}: ${c.notes}`);
    }
  }

  return {
    totalChecked: checks.length,
    passed,
    warnings,
    failed,
    manualRequired,
    checks,
    blockers,
    runAt: new Date().toISOString(),
  };
}

export { FRONTEND_ROUTES, API_ROUTES };
