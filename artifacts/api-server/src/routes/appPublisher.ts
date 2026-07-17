import { Router, type IRouter } from "express";

const router: IRouter = Router();
const OWNER = process.env.VIBA_MOBILE_GITHUB_OWNER ?? "leego972";
const REPO = process.env.VIBA_MOBILE_GITHUB_REPO ?? "viba";
const WORKFLOW = process.env.VIBA_MOBILE_WORKFLOW ?? "mobile-store-build.yml";

function validUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

router.post("/app-publisher/validate", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const platforms = Array.isArray(body.platforms) ? body.platforms : [];
  const issues: Array<{ field: string; message: string; severity: "error" | "warning" }> = [];

  if (!validUrl(body.websiteUrl)) issues.push({ field: "websiteUrl", message: "Enter a valid HTTPS website URL.", severity: "error" });
  if (typeof body.appName !== "string" || body.appName.trim().length < 2) issues.push({ field: "appName", message: "App name must contain at least 2 characters.", severity: "error" });
  if (typeof body.bundleId !== "string" || !/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]+)+$/.test(body.bundleId)) issues.push({ field: "bundleId", message: "Use a bundle ID such as guru.viba.app.", severity: "error" });
  if (!platforms.includes("android") && !platforms.includes("apple")) issues.push({ field: "platforms", message: "Select Google Play, Apple App Store, or both.", severity: "error" });
  if (platforms.includes("apple") && !process.env.VIBA_APPLE_TEAM_ID) issues.push({ field: "apple", message: "Apple account is not connected yet.", severity: "warning" });
  if (!process.env.VIBA_MOBILE_GITHUB_TOKEN) issues.push({ field: "automation", message: "Publishing automation is not connected to GitHub yet.", severity: "warning" });

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const score = Math.max(0, 100 - errors * 25 - warnings * 8);
  res.json({ ok: errors === 0, score, issues });
});

router.post("/app-publisher/publish", async (req, res): Promise<void> => {
  const token = process.env.VIBA_MOBILE_GITHUB_TOKEN;
  if (!token) {
    res.status(503).json({ error: "publisher_not_connected", message: "Publishing automation is not configured on the VIBA server." });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const platforms = Array.isArray(body.platforms) ? body.platforms.filter((p): p is string => p === "android" || p === "apple") : [];
  const stores = platforms.length === 2 ? "both" : platforms[0];
  if (!stores) {
    res.status(400).json({ error: "platform_required", message: "Select at least one app store." });
    return;
  }

  const version = typeof body.version === "string" && /^\d+\.\d+\.\d+$/.test(body.version) ? body.version : "1.0.0";
  const buildNumber = Number.isInteger(body.buildNumber) && Number(body.buildNumber) > 0 ? String(body.buildNumber) : "1";

  const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main", inputs: { stores, version, build_number: buildNumber } }),
  });

  if (!response.ok) {
    const detail = await response.text();
    res.status(502).json({ error: "dispatch_failed", message: "VIBA could not start the store build.", detail: detail.slice(0, 500) });
    return;
  }

  res.status(202).json({ ok: true, status: "queued", stores, version, buildNumber, message: "Your app build has been queued." });
});

export default router;
