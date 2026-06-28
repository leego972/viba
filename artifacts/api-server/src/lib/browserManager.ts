/**
 * VIBA Browser Manager
 *
 * Singleton Playwright/Chromium instance owned by VIBA.
 * All browser tools use this — no external service needed.
 * Groq, Claude, GPT-4o or any agent can call these tools via the registry.
 */

import { logger } from "./logger";
import type { Browser, Page, BrowserContext } from "playwright";

let _browser: Browser | null = null;
let _launchPromise: Promise<Browser> | null = null;

const PLAYWRIGHT_CACHE = process.env["PLAYWRIGHT_BROWSERS_PATH"] ??
  `${process.env["HOME"] ?? "/home/runner/workspace"}/.cache/ms-playwright`;

export async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;
  if (_launchPromise) return _launchPromise;

  _launchPromise = (async () => {
    const { chromium } = await import("playwright");
    logger.info({ cacheDir: PLAYWRIGHT_CACHE }, "Launching Chromium (VIBA browser engine)");
    const b = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
      ],
      executablePath: process.env["CHROMIUM_PATH"] ?? undefined,
    });
    _browser = b;
    b.on("disconnected", () => {
      _browser = null;
      _launchPromise = null;
      logger.warn("Chromium disconnected — will relaunch on next use");
    });
    logger.info("Chromium ready");
    return b;
  })();

  return _launchPromise;
}

export async function newPage(opts?: {
  viewport?: { width: number; height: number };
  userAgent?: string;
  cookies?: Array<{ name: string; value: string; url: string }>;
}): Promise<{ page: Page; context: BrowserContext; close: () => Promise<void> }> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: opts?.viewport ?? { width: 1280, height: 800 },
    userAgent: opts?.userAgent,
    ignoreHTTPSErrors: true,
  });
  if (opts?.cookies?.length) {
    await context.addCookies(opts.cookies);
  }
  const page = await context.newPage();

  const close = async () => {
    try { await context.close(); } catch { /* ignore */ }
  };

  return { page, context, close };
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => undefined);
    _browser = null;
    _launchPromise = null;
  }
}
