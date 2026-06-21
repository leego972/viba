import { Router, type IRouter } from "express";
import { logVibaEvent } from "../lib/vibaVault";

const router: IRouter = Router();

type SearchResult = {
  title: string;
  url: string;
  snippet?: string;
};

type InspirationReportItem =
  | { url: string; status: number; title: string | null; features: string[]; designPatterns: string[]; ideas: string[] }
  | { url: string; status: "error"; message: string };

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function safeHttpUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, name: string): string | null {
  const byName = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)`, "i").exec(html)?.[1];
  const byProperty = new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)`, "i").exec(html)?.[1];
  return (byName ?? byProperty ?? null)?.trim() ?? null;
}

function extractMatches(html: string, regex: RegExp, limit = 20): string[] {
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) && matches.length < limit) {
    const value = (match[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (value && !matches.includes(value)) matches.push(value.slice(0, 160));
  }
  return matches;
}

function extractSignals(html: string) {
  const text = stripTags(html).toLowerCase();
  const headings = extractMatches(html, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi, 30);
  const buttons = extractMatches(html, /<button[^>]*>([\s\S]*?)<\/button>/gi, 30);
  const links = extractMatches(html, /<a[^>]*>([\s\S]*?)<\/a>/gi, 40);

  const features = [
    ["pricing", /pricing|plans|subscription|monthly|yearly|trial/.test(text)],
    ["authentication", /login|log in|sign in|sign up|register|account/.test(text)],
    ["dashboard", /dashboard|workspace|project|console|admin/.test(text)],
    ["docs", /docs|documentation|api reference|developer/.test(text)],
    ["integrations", /integration|connect|github|slack|stripe|railway|api key|webhook/.test(text)],
    ["marketplace", /marketplace|templates|plugins|extensions|add-ons/.test(text)],
    ["onboarding", /get started|start now|quick start|setup|wizard/.test(text)],
    ["social proof", /customers|testimonials|case studies|trusted by|reviews/.test(text)],
    ["support", /support|contact|help center|faq/.test(text)],
    ["security", /security|privacy|compliance|soc 2|gdpr|encryption/.test(text)],
  ].filter(([, present]) => present).map(([name]) => name as string);

  const designPatterns = [
    ["hero CTA", /hero|start free|try|book a demo|get started|download/.test(text)],
    ["pricing cards", /monthly|yearly|save|trial|pro|enterprise/.test(text)],
    ["feature grid", /features|capabilities|benefits/.test(text)],
    ["comparison section", /compare|versus|alternative/.test(text)],
    ["integration wall", /integrations|connectors|apps/.test(text)],
    ["docs-first navigation", /docs|api|developer/.test(text)],
  ].filter(([, present]) => present).map(([name]) => name as string);

  return { headings, buttons, links, features, designPatterns };
}

function originalImplementationIdeas(signals: ReturnType<typeof extractSignals>): string[] {
  const ideas: string[] = [];
  if (signals.features.includes("pricing")) ideas.push("Create clear VIBA plan cards with trial, monthly, yearly and enterprise options.");
  if (signals.features.includes("authentication")) ideas.push("Add a guided signup/login flow that explains what the user can connect after account creation.");
  if (signals.features.includes("dashboard")) ideas.push("Use a workspace dashboard showing active sessions, connected tools, saved reports and recent issues.");
  if (signals.features.includes("integrations")) ideas.push("Show a connector wall for GitHub, Railway, Railway MCP, browser audit, LLM providers and web research.");
  if (signals.features.includes("docs")) ideas.push("Add a developer docs route with API examples, environment variables and connector setup.");
  if (signals.features.includes("security")) ideas.push("Show trust/security messaging around encrypted credential storage and approval-gated actions.");
  if (!ideas.length) ideas.push("Extract the useful workflow pattern, then redesign it in VIBA's own interface and copywriting.");
  return ideas;
}

async function braveSearch(query: string, count: number): Promise<SearchResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error("BRAVE_SEARCH_API_KEY is not configured.");
  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(count, 10)}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
  });
  if (!response.ok) throw new Error(`Brave search failed: HTTP ${response.status}`);
  const data = await response.json() as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (data.web?.results ?? [])
    .filter((r) => r.title && r.url)
    .map((r) => ({ title: r.title!, url: r.url!, snippet: r.description }));
}

