/**
 * VIBA Smoke Test Tools
 *
 * smoke_test       — single endpoint health check: hits a URL, checks status + body + response time
 * smoke_test_suite — run a batch of smoke tests in parallel, return a structured pass/fail report
 * smoke_test_page  — load a URL and verify DOM elements / text are present in the response
 */

export interface SmokeTestTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }
function num(v: unknown, fb: number): number { return typeof v === "number" ? v : fb; }

interface SmokeResult {
  name: string;
  url: string;
  pass: boolean;
  statusCode: number | null;
  responseTimeMs: number;
  failReason: string | null;
  bodyPreview: string;
}

async function runSingleTest(opts: {
  name: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  expectedStatus?: number;
  responseContains?: string;
  responseNotContains?: string;
  maxResponseTimeMs?: number;
  timeoutMs?: number;
}): Promise<SmokeResult> {
  const method = (opts.method ?? "GET").toUpperCase();
  const timeout = opts.timeoutMs ?? 15_000;
  const maxRt   = opts.maxResponseTimeMs ?? 5_000;
  const start   = Date.now();

  try {
    const res = await fetch(opts.url, {
      method,
      headers: opts.headers ?? {},
      body: ["GET", "HEAD"].includes(method) ? undefined : (opts.body ?? undefined),
      signal: AbortSignal.timeout(timeout),
      redirect: "follow",
    });

    const responseTimeMs = Date.now() - start;
    const bodyText = method !== "HEAD" ? (await res.text()).slice(0, 2000) : "";

    const failures: string[] = [];

    // Status check
    const expectedStatus = opts.expectedStatus ?? 200;
    if (res.status !== expectedStatus) failures.push(`Expected HTTP ${expectedStatus}, got ${res.status}`);

    // Body checks
    if (opts.responseContains && !bodyText.includes(opts.responseContains)) {
      failures.push(`Expected body to contain "${opts.responseContains}"`);
    }
    if (opts.responseNotContains && bodyText.includes(opts.responseNotContains)) {
      failures.push(`Body must NOT contain "${opts.responseNotContains}"`);
    }

    // Response time check
    if (responseTimeMs > maxRt) failures.push(`Response time ${responseTimeMs}ms exceeds ${maxRt}ms limit`);

    return {
      name: opts.name,
      url: opts.url,
      pass: failures.length === 0,
      statusCode: res.status,
      responseTimeMs,
      failReason: failures.length ? failures.join("; ") : null,
      bodyPreview: bodyText.slice(0, 300),
    };
  } catch (err) {
    return {
      name: opts.name,
      url: opts.url,
      pass: false,
      statusCode: null,
      responseTimeMs: Date.now() - start,
      failReason: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      bodyPreview: "",
    };
  }
}

function formatResult(r: SmokeResult): string {
  const icon = r.pass ? "✅" : "❌";
  const time = `${r.responseTimeMs}ms`;
  const status = r.statusCode !== null ? `HTTP ${r.statusCode}` : "no response";
  const base = `${icon} ${r.name} | ${status} | ${time}`;
  return r.pass ? base : `${base}\n   Reason: ${r.failReason}`;
}

