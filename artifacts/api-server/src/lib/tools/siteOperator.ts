/**
 * VIBA Site Operator Tools
 *
 * Secure browser-based login and interaction with external websites.
 * Credentials come from VIBA Vault — never appear in session logs.
 * Uses VIBA's own Chromium (no Manus, no paid browser service).
 *
 * Tools:
 *   site_login            — log into any website using vaulted credentials
 *   site_fill_and_submit  — fill a form and submit it
 *   site_api_call         — make authenticated API/tRPC calls with a stored JWT
 *   site_logout           — clear session and close browser context
 */

import { newPage } from "../browserManager";
import { getVibaCredential } from "../vibaVault";
import { logger } from "../logger";

export interface SiteOperatorTool {
  definition: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  execute(args: Record<string, unknown>, userId?: number | null) : Promise<string>;
}

type SessionStore = Map<string, {
  page: Awaited<ReturnType<typeof newPage>>["page"];
  context: Awaited<ReturnType<typeof newPage>>["context"];
  close: () => Promise<void>;
  jwt?: string;
  cookies?: Array<{ name: string; value: string; domain?: string }>;
}>;

const SESSIONS: SessionStore = new Map();

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }

export function getSiteOperatorTools(): SiteOperatorTool[] {
  return [
    // ── site_login ─────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "site_login",
          description: "Log into an external website using credentials stored in VIBA Vault. Credentials are NEVER written to any log or message. Supports form-based login (HTML) and API-based login (JSON response with JWT). Returns a session_id to use for all subsequent site interactions.",
          parameters: {
            type: "object",
            properties: {
              site_url: { type: "string", description: "Base URL of the site (e.g. https://virelle.life)" },
              login_path: { type: "string", description: "Login page path (e.g. /login) — for form-based login" },
              api_login_path: { type: "string", description: "API endpoint for JSON login (e.g. /api/auth/login) — preferred when available" },
              email_selector: { type: "string", description: "CSS selector for email/username input (form login only)" },
              password_selector: { type: "string", description: "CSS selector for password input (form login only)" },
              submit_selector: { type: "string", description: "CSS selector for submit button (form login only)" },
              success_selector: { type: "string", description: "CSS selector that appears after successful login (form login only)" },
              credential_provider: { type: "string", description: "Provider name in VIBA Vault (e.g. 'virelle')" },
              credential_label: { type: "string", description: "Label of the stored credential (default: 'admin')" },
              session_id: { type: "string", description: "Session identifier to create (default: site hostname)" },
            },
            required: ["site_url", "credential_provider"],
          },
        },
      },
      async execute(args, userId) {
        const siteUrl = str(args["site_url"]).replace(/\/$/, "");
        const provider = str(args["credential_provider"]);
        const label = str(args["credential_label"], "admin");
        const apiPath = str(args["api_login_path"]);
        const loginPath = str(args["login_path"], "/login");
        const sessionId = str(args["session_id"], new URL(siteUrl).hostname);

        // Retrieve credentials from vault — never log the values
        let email = "", password = "";
        try {
          const emailCred = await getVibaCredential({ userId: userId ?? null, provider, kind: "email", label });
          const passCred = await getVibaCredential({ userId: userId ?? null, provider, kind: "password", label });
          email = emailCred ?? "";
          password = passCred ?? "";
          if (!email || !password) throw new Error("Credentials not found in vault");
        } catch (err) {
          return JSON.stringify({ ok: false, error: `Vault lookup failed: ${String(err)}. Store credentials first via POST /api/credentials` });
        }

        // ── API-based login (preferred — faster, more reliable) ────────────
        if (apiPath) {
          try {
            const res = await fetch(`${siteUrl}${apiPath}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, password }),
              signal: AbortSignal.timeout(15000),
            });
            const data = await res.json() as Record<string, unknown>;
            const jwt = String(data["token"] ?? data["accessToken"] ?? data["jwt"] ?? "");
            if (!res.ok || !jwt) {
              return JSON.stringify({ ok: false, error: `API login failed: status ${res.status}`, hint: "Check credentials in vault" });
            }
            // Store session with JWT
            SESSIONS.set(sessionId, {
              page: null as never,
              context: null as never,
              close: async () => {},
              jwt,
            });
            logger.info({ provider, sessionId, apiPath }, "site_login via API succeeded");
            return JSON.stringify({ ok: true, session_id: sessionId, method: "api_jwt", authenticated: true });
          } catch (err) {
            logger.warn({ err }, "API login failed, falling back to form login");
          }
        }

        // ── Form-based login (Playwright) ──────────────────────────────────
        const emailSel = str(args["email_selector"], "input[type=email], input[name=email], #email");
        const passSel = str(args["password_selector"], "input[type=password], input[name=password], #password");
        const submitSel = str(args["submit_selector"], "button[type=submit], input[type=submit]");
        const successSel = str(args["success_selector"], "[href*=dashboard], [href*=projects], .dashboard, #dashboard");

        try {
          const session = await newPage();
          await session.page.goto(`${siteUrl}${loginPath}`, { waitUntil: "domcontentloaded", timeout: 20000 });
          await session.page.waitForSelector(emailSel, { timeout: 8000 });
          await session.page.fill(emailSel, email);
          await session.page.fill(passSel, password);
          await session.page.click(submitSel);
          await session.page.waitForNavigation({ timeout: 15000, waitUntil: "domcontentloaded" }).catch(() => {});

          const currentUrl = session.page.url();
          const isLoggedIn = !currentUrl.includes("/login") && !currentUrl.includes("/auth");

          if (!isLoggedIn) {
            await session.close();
            return JSON.stringify({ ok: false, error: "Login appeared to fail — still on login page", url: currentUrl });
          }

          // Try extracting JWT from localStorage/cookies
          const jwt = await session.page.evaluate(
            `localStorage.getItem("token") || localStorage.getItem("jwt") || localStorage.getItem("accessToken") || document.cookie.split(";").find(c=>c.includes("token"))?.split("=")[1] || ""`
          ).catch(() => "") as string;

          SESSIONS.set(sessionId, { ...session, jwt });
          logger.info({ provider, sessionId, currentUrl }, "site_login via form succeeded");
          return JSON.stringify({ ok: true, session_id: sessionId, method: "form", authenticated: true, url: currentUrl });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── site_api_call ──────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "site_api_call",
          description: "Make an authenticated API call to a logged-in site using the JWT from a site_login session. Supports REST and tRPC endpoints.",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "string", description: "Session ID from site_login" },
              site_url: { type: "string", description: "Base URL of the site" },
              path: { type: "string", description: "API path (e.g. /api/projects or /api/trpc/project.create)" },
              method: { type: "string", description: "HTTP method: GET | POST | PUT | DELETE (default: GET)" },
              body: { type: "object", description: "Request body for POST/PUT (JSON)" },
              trpc_input: { type: "object", description: "tRPC input object (wraps in {json: ...} automatically)" },
            },
            required: ["session_id", "site_url", "path"],
          },
        },
      },
      async execute(args) {
        const sessionId = str(args["session_id"], "default");
        const siteUrl = str(args["site_url"]).replace(/\/$/, "");
        const path = str(args["path"]);
        const method = str(args["method"], "GET").toUpperCase();
        const body = args["body"] as Record<string, unknown> | undefined;
        const trpcInput = args["trpc_input"] as Record<string, unknown> | undefined;

        const session = SESSIONS.get(sessionId);
        const jwt = session?.jwt ?? "";

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        };

        const isGet = method === "GET";
        let fetchUrl = `${siteUrl}${path}`;

        // tRPC GET query format
        if (trpcInput && isGet) {
          const input = encodeURIComponent(JSON.stringify({ json: trpcInput }));
          fetchUrl = `${fetchUrl}?input=${input}`;
        }

        try {
          const res = await fetch(fetchUrl, {
            method,
            headers,
            body: isGet ? undefined : JSON.stringify(
              trpcInput ? { json: trpcInput } : body
            ),
            signal: AbortSignal.timeout(30000),
          });

          const text = await res.text();
          let data: unknown;
          try { data = JSON.parse(text); } catch { data = text; }

          return JSON.stringify({ ok: res.ok, status: res.status, data });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── site_fill_and_submit ───────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "site_fill_and_submit",
          description: "Fill multiple form fields and submit a form in an active browser session. Use after site_login for browser sessions.",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "string" },
              fields: {
                type: "array",
                description: "Array of {selector, value} objects to fill",
                items: {
                  type: "object",
                  properties: {
                    selector: { type: "string" },
                    value: { type: "string" },
                    type: { type: "string", description: "input | select | checkbox (default: input)" },
                  },
                },
              },
              submit_selector: { type: "string", description: "CSS selector for submit button" },
              wait_for_selector: { type: "string", description: "Wait for this selector after submit (success indicator)" },
            },
            required: ["fields"],
          },
        },
      },
      async execute(args) {
        const sessionId = str(args["session_id"], "default");
        const fields = (Array.isArray(args["fields"]) ? args["fields"] : []) as Array<{ selector: string; value: string; type?: string }>;
        const submitSel = str(args["submit_selector"]);
        const waitFor = str(args["wait_for_selector"]);

        const session = SESSIONS.get(sessionId);
        if (!session?.page) {
          return JSON.stringify({ ok: false, error: "No active browser session. Use site_login with form-based login first." });
        }

        try {
          for (const field of fields) {
            if (field.type === "select") {
              await session.page.selectOption(field.selector, { label: field.value }).catch(() =>
                session.page.selectOption(field.selector, { value: field.value })
              );
            } else if (field.type === "checkbox") {
              const checked = field.value === "true";
              const el = await session.page.$(field.selector);
              const isChecked = await el?.isChecked() ?? false;
              if (checked !== isChecked) await session.page.click(field.selector);
            } else {
              await session.page.fill(field.selector, field.value);
            }
          }

          if (submitSel) {
            await session.page.click(submitSel);
            if (waitFor) {
              await session.page.waitForSelector(waitFor, { timeout: 15000 }).catch(() => {});
            } else {
              await session.page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
            }
          }

          const url = session.page.url();
          const title = await session.page.title();
          return JSON.stringify({ ok: true, url, title });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── site_logout ────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "site_logout",
          description: "Close and destroy a site login session, clearing all credentials from memory.",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "string" },
            },
            required: ["session_id"],
          },
        },
      },
      async execute(args) {
        const sessionId = str(args["session_id"]);
        const session = SESSIONS.get(sessionId);
        if (session?.close) await session.close().catch(() => {});
        SESSIONS.delete(sessionId);
        return JSON.stringify({ ok: true, logged_out: sessionId });
      },
    },
  ];
}