router.get("/web-research/config", (_req, res): void => {
  res.json({
    app: "VIBA",
    mode: "web_research_inspiration",
    searchProviders: { brave: Boolean(process.env.BRAVE_SEARCH_API_KEY) },
    rules: [
      "Extract feature ideas and UX patterns.",
      "Generate original implementation plans.",
      "Do not copy proprietary source code, assets, logos, brand text or pixel-perfect designs.",
    ],
  });
});

router.post("/web-research/search", async (req, res): Promise<void> => {
  const body = req.body as { query?: unknown; count?: unknown };
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const count = Math.min(Number(body.count ?? 5), 10);
  if (!query) { res.status(400).json({ error: "query required" }); return; }

  try {
    const results = await braveSearch(query, count);
    await logVibaEvent({ userId: userId(req), eventType: "web_research_search", provider: "web_research", status: "ok", message: `Web search completed: ${query}`, metadata: { count: results.length } });
    res.json({ ok: true, query, results });
  } catch (error) {
    res.status(503).json({ ok: false, keyToAdd: "BRAVE_SEARCH_API_KEY", message: error instanceof Error ? error.message : "Web search failed." });
  }
});

router.post("/web-research/analyze-url", async (req, res): Promise<void> => {
  const body = req.body as { url?: unknown };
  const url = safeHttpUrl(body.url);
  if (!url) { res.status(400).json({ error: "valid http(s) url required" }); return; }

  try {
    const response = await fetch(url, { redirect: "follow" });
    const html = await response.text();
    const title = /<title[^>]*>(.*?)<\/title>/is.exec(html)?.[1]?.trim() ?? null;
    const description = metaContent(html, "description") ?? metaContent(html, "og:description");
    const signals = extractSignals(html);
    const ideas = originalImplementationIdeas(signals);
    await logVibaEvent({ userId: userId(req), eventType: "web_research_analyze_url", provider: "web_research", subject: url, status: response.ok ? "ok" : "failed", message: `Analyzed public page for inspiration: ${url}`, metadata: { status: response.status, features: signals.features } });
    res.json({ ok: response.ok, source: url, status: response.status, title, description, signals, originalImplementationIdeas: ideas, complianceNote: "Use these as inspiration only. Build original VIBA UI/copy/assets; do not copy protected code, branding, images or pixel-perfect layouts." });
  } catch (error) {
    res.status(502).json({ ok: false, source: url, message: error instanceof Error ? error.message : "URL analysis failed." });
  }
});

router.post("/web-research/inspiration-report", async (req, res): Promise<void> => {
  const body = req.body as { urls?: unknown };
  const urls = Array.isArray(body.urls) ? body.urls.map(safeHttpUrl).filter(Boolean).slice(0, 8) as string[] : [];
  if (!urls.length) { res.status(400).json({ error: "urls array required" }); return; }

  const reports: InspirationReportItem[] = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      const html = await response.text();
      const title = /<title[^>]*>(.*?)<\/title>/is.exec(html)?.[1]?.trim() ?? null;
      const signals = extractSignals(html);
      reports.push({ url, status: response.status, title, features: signals.features, designPatterns: signals.designPatterns, ideas: originalImplementationIdeas(signals) });
    } catch (error) {
      reports.push({ url, status: "error", message: error instanceof Error ? error.message : "Failed" });
    }
  }

  await logVibaEvent({ userId: userId(req), eventType: "web_research_inspiration_report", provider: "web_research", status: "ok", message: `Generated inspiration report for ${reports.length} URLs.`, metadata: { urls } });
  res.json({
    ok: true,
    reports,
    buildGuidance: [
      "Identify common user expectations across competitors.",
      "Keep the idea, redesign the implementation.",
      "Use VIBA's own branding, components, copy and UX logic.",
      "Do not copy protected assets or proprietary source.",
    ],
  });
});

export default router;
