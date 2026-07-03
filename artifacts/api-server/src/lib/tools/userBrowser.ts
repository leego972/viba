/**
 * VIBA User Browser Tools
 *
 * Connects to the user's REAL Chrome browser via Chrome DevTools Protocol (CDP).
 * Unlike the headless Chromium tools, these operate in the user's actual browser
 * session — with their cookies, logged-in accounts, and extensions.
 *
 * Setup: user launches Chrome with --remote-debugging-port=9222, tunnels the
 * port publicly (e.g. cloudflared), and saves the tunnel URL via the API.
 *
 * Tools:
 *   user_browser_get_tabs     — list all open tabs
 *   user_browser_navigate     — navigate to URL in user's browser
 *   user_browser_screenshot   — screenshot active or specified tab
 *   user_browser_click        — click element by CSS selector or text
 *   user_browser_type         — type text into an input field
 *   user_browser_extract      — extract text/attribute from DOM
 *   user_browser_eval         — run JS in the user's page context
 *   user_browser_close_tab    — close a tab by index
 */

import { logger } from "../logger";
import { getVibaCredential } from "../vibaVault";

export const USER_BROWSER_PROVIDER = "user_browser";
export const USER_BROWSER_KIND = "cdp_url";

export async function getUserBrowserCdpUrl(userId: number | null): Promise<string | null> {
  return getVibaCredential({ userId, provider: USER_BROWSER_PROVIDER, kind: USER_BROWSER_KIND });
}

export interface UserBrowserTool {
  definition: {
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  };
  execute(args: Record<string, unknown>, userId: number | null): Promise<string>;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 3000);
}

