/**
 * User Browser routes — connect VIBA agents to the user's real Chrome via CDP.
 *
 * GET    /api/user-browser/status  — whether CDP URL is saved + live connection test
 * PUT    /api/user-browser/config  — save CDP URL to vault
 * DELETE /api/user-browser/config  — remove CDP URL from vault
 * POST   /api/user-browser/test    — quick connection test, returns tabs
 */

import { Router, type IRouter } from "express";
import { saveVibaCredential, deleteVibaCredential, getVibaCredential, logVibaEvent } from "../lib/vibaVault";
import { USER_BROWSER_PROVIDER, USER_BROWSER_KIND } from "../lib/tools/userBrowser";

const router: IRouter = Router();

type Req = { session?: { userId?: number } };

function uid(req: Req): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

async function testCdpConnection(cdpUrl: string): Promise<{ ok: boolean; tabs?: Array<{ index: number; url: string; title: string }>; error?: string }> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 8000 });
    try {
      const tabs: Array<{ index: number; url: string; title: string }> = [];
      for (const ctx of browser.contexts()) {
        for (const [i, page] of ctx.pages().entries()) {
          tabs.push({ index: i, url: page.url(), title: await page.title().catch(() => "") });
        }
      }
      return { ok: true, tabs };
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

router.get("/api/user-browser/status", async (req, res): Promise<void> => {
  const userId = uid(req as Req);
  const cdpUrl = await getVibaCredential({ userId, provider: USER_BROWSER_PROVIDER, kind: USER_BROWSER_KIND }).catch(() => null);
  if (!cdpUrl) {
    res.json({ configured: false, connected: false });
    return;
  }
  const test = await testCdpConnection(cdpUrl);
  res.json({ configured: true, connected: test.ok, tabs: test.tabs ?? [], error: test.error });
});

router.put("/api/user-browser/config", async (req, res): Promise<void> => {
  const userId = uid(req as Req);
  const { cdpUrl } = req.body as { cdpUrl?: string };
  if (!cdpUrl || typeof cdpUrl !== "string") {
    res.status(400).json({ error: "cdpUrl is required" });
    return;
  }
  const trimmed = cdpUrl.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    res.status(400).json({ error: "cdpUrl must start with http:// or https://" });
    return;
  }

  const test = await testCdpConnection(trimmed);
  if (!test.ok) {
    res.status(422).json({ error: `Cannot reach Chrome at that URL: ${test.error}` });
    return;
  }

  await saveVibaCredential({
    userId,
    provider: USER_BROWSER_PROVIDER,
    kind: USER_BROWSER_KIND,
    label: "My Browser",
    value: trimmed,
    scope: "user",
  });
  await logVibaEvent({ userId, eventType: "user_browser_connected", provider: USER_BROWSER_PROVIDER, status: "configured", message: "User browser CDP URL saved." });
  res.json({ ok: true, tabs: test.tabs ?? [] });
});

router.delete("/api/user-browser/config", async (req, res): Promise<void> => {
  const userId = uid(req as Req);
  const result = await deleteVibaCredential({ userId, provider: USER_BROWSER_PROVIDER, kind: USER_BROWSER_KIND });
  await logVibaEvent({ userId, eventType: "user_browser_disconnected", provider: USER_BROWSER_PROVIDER, status: "removed", message: "User browser CDP URL removed." });
  res.json({ ok: result.deleted });
});

router.post("/api/user-browser/test", async (req, res): Promise<void> => {
  const userId = uid(req as Req);
  const { cdpUrl: bodyUrl } = req.body as { cdpUrl?: string };
  const cdpUrl = bodyUrl?.trim() ?? await getVibaCredential({ userId, provider: USER_BROWSER_PROVIDER, kind: USER_BROWSER_KIND }).catch(() => null);
  if (!cdpUrl) {
    res.status(400).json({ ok: false, error: "No CDP URL — provide cdpUrl or save one first." });
    return;
  }
  const result = await testCdpConnection(cdpUrl);
  res.json(result);
});

export default router;
