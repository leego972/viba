/**
 * VIBA Browser Tools
 *
 * Playwright/Chromium tools owned by VIBA.
 * Any agent (Groq, Claude, GPT-4o, etc.) can call these via the tool registry.
 * No Manus, no external browser service — VIBA runs Chromium itself.
 *
 * Tools:
 *   browser_navigate       — go to URL, return title + visible text
 *   browser_screenshot     — take screenshot, return base64 PNG data URI
 *   browser_click          — click element by CSS selector or visible text
 *   browser_type           — type text into an input field
 *   browser_select         — select option in a <select>
 *   browser_extract        — extract text/attribute from elements
 *   browser_wait_for       — wait for selector to appear
 *   browser_get_html       — return outer HTML of a selector
 *   browser_scroll         — scroll page or element
 *   browser_eval           — run JS in page context (sandboxed)
 *   browser_close          — close all browser contexts
 */

import { newPage } from "../browserManager";
import { logger } from "../logger";

export interface BrowserTool {
  definition: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}

const SESSION_PAGES: Map<string, Awaited<ReturnType<typeof newPage>>> = new Map();

async function getOrCreateSession(sessionId: string, url?: string) {
  if (!SESSION_PAGES.has(sessionId)) {
    const session = await newPage();
    SESSION_PAGES.set(sessionId, session);
    if (url) await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  }
  return SESSION_PAGES.get(sessionId)!;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 4000);
}