async function withUserPage<T>(
  userId: number | null,
  tabIndex: number,
  fn: (page: import("playwright").Page) => Promise<T>,
): Promise<T> {
  const cdpUrl = await getUserBrowserCdpUrl(userId);
  if (!cdpUrl) {
    throw new Error(
      "My Browser is not connected. Go to Connections → My Browser and follow the setup instructions.",
    );
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const contexts = browser.contexts();
    if (!contexts.length) throw new Error("No browser contexts found. Is Chrome open with a tab?");
    const ctx = contexts[0]!;
    const pages = ctx.pages();
    if (!pages.length) throw new Error("No open tabs found in your browser.");
    const page = pages[Math.min(tabIndex, pages.length - 1)]!;
    return await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

export function getUserBrowserTools(): UserBrowserTool[] {
  return [
    // ── user_browser_get_tabs ─────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "user_browser_get_tabs",
          description:
            "List all open tabs in the user's real Chrome browser. Returns tab index, URL, and title for each tab. Use this before other user_browser tools to pick the right tab.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      async execute(_args, userId) {
        const cdpUrl = await getUserBrowserCdpUrl(userId);
        if (!cdpUrl) {
          return JSON.stringify({
            ok: false,
            error: "My Browser not connected — go to Connections → My Browser to set up.",
          });
        }
        const { chromium } = await import("playwright");
        const browser = await chromium.connectOverCDP(cdpUrl);
        try {
          const contexts = browser.contexts();
          const tabs: Array<{ index: number; url: string; title: string }> = [];
          for (const ctx of contexts) {
            for (const [i, page] of ctx.pages().entries()) {
              tabs.push({ index: i, url: page.url(), title: await page.title().catch(() => "") });
            }
          }
          return JSON.stringify({ ok: true, tabs, count: tabs.length });
        } finally {
          await browser.close().catch(() => {});
        }
      },
    },

    // ── user_browser_navigate ─────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "user_browser_navigate",
          description:
            "Navigate to a URL in the user's real Chrome browser. Returns the page title and visible text. Operates with the user's real cookies and logged-in sessions.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "Full URL to navigate to" },
              tab_index: { type: "number", description: "Which tab to use (0 = first tab, default)" },
              wait_for: { type: "string", description: "CSS selector to wait for after navigation (optional)" },
            },
            required: ["url"],
          },
        },
      },
      async execute(args, userId) {
        const url = str(args["url"]);
        const tabIndex = num(args["tab_index"], 0);
        const waitFor = str(args["wait_for"]);
        try {
          return await withUserPage(userId, tabIndex, async (page) => {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
            if (waitFor) await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => {});
            const title = await page.title();
            const body = await page.evaluate("document.body ? document.body.innerText : ''").catch(() => "") as string;
            return JSON.stringify({ ok: true, title, url: page.url(), text: body.slice(0, 3000) });
          });
        } catch (err) {
          logger.warn({ err, url }, "user_browser_navigate failed");
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── user_browser_screenshot ───────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "user_browser_screenshot",
          description:
            "Take a screenshot of the user's real Chrome browser tab. Returns a base64 PNG data URI. Use with vision_analyze_image to understand the current page state.",
          parameters: {
            type: "object",
            properties: {
              tab_index: { type: "number", description: "Which tab to screenshot (0 = first tab, default)" },
              selector: { type: "string", description: "CSS selector to screenshot just that element (optional)" },
              full_page: { type: "boolean", description: "Capture full scrollable page (default false)" },
            },
            required: [],
          },
        },
      },
      async execute(args, userId) {
        const tabIndex = num(args["tab_index"], 0);
        const selector = str(args["selector"]);
        const fullPage = args["full_page"] === true;
        try {
          return await withUserPage(userId, tabIndex, async (page) => {
            let buf: Buffer;
            if (selector) {
              const el = await page.$(selector);
              if (!el) return JSON.stringify({ ok: false, error: `Selector not found: ${selector}` });
              buf = await el.screenshot({ type: "png" }) as Buffer;
            } else {
              buf = await page.screenshot({ type: "png", fullPage }) as Buffer;
            }
            const dataUri = `data:image/png;base64,${buf.toString("base64")}`;
            return JSON.stringify({ ok: true, url: page.url(), title: await page.title(), screenshot: dataUri });
          });
        } catch (err) {
          logger.warn({ err }, "user_browser_screenshot failed");
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── user_browser_click ────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "user_browser_click",
          description:
            "Click an element in the user's real Chrome browser by CSS selector or visible text.",
          parameters: {
            type: "object",
            properties: {
              selector: { type: "string", description: "CSS selector of the element to click" },
              text: { type: "string", description: "Visible text of the element to click (used if selector not given)" },
              tab_index: { type: "number", description: "Which tab (0 = first tab, default)" },
            },
            required: [],
          },
        },
      },
      async execute(args, userId) {
        const selector = str(args["selector"]);
        const text = str(args["text"]);
        const tabIndex = num(args["tab_index"], 0);
        try {
          return await withUserPage(userId, tabIndex, async (page) => {
            if (selector) {
              await page.click(selector, { timeout: 10000 });
            } else if (text) {
              await page.getByText(text, { exact: false }).first().click({ timeout: 10000 });
            } else {
              return JSON.stringify({ ok: false, error: "Provide selector or text to click." });
            }
            await page.waitForTimeout(500);
            return JSON.stringify({ ok: true, url: page.url(), title: await page.title() });
          });
        } catch (err) {
          logger.warn({ err }, "user_browser_click failed");
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── user_browser_type ─────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "user_browser_type",
          description:
            "Type text into an input field in the user's real Chrome browser.",
          parameters: {
            type: "object",
            properties: {
              selector: { type: "string", description: "CSS selector of the input to type into" },
              text: { type: "string", description: "Text to type" },
              clear_first: { type: "boolean", description: "Clear existing value first (default true)" },
              tab_index: { type: "number", description: "Which tab (0 = first tab, default)" },
            },
            required: ["selector", "text"],
          },
        },
      },
      async execute(args, userId) {
        const selector = str(args["selector"]);
        const text = str(args["text"]);
        const clearFirst = args["clear_first"] !== false;
        const tabIndex = num(args["tab_index"], 0);
        try {
          return await withUserPage(userId, tabIndex, async (page) => {
            if (clearFirst) await page.fill(selector, "").catch(() => {});
            await page.type(selector, text, { delay: 30 });
            return JSON.stringify({ ok: true, typed: text.length });
          });
        } catch (err) {
          logger.warn({ err }, "user_browser_type failed");
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── user_browser_extract ──────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "user_browser_extract",
          description:
            "Extract text or attribute values from elements in the user's real Chrome browser.",
          parameters: {
            type: "object",
            properties: {
              selector: { type: "string", description: "CSS selector of element(s) to extract from" },
              attribute: { type: "string", description: "Attribute to extract (e.g. 'href', 'src'). Omit for inner text." },
              all: { type: "boolean", description: "Extract from all matching elements (default false = first match only)" },
              tab_index: { type: "number", description: "Which tab (0 = first tab, default)" },
            },
            required: ["selector"],
          },
        },
      },
      async execute(args, userId) {
        const selector = str(args["selector"]);
        const attribute = str(args["attribute"]);
        const all = args["all"] === true;
        const tabIndex = num(args["tab_index"], 0);
        try {
          return await withUserPage(userId, tabIndex, async (page) => {
            if (all) {
              const els = await page.$$(selector);
              const values = await Promise.all(
                els.slice(0, 50).map((el) =>
                  attribute ? el.getAttribute(attribute) : el.innerText().catch(() => ""),
                ),
              );
              return JSON.stringify({ ok: true, values: values.filter(Boolean) });
            }
            const el = await page.$(selector);
            if (!el) return JSON.stringify({ ok: false, error: `Selector not found: ${selector}` });
            const value = attribute ? await el.getAttribute(attribute) : await el.innerText().catch(() => "");
            return JSON.stringify({ ok: true, value });
          });
        } catch (err) {
          logger.warn({ err }, "user_browser_extract failed");
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── user_browser_eval ─────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "user_browser_eval",
          description:
            "Run JavaScript in the user's real browser page context. Returns the result as JSON. This has access to the user's real DOM, cookies (non-HttpOnly), and page variables.",
          parameters: {
            type: "object",
            properties: {
              expression: { type: "string", description: "JavaScript expression to evaluate (must be a single expression, not multi-statement)" },
              tab_index: { type: "number", description: "Which tab (0 = first tab, default)" },
            },
            required: ["expression"],
          },
        },
      },
      async execute(args, userId) {
        const expression = str(args["expression"]);
        const tabIndex = num(args["tab_index"], 0);
        try {
          return await withUserPage(userId, tabIndex, async (page) => {
            const result = await page.evaluate(expression);
            return JSON.stringify({ ok: true, result });
          });
        } catch (err) {
          logger.warn({ err }, "user_browser_eval failed");
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── user_browser_close_tab ────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "user_browser_close_tab",
          description: "Close a specific tab in the user's real Chrome browser by tab index.",
          parameters: {
            type: "object",
            properties: {
              tab_index: { type: "number", description: "Index of the tab to close (from user_browser_get_tabs)" },
            },
            required: ["tab_index"],
          },
        },
      },
      async execute(args, userId) {
        const tabIndex = num(args["tab_index"], 0);
        try {
          return await withUserPage(userId, tabIndex, async (page) => {
            const url = page.url();
            await page.close();
            return JSON.stringify({ ok: true, closed: url });
          });
        } catch (err) {
          logger.warn({ err }, "user_browser_close_tab failed");
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },
  ];
}
