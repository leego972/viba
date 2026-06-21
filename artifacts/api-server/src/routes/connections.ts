import { Router, type IRouter } from "express";
import { logVibaEvent, resolveVibaCredential } from "../lib/vibaVault";

const router: IRouter = Router();

type ReqWithSession = { session?: { userId?: number } };

function userId(req: ReqWithSession): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function safeUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function credential(userIdValue: number | null, provider: string, kind: string, envNames: string[]) {
  return resolveVibaCredential({ userId: userIdValue, provider, kind, envNames });
}

async function githubToken(uid: number | null) {
  return credential(uid, "github", "token", ["GITHUB_TOKEN"]);
}

async function railwayToken(uid: number | null) {
  return credential(uid, "railway", "token", ["RAILWAY_TOKEN"]);
}

async function railwayMcpUrl(uid: number | null) {
  return credential(uid, "railway_mcp", "url", ["RAILWAY_MCP_URL"]);
}

function jsonHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", "User-Agent": "VIBA-Connector/1.0" };
}

async function railwayRequest(token: string, query: string) {
  const response = await fetch(process.env.RAILWAY_GRAPHQL_URL || "https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ query }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (data as { errors?: unknown }).errors) throw new Error(`Railway check failed. Replace RAILWAY_TOKEN. HTTP ${response.status}`);
  return data;
}

router.get("/connections/status", async (req, res): Promise<void> => {
  const uid = userId(req);
  const [github, railway, mcp] = await Promise.all([githubToken(uid), railwayToken(uid), railwayMcpUrl(uid)]);
  res.json({
    app: "VIBA",
    connections: {
      github: { configured: Boolean(github.value), source: github.source, missing: github.missing },
      railway: { configured: Boolean(railway.value), source: railway.source, missing: railway.missing },
      railwayMcp: { configured: Boolean(mcp.value), source: mcp.source, missing: mcp.missing },
      browserAudit: { configured: true },
    },
  });
});

router.post("/connections/github/validate", async (req, res): Promise<void> => {
  const uid = userId(req);
  const token = await githubToken(uid);
  if (!token.value) { res.status(400).json({ ok: false, keyToAdd: "GITHUB_TOKEN", missing: token.missing }); return; }
  try {
    const response = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token.value}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "VIBA-Connector/1.0" } });
    if (!response.ok) throw new Error(`GitHub check failed. Replace GITHUB_TOKEN. HTTP ${response.status}`);
    const data = await response.json() as { login?: string; id?: number };
    await logVibaEvent({ userId: uid, eventType: "connection_validated", provider: "github", status: "valid", message: "GitHub connection validated.", metadata: { source: token.source } });
    res.json({ ok: true, login: data.login, id: data.id, source: token.source });
  } catch (error) {
    res.status(503).json({ ok: false, keyToReplace: "GITHUB_TOKEN", message: error instanceof Error ? error.message : "GitHub validation failed." });
  }
});

router.post("/connections/railway/validate", async (req, res): Promise<void> => {
  const uid = userId(req);
  const token = await railwayToken(uid);
  if (!token.value) { res.status(400).json({ ok: false, keyToAdd: "RAILWAY_TOKEN", missing: token.missing }); return; }
  try {
    const data = await railwayRequest(token.value, "query VibaRailwayViewer { me { id name email } }");
    await logVibaEvent({ userId: uid, eventType: "connection_validated", provider: "railway", status: "valid", message: "Railway connection validated.", metadata: { source: token.source } });
    res.json({ ok: true, data, source: token.source });
  } catch (error) {
    res.status(503).json({ ok: false, keyToReplace: "RAILWAY_TOKEN", message: error instanceof Error ? error.message : "Railway validation failed." });
  }
});

router.post("/connections/railway/projects", async (req, res): Promise<void> => {
  const uid = userId(req);
  const token = await railwayToken(uid);
  if (!token.value) { res.status(400).json({ ok: false, keyToAdd: "RAILWAY_TOKEN", missing: token.missing }); return; }
  try {
    const data = await railwayRequest(token.value, "query VibaRailwayProjects { projects { edges { node { id name createdAt updatedAt } } } }");
    res.json({ ok: true, data, source: token.source });
  } catch (error) {
    res.status(503).json({ ok: false, keyToReplace: "RAILWAY_TOKEN", message: error instanceof Error ? error.message : "Railway projects lookup failed." });
  }
});

router.get("/connections/railway-mcp/status", async (req, res): Promise<void> => {
  const uid = userId(req);
  const [mcp, railway] = await Promise.all([railwayMcpUrl(uid), railwayToken(uid)]);
  res.json({ ok: true, configured: Boolean(mcp.value), source: mcp.source, missing: [...mcp.missing, ...railway.missing], tokenConfigured: Boolean(railway.value) });
});

router.post("/connections/browser-audit", async (req, res): Promise<void> => {
  const body = req.body as { url?: unknown };
  const target = safeUrl(body.url);
  if (!target) { res.status(400).json({ error: "Valid http(s) url required." }); return; }
  try {
    const response = await fetch(target, { redirect: "follow" });
    const text = await response.text();
    const title = text.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.trim() ?? null;
    const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(text);
    const issues: Array<{ severity: string; message: string }> = [];
    if (!response.ok) issues.push({ severity: response.status >= 500 ? "critical" : "high", message: `HTTP status ${response.status}` });
    if (!title) issues.push({ severity: "medium", message: "Missing title tag." });
    if (!hasViewport) issues.push({ severity: "medium", message: "Missing responsive viewport meta tag." });
    await logVibaEvent({ userId: userId(req), eventType: "browser_audit", provider: "browser_audit", subject: target, status: response.ok ? "ok" : "failed", message: `Browser audit completed for ${target}`, metadata: { status: response.status, issues } });
    res.json({ ok: response.ok, url: target, status: response.status, page: { title, hasViewport }, issues, reportMode: "http_audit" });
  } catch (error) {
    res.status(502).json({ ok: false, url: target, message: error instanceof Error ? error.message : "Browser audit failed." });
  }
});

export default router;