export function getBrowserTools(): BrowserTool[] {
  return [
    // ── browser_navigate ────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "browser_navigate",
          description: "Navigate to a URL in a VIBA-managed Chromium browser. Returns the page title and visible text content. Use session_id to maintain state across calls.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "Full URL to navigate to" },
              session_id: { type: "string", description: "Session identifier to reuse browser context (default: 'default')" },
              wait_for: { type: "string", description: "CSS selector to wait for before returning (optional)" },
              timeout_ms: { type: "number", description: "Navigation timeout in ms (default 30000)" },
            },
            required: ["url"],
          },
        },
      },
      async execute(args) {
        const url = str(args["url"]);
        const sessionId = str(args["session_id"], "default");
        const waitFor = str(args["wait_for"]);
        const timeout = num(args["timeout_ms"], 30000);
        try {
          const session = await getOrCreateSession(sessionId);
          await session.page.goto(url, { waitUntil: "domcontentloaded", timeout });
          if (waitFor) {
            await session.page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => {});
          }
          const title = await session.page.title();
          const body = await session.page.evaluate("document.body ? document.body.innerText : ''").catch(() => "") as string;
          const currentUrl = session.page.url();
          return JSON.stringify({ ok: true, title, url: currentUrl, text: body.slice(0, 3000) });
        } catch (err) {
          logger.warn({ err, url }, "browser_navigate failed");
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── browser_screenshot ──────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "browser_screenshot",
          description: "Take a full-page or element screenshot in the active browser session. Returns base64 PNG data URI suitable for vision analysis.",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "string", description: "Session identifier (default: 'default')" },
              selector: { type: "string", description: "CSS selector to screenshot just that element (optional — omit for full page)" },
              full_page: { type: "boolean", description: "Capture full scrollable page (default false)" },
            },
            required: [],
          },
        },
      },
      async execute(args) {
        const sessionId = str(args["session_id"], "default");
        const selector = str(args["selector"]);
        const fullPage = args["full_page"] === true;
        try {
          const session = await getOrCreateSession(sessionId);
          let buffer: Buffer;
          if (selector) {
            const el = await session.page.$(selector);
            if (!el) return JSON.stringify({ ok: false, error: `Selector not found: ${selector}` });
            buffer = await el.screenshot({ type: "png" }) as Buffer;
          } else {
            buffer = await session.page.screenshot({ type: "png", fullPage }) as Buffer;
          }
          const b64 = buffer.toString("base64");
          const dataUri = `data:image/png;base64,${b64}`;
          return JSON.stringify({ ok: true, dataUri, sizeBytes: buffer.length });
        } catch (err) {
          logger.warn({ err }, "browser_screenshot failed");
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── browser_click ───────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "browser_click",
          description: "Click an element in the browser by CSS selector or visible text. Waits for the element to be visible before clicking.",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "string" },
              selector: { type: "string", description: "CSS selector to click" },
              text: { type: "string", description: "Click element containing this visible text (alternative to selector)" },
              timeout_ms: { type: "number", description: "Wait timeout in ms (default 10000)" },
            },
            required: [],
          },
        },
      },
      async execute(args) {
        const sessionId = str(args["session_id"], "default");
        const selector = str(args["selector"]);
        const text = str(args["text"]);
        const timeout = num(args["timeout_ms"], 10000);
        try {
          const session = await getOrCreateSession(sessionId);
          if (text) {
            await session.page.getByText(text, { exact: false }).first().click({ timeout });
          } else if (selector) {
            await session.page.click(selector, { timeout });
          } else {
            return JSON.stringify({ ok: false, error: "Provide selector or text" });
          }
          await session.page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
          const url = session.page.url();
          const title = await session.page.title();
          return JSON.stringify({ ok: true, url, title });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── browser_type ────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "browser_type",
          description: "Type text into an input field, textarea, or contenteditable element. Clears existing content first by default.",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "string" },
              selector: { type: "string", description: "CSS selector of the input field" },
              text: { type: "string", description: "Text to type" },
              clear_first: { type: "boolean", description: "Clear existing value first (default true)" },
              press_enter: { type: "boolean", description: "Press Enter after typing (default false)" },
            },
            required: ["selector", "text"],
          },
        },
      },
      async execute(args) {
        const sessionId = str(args["session_id"], "default");
        const selector = str(args["selector"]);
        const text = str(args["text"]);
        const clearFirst = args["clear_first"] !== false;
        const pressEnter = args["press_enter"] === true;
        try {
          const session = await getOrCreateSession(sessionId);
          await session.page.waitForSelector(selector, { timeout: 8000 });
          if (clearFirst) await session.page.fill(selector, "");
          await session.page.type(selector, text, { delay: 20 });
          if (pressEnter) await session.page.press(selector, "Enter");
          return JSON.stringify({ ok: true, typed: text });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── browser_select ──────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "browser_select",
          description: "Select an option in a <select> dropdown.",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "string" },
              selector: { type: "string", description: "CSS selector of the <select> element" },
              value: { type: "string", description: "Option value or label to select" },
            },
            required: ["selector", "value"],
          },
        },
      },
      async execute(args) {
        const sessionId = str(args["session_id"], "default");
        const selector = str(args["selector"]);
        const value = str(args["value"]);
        try {
          const session = await getOrCreateSession(sessionId);
          await session.page.selectOption(selector, { label: value }).catch(() =>
            session.page.selectOption(selector, { value })
          );
          return JSON.stringify({ ok: true, selected: value });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── browser_extract ─────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "browser_extract",
          description: "Extract text content or an attribute from elements matching a CSS selector. Returns array of matches.",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "string" },
              selector: { type: "string", description: "CSS selector" },
              attribute: { type: "string", description: "HTML attribute to extract (e.g. 'href', 'src'). Omit for text content." },
              limit: { type: "number", description: "Max results to return (default 20)" },
            },
            required: ["selector"],
          },
        },
      },
      async execute(args) {
        const sessionId = str(args["session_id"], "default");
        const selector = str(args["selector"]);
        const attribute = str(args["attribute"]);
        const limit = num(args["limit"], 20);
        try {
          const session = await getOrCreateSession(sessionId);
          const script = attribute
            ? `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).slice(0,${limit}).map(el=>el.getAttribute(${JSON.stringify(attribute)})||"")`
            : `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).slice(0,${limit}).map(el=>el.innerText?el.innerText.trim():"")`;
          const results = await session.page.evaluate(script).catch(() => []) as string[];
          return JSON.stringify({ ok: true, count: results.length, results });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── browser_wait_for ────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "browser_wait_for",
          description: "Wait for a CSS selector to appear on the page, or wait a fixed number of ms.",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "string" },
              selector: { type: "string", description: "CSS selector to wait for" },
              wait_ms: { type: "number", description: "Fixed wait in ms (alternative to selector)" },
              timeout_ms: { type: "number", description: "Max wait time in ms (default 15000)" },
            },
            required: [],
          },
        },
      },
      async execute(args) {
        const sessionId = str(args["session_id"], "default");
        const selector = str(args["selector"]);
        const waitMs = num(args["wait_ms"], 0);
        const timeout = num(args["timeout_ms"], 15000);
        try {
          const session = await getOrCreateSession(sessionId);
          if (waitMs > 0) {
            await session.page.waitForTimeout(Math.min(waitMs, 30000));
            return JSON.stringify({ ok: true, waited_ms: waitMs });
          }
          if (selector) {
            await session.page.waitForSelector(selector, { timeout });
            return JSON.stringify({ ok: true, found: selector });
          }
          return JSON.stringify({ ok: false, error: "Provide selector or wait_ms" });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── browser_eval ────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "browser_eval",
          description: "Evaluate JavaScript in the page context. Returns the result as a string. Use for reading DOM state, localStorage, or triggering JS actions.",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "string" },
              script: { type: "string", description: "JS expression to evaluate (must return a serialisable value)" },
            },
            required: ["script"],
          },
        },
      },
      async execute(args) {
        const sessionId = str(args["session_id"], "default");
        const script = str(args["script"]);
        try {
          const session = await getOrCreateSession(sessionId);
          const result = await session.page.evaluate(script);
          return JSON.stringify({ ok: true, result });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── browser_get_url ─────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "browser_get_url",
          description: "Get the current URL and title of the active browser session.",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "string" },
            },
            required: [],
          },
        },
      },
      async execute(args) {
        const sessionId = str(args["session_id"], "default");
        try {
          const session = SESSION_PAGES.get(sessionId);
          if (!session) return JSON.stringify({ ok: false, error: "No active session" });
          const url = session.page.url();
          const title = await session.page.title();
          return JSON.stringify({ ok: true, url, title });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── browser_close_session ───────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "browser_close_session",
          description: "Close and destroy a browser session, freeing its memory.",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "string", description: "Session to close (default: 'default')" },
            },
            required: [],
          },
        },
      },
      async execute(args) {
        const sessionId = str(args["session_id"], "default");
        const session = SESSION_PAGES.get(sessionId);
        if (session) {
          await session.close().catch(() => {});
          SESSION_PAGES.delete(sessionId);
        }
        return JSON.stringify({ ok: true, closed: sessionId });
      },
    },
  ];
}
