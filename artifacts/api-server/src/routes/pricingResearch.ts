import { Router, type IRouter } from "express";
import { logVibaEvent } from "../lib/vibaVault";

const router: IRouter = Router();

type SearchResult = { title: string; url: string; snippet?: string };
type PriceCandidate = { amount: number; currency: string; period: "monthly" | "yearly" | "unknown"; monthlyEquivalent: number; raw: string };
type SourcePricing = { title: string | null; url: string; searchTitle?: string; snippet?: string; prices: PriceCandidate[]; error?: string };

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function titleFromHtml(html: string): string | null {
  return /<title[^>]*>(.*?)<\/title>/is.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
}

function textFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function roundMoney(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function extractPrices(html: string): PriceCandidate[] {
  const text = textFromHtml(html);
  const candidates: PriceCandidate[] = [];
  const seen = new Set<string>();
  const priceRegex = /(USD|AUD|EUR|GBP|US\$|AU\$|\$|€|£)\s?([0-9]{1,4}(?:,[0-9]{3})?(?:\.[0-9]{1,2})?)\s?(?:\/|per\s+)?\s?(month|mo|monthly|year|yr|yearly|annual|annually)?/gi;
  let match: RegExpExecArray | null;

  while ((match = priceRegex.exec(text)) && candidates.length < 80) {
    const raw = match[0].trim();
    const currencyToken = match[1];
    const amount = Number(match[2].replace(/,/g, ""));
    const periodToken = (match[3] ?? "").toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (amount > 100000) continue;

    let currency = "USD";
    if (currencyToken === "AUD" || currencyToken === "AU$") currency = "AUD";
    if (currencyToken === "EUR" || currencyToken === "€") currency = "EUR";
    if (currencyToken === "GBP" || currencyToken === "£") currency = "GBP";

    let period: PriceCandidate["period"] = "unknown";
    if (["month", "mo", "monthly"].includes(periodToken)) period = "monthly";
    if (["year", "yr", "yearly", "annual", "annually"].includes(periodToken)) period = "yearly";

    const monthlyEquivalent = period === "yearly" ? amount / 12 : amount;
    const key = `${currency}:${amount}:${period}:${raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ amount, currency, period, monthlyEquivalent: roundMoney(monthlyEquivalent) ?? monthlyEquivalent, raw });
  }

  return candidates;
}

function looksRelevant(result: SearchResult, category: string): boolean {
  const combined = `${result.title} ${result.snippet ?? ""} ${result.url}`.toLowerCase();
  const categoryWords = category.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const hasCategory = categoryWords.some((word) => combined.includes(word));
  const hasBuilderIntent = /ai|builder|agent|code|app|website|software|automation|platform|developer|replit|deploy/.test(combined);
  return hasCategory || hasBuilderIntent;
}

async function braveSearch(query: string, count: number): Promise<SearchResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error("BRAVE_SEARCH_API_KEY is not configured.");
  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(Math.max(count, 1), 20)}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
  });
  if (!response.ok) throw new Error(`Brave search failed: HTTP ${response.status}`);
  const data = await response.json() as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (data.web?.results ?? [])
    .filter((r) => r.title && r.url && safeUrl(r.url))
    .map((r) => ({ title: r.title!, url: safeUrl(r.url!)!, snippet: r.description }));
}

async function fetchPricingSource(result: SearchResult): Promise<SourcePricing> {
  const urlsToTry = [result.url];
  try {
    const base = new URL(result.url);
    urlsToTry.push(`${base.origin}/pricing`);
    urlsToTry.push(`${base.origin}/plans`);
  } catch {
    // ignore
  }

  let lastError = "No pricing page loaded.";
  for (const url of [...new Set(urlsToTry)]) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      const html = await response.text();
      const prices = extractPrices(html);
      if (prices.length || response.ok) {
        return { title: titleFromHtml(html), url, searchTitle: result.title, snippet: result.snippet, prices };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Fetch failed";
    }
  }

  return { title: null, url: result.url, searchTitle: result.title, snippet: result.snippet, prices: [], error: lastError };
}

function makeBenchmark(category: string, sources: SourcePricing[]) {
  const monthly = sources.flatMap((source) => source.prices)
    .filter((p) => p.currency === "USD" || p.currency === "AUD")
    .map((p) => p.monthlyEquivalent)
    .filter((n) => Number.isFinite(n) && n > 0 && n < 2000);

  const benchmark = {
    sampleSize: sources.length,
    pricedSources: sources.filter((s) => s.prices.length > 0).length,
    priceCount: monthly.length,
    minMonthly: roundMoney(monthly.length ? Math.min(...monthly) : null),
    maxMonthly: roundMoney(monthly.length ? Math.max(...monthly) : null),
    averageMonthly: roundMoney(average(monthly)),
    medianMonthly: roundMoney(median(monthly)),
    lowerMidMonthly: roundMoney(percentile(monthly, 40)),
    upperMidMonthly: roundMoney(percentile(monthly, 60)),
  };

  const recommendedMonthly = benchmark.medianMonthly ?? benchmark.averageMonthly;
  const recommendedYearly = recommendedMonthly === null ? null : roundMoney(recommendedMonthly * 12 * 0.85);

  return {
    category,
    benchmark,
    recommendation: {
      position: "mid_range",
      suggestedMonthlyPrice: recommendedMonthly,
      suggestedYearlyPriceWith15PercentDiscount: recommendedYearly,
      rationale: recommendedMonthly === null
        ? "Not enough public pricing data was extracted. Add more sources or inspect pricing pages manually."
        : "Use median monthly pricing as the mid-range anchor, then offer a yearly discount to stay competitive without becoming the cheapest option.",
    },
  };
}

router.post("/pricing-research/benchmark", async (req, res): Promise<void> => {
  const body = req.body as { category?: unknown; topN?: unknown; query?: unknown };
  const category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : "AI builder apps";
  const topN = Math.min(Math.max(Number(body.topN ?? 10), 1), 10);
  const query = typeof body.query === "string" && body.query.trim()
    ? body.query.trim()
    : `${category} pricing plans AI app builder code builder`;

  try {
    const searchResults = (await braveSearch(query, 20)).filter((r) => looksRelevant(r, category)).slice(0, topN);
    const sources = await Promise.all(searchResults.map(fetchPricingSource));
    const result = makeBenchmark(category, sources);
    await logVibaEvent({
      userId: userId(req),
      eventType: "pricing_benchmark",
      provider: "web_research",
      status: "ok",
      message: `Pricing benchmark completed for ${category}.`,
      metadata: { topN, pricedSources: result.benchmark.pricedSources, suggestedMonthlyPrice: result.recommendation.suggestedMonthlyPrice },
    });
    res.json({ ok: true, query, topN, ...result, sources, note: "Public pricing pages are parsed heuristically. Review extracted prices before making final business decisions." });
  } catch (error) {
    res.status(503).json({ ok: false, keyToAdd: "BRAVE_SEARCH_API_KEY", message: error instanceof Error ? error.message : "Pricing benchmark failed." });
  }
});

router.post("/pricing-research/builder-apps", async (req, res): Promise<void> => {
  req.body = { ...(req.body as object), category: "AI builder apps", topN: 10 };
  router.handle(req, res);
});

export default router;
