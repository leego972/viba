import { Router, type IRouter } from "express";

const router: IRouter = Router();

type JsonRecord = Record<string, unknown>;

function configured(name: string): boolean {
  return Boolean(process.env[name] && String(process.env[name]).trim().length > 0);
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

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "VIBA-Connector/1.0",
  };
}

async function railwayGraphql<T = JsonRecord>(query: string, variables?: JsonRecord): Promise<T> {
  const token = process.env.RAILWAY_TOKEN;
  if (!token) throw new Error("RAILWAY_TOKEN is not configured.");

  const endpoint = process.env.RAILWAY_GRAPHQL_URL || "https://backboard.railway.app/graphql/v2";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Railway API error ${response.status}`);
  }
  if ((data as { errors?: unknown }).errors) {
    throw new Error("Railway GraphQL returned errors.");
  }
  return data as T;
}

async function githubMe(): Promise<JsonRecord> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not configured.");
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "VIBA-Connector/1.0",
    },
  });
  if (!response.ok) throw new Error(`GitHub API error ${response.status}`);
  return await response.json() as JsonRecord;
}

router.get("/connections/status", async (_req, res): Promise<void> => {
  res.json({
    app: "VIBA",
    connections: {
      github: { configured: configured("GITHUB_TOKEN"), liveRoutes: ["/github/repos", "/github/repo", "/github/file", "/github/tree", "/github/branch", "/github/pr"] },
      railway: { configured: configured("RAILWAY_TOKEN"), mode: configured("RAILWAY_TOKEN") ? "api_ready" : "not_configured" },
      railwayMcp: { configured: configured("RAILWAY_MCP_URL"), mode: configured("RAILWAY_MCP_URL") ? "remote_http" : "not_configured" },
      browserAudit: { configured: true, mode: "http_audit_ready" },
    },
  });
});

router.post("/connections/github/validate", async (_req, res): Promise<void> => {
  try {
    const data = await githubMe();
    res.json({ ok: true, login: data.login, id: data.id, message: "GitHub connection validated." });
  } catch (error) {
    res.status(503).json({ ok: false, message: error instanceof Error ? error.message : "GitHub validation failed." });
  }
});

router.post("/connections/railway/validate", async (_req, res): Promise<void> => {
  try {
    const data = await railwayGraphql(`query VibaRailwayViewer { me { id name email } }`);
    res.json({ ok: true, data, message: "Railway token accepted by Railway API." });
  } catch (error) {
    res.status(503).json({ ok: false, message: error instanceof Error ? error.message : "Railway validation failed." });
  }
});

router.post("/connections/railway/projects", async (_req, res): Promise<void> => {
  try {
    const data = await railwayGraphql(`query VibaRailwayProjects { projects { edges { node { id name createdAt updatedAt } } } }`);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(503).json({ ok: false, message: error instanceof Error ? error.message : "Railway projects lookup failed." });
  }
});

router.post("/connections/railway/graphql", async (req, res): Promise<void> => {
  const body = req.body as { query?: unknown; variables?: JsonRecord };
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) { res.status(400).json({ error: "query required" }); return; }

  const lower = query.toLowerCase();
  const isMutation = lower.includes("mutation") || lower.includes("subscription");
  if (isMutation && process.env.RAILWAY_ALLOW_MUTATIONS !== "true") {
    res.status(403).json({ error: "Railway mutation blocked. Set RAILWAY_ALLOW_MUTATIONS=true only after explicit owner approval." });
    return;
  }

  try {
    const data = await railwayGraphql(query, body.variables);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(503).json({ ok: false, message: error instanceof Error ? error.message : "Railway GraphQL call failed." });
  }
});

router.get("/connections/railway-mcp/status", (_req, res): void => {
  res.json({
    ok: true,
    configured: configured("RAILWAY_MCP_URL"),
    mode: configured("RAILWAY_MCP_URL") ? "remote_http" : "not_configured",
    urlRequired: "RAILWAY_MCP_URL",
    tokenRequired: "RAILWAY_TOKEN",
    message: configured("RAILWAY_MCP_URL")
      ? "Railway MCP URL is configured. Use /connections/railway-mcp/tools to attempt tool discovery."
      : "Railway MCP URL is not configured yet. Railway API fallback is available when RAILWAY_TOKEN is set.",
  });
});

router.post("/connections/railway-mcp/tools", async (_req, res): Promise<void> => {
  const mcpUrl = process.env.RAILWAY_MCP_URL;
  if (!mcpUrl) { res.status(503).json({ ok: false, message: "RAILWAY_MCP_URL is not configured." }); return; }

  try {
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: authHeaders(process.env.RAILWAY_TOKEN ?? ""),
      body: JSON.stringify({ jsonrpc: "2.0", id: "viba-tools-list", method: "tools/list", params: {} }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`MCP HTTP error ${response.status}`);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(503).json({ ok: false, message: error instanceof Error ? error.message : "Railway MCP tool discovery failed." });
  }
});

router.post("/connections/browser-audit", async (req, res): Promise<void> => {
  const body = req.body as { url?: unknown };
  const target = safeUrl(body.url);
  if (!target) { res.status(400).json({ error: "Valid http(s) url required." }); return; }

  const startedAt = Date.now();
  try {
    const response = await fetch(target, { redirect: "follow" });
    const text = await response.text();
    const title = text.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.trim() ?? null;
    const description = text.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1]?.trim() ?? null;
    const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(text);
    const hasOgTitle = /<meta[^>]+property=["']og:title["']/i.test(text);
    const hasForms = /<form[\s>]/i.test(text);
    const hasButtons = /<button[\s>]/i.test(text);

    const issues: Array<{ severity: string; message: string }> = [];
    if (!response.ok) issues.push({ severity: response.status >= 500 ? "critical" : "high", message: `HTTP status ${response.status}` });
    if (!title) issues.push({ severity: "medium", message: "Missing title tag." });
    if (!description) issues.push({ severity: "low", message: "Missing meta description." });
    if (!hasViewport) issues.push({ severity: "medium", message: "Missing responsive viewport meta tag." });
    if (!hasOgTitle) issues.push({ severity: "low", message: "Missing Open Graph title." });

    res.json({
      ok: response.ok,
      url: target,
      status: response.status,
      responseMs: Date.now() - startedAt,
      page: { title, description, hasViewport, hasOgTitle, hasForms, hasButtons },
      issues,
      reportMode: "http_audit",
      note: "This is the lightweight server audit. Full Chromium/Playwright audit can be wired later if the runtime includes browser binaries.",
    });
  } catch (error) {
    res.status(502).json({ ok: false, url: target, message: error instanceof Error ? error.message : "Browser audit failed." });
  }
});

export default router;