export function getSmokeTestTools(): SmokeTestTool[] {
  return [

    // ── smoke_test ────────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "smoke_test",
          description: "Run a single smoke test against an HTTP endpoint. Checks status code, optional response body content, and response time. Use after deployments to verify services are up, or to monitor API health.",
          parameters: {
            type: "object",
            properties: {
              url:                  { type: "string",  description: "URL to test" },
              method:               { type: "string",  enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"], description: "HTTP method (default: GET)" },
              headers:              { type: "object",  description: "Request headers as key-value pairs" },
              body:                 { type: "string",  description: "Request body (for POST/PUT/PATCH)" },
              expected_status:      { type: "number",  description: "Expected HTTP status code (default: 200)" },
              response_contains:    { type: "string",  description: "String that must appear in the response body" },
              response_not_contains:{ type: "string",  description: "String that must NOT appear in the response body" },
              max_response_time_ms: { type: "number",  description: "Max acceptable response time in ms (default: 5000)" },
              timeout_ms:           { type: "number",  description: "Request timeout in ms (default: 15000)" },
            },
            required: ["url"],
          },
        },
      },
      async execute(args) {
        const url = str(args["url"]);
        if (!url.startsWith("http")) return "Error: valid URL required (must start with http/https)";
        const result = await runSingleTest({
          name: url,
          url,
          method: str(args["method"], "GET"),
          headers: (typeof args["headers"] === "object" && args["headers"] !== null) ? args["headers"] as Record<string, string> : {},
          body: str(args["body"]) || undefined,
          expectedStatus: typeof args["expected_status"] === "number" ? args["expected_status"] : 200,
          responseContains: str(args["response_contains"]) || undefined,
          responseNotContains: str(args["response_not_contains"]) || undefined,
          maxResponseTimeMs: typeof args["max_response_time_ms"] === "number" ? args["max_response_time_ms"] : 5_000,
          timeoutMs: typeof args["timeout_ms"] === "number" ? args["timeout_ms"] : 15_000,
        });

        return [
          `Smoke Test: ${url}`,
          result.pass ? "✅ PASSED" : "❌ FAILED",
          `Status:        ${result.statusCode !== null ? `HTTP ${result.statusCode}` : "no response"}`,
          `Response time: ${result.responseTimeMs}ms`,
          result.failReason ? `Failure:       ${result.failReason}` : "",
          result.bodyPreview ? `\nBody preview:\n${result.bodyPreview}` : "",
        ].filter(Boolean).join("\n");
      },
    },

    // ── smoke_test_suite ──────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "smoke_test_suite",
          description: "Run a batch of smoke tests in parallel and get a single pass/fail summary report. Ideal for post-deployment verification, checking multiple API endpoints, or monitoring a service checklist. Each test can have its own method, headers, expected status, and body assertions.",
          parameters: {
            type: "object",
            properties: {
              tests: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name:                  { type: "string", description: "Human-readable test name" },
                    url:                   { type: "string", description: "URL to test" },
                    method:                { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] },
                    headers:               { type: "object" },
                    body:                  { type: "string" },
                    expected_status:       { type: "number" },
                    response_contains:     { type: "string" },
                    response_not_contains: { type: "string" },
                    max_response_time_ms:  { type: "number" },
                  },
                  required: ["name", "url"],
                },
                description: "List of smoke tests to run in parallel",
              },
              fail_fast: { type: "boolean", description: "Stop after first failure (default: false — run all tests)" },
            },
            required: ["tests"],
          },
        },
      },
      async execute(args) {
        if (!Array.isArray(args["tests"]) || args["tests"].length === 0) return "Error: tests array is required";
        const tests = (args["tests"] as Array<{
          name: string; url: string; method?: string; headers?: Record<string, string>;
          body?: string; expected_status?: number; response_contains?: string;
          response_not_contains?: string; max_response_time_ms?: number;
        }>).slice(0, 50);

        const start = Date.now();
        const results = await Promise.all(tests.map(t => runSingleTest({
          name: t.name,
          url: t.url,
          method: t.method ?? "GET",
          headers: t.headers ?? {},
          body: t.body,
          expectedStatus: t.expected_status ?? 200,
          responseContains: t.response_contains,
          responseNotContains: t.response_not_contains,
          maxResponseTimeMs: t.max_response_time_ms ?? 5_000,
        })));

        const passed = results.filter(r => r.pass).length;
        const failed = results.length - passed;
        const totalTime = Date.now() - start;
        const avgTime = Math.round(results.reduce((s, r) => s + r.responseTimeMs, 0) / results.length);

        const lines = [
          `Smoke Test Suite: ${results.length} tests | ${passed} passed | ${failed} failed | ${totalTime}ms total | ${avgTime}ms avg`,
          failed === 0 ? "✅ ALL TESTS PASSED" : `❌ ${failed} TEST(S) FAILED`,
          "",
          "─── Results ───────────────────────────────────────",
          ...results.map(formatResult),
        ];

        if (failed > 0) {
          lines.push("", "─── Failed Tests ──────────────────────────────────");
          for (const r of results.filter(r => !r.pass)) {
            lines.push(`  ${r.name}`);
            lines.push(`    URL:    ${r.url}`);
            lines.push(`    Reason: ${r.failReason}`);
          }
        }
        return lines.join("\n");
      },
    },

    // ── smoke_test_page ───────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "smoke_test_page",
          description: "Load a web page and verify that specific text, HTML elements, or content is present (or absent) in the response. Use to verify that a deployed page has rendered correctly — e.g. title, key headings, navigation links, or that error messages are NOT present.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "Page URL to load" },
              checks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type:    { type: "string", enum: ["contains", "not_contains", "contains_tag"], description: "Check type: 'contains' = text present, 'not_contains' = text absent, 'contains_tag' = HTML tag present" },
                    value:   { type: "string", description: "Text or tag name to check for (e.g. 'Welcome', 'nav', 'footer')" },
                    label:   { type: "string", description: "Human-readable label for this check" },
                  },
                  required: ["type", "value"],
                },
                description: "List of checks to perform on the loaded page",
              },
              timeout_ms: { type: "number", description: "Request timeout in ms (default: 15000)" },
            },
            required: ["url", "checks"],
          },
        },
      },
      async execute(args) {
        const url = str(args["url"]);
        if (!url.startsWith("http")) return "Error: valid URL required";
        if (!Array.isArray(args["checks"]) || args["checks"].length === 0) return "Error: checks array is required";
        const checks = args["checks"] as Array<{ type: string; value: string; label?: string }>;
        const timeout = num(args["timeout_ms"], 15_000);
        const start = Date.now();

        let html: string;
        let statusCode: number;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(timeout), redirect: "follow" });
          html = await res.text();
          statusCode = res.status;
        } catch (err) {
          return `Failed to load page: ${err instanceof Error ? err.message : String(err)}`;
        }

        const responseTimeMs = Date.now() - start;
        const results: Array<{ label: string; pass: boolean; detail: string }> = [];

        for (const check of checks) {
          const label = check.label ?? `${check.type}: "${check.value}"`;
          switch (check.type) {
            case "contains":
              results.push({ label, pass: html.includes(check.value), detail: html.includes(check.value) ? "found" : "not found in page" });
              break;
            case "not_contains":
              results.push({ label, pass: !html.includes(check.value), detail: !html.includes(check.value) ? "correctly absent" : "⚠️ unexpectedly present in page" });
              break;
            case "contains_tag": {
              const tagPattern = new RegExp(`<${check.value}[\\s>]`, "i");
              results.push({ label, pass: tagPattern.test(html), detail: tagPattern.test(html) ? `<${check.value}> tag found` : `<${check.value}> tag not found` });
              break;
            }
            default:
              results.push({ label, pass: false, detail: `Unknown check type: ${check.type}` });
          }
        }

        const passed = results.filter(r => r.pass).length;
        const failed = results.length - passed;

        return [
          `Page Smoke Test: ${url}`,
          `HTTP ${statusCode} | ${responseTimeMs}ms | ${passed}/${results.length} checks passed`,
          failed === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failed} CHECK(S) FAILED`,
          "",
          ...results.map(r => `${r.pass ? "✅" : "❌"} ${r.label} — ${r.detail}`),
        ].join("\n");
      },
    },

  ];
}
