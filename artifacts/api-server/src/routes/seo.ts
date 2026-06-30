import { Router, type IRouter } from "express";
import { requireAdmin } from "../middlewares/adminAuth";
import {
  analyzeSeoHealth,
  analyzeKeywords,
  analyzeInternalLinks,
  optimizeMetaTags,
  generateSeoReport,
  generateStructuredData,
  getOpenGraphTags,
  getPublicPages,
  getCachedReport,
  getLastOptimizationRun,
  runScheduledSeoOptimization,
  triggerSeoKillSwitch,
  resetSeoKillSwitch,
  isSeoKilled,
  getWebVitalsSummary,
  getRedirects,
  submitToIndexNow,
  getSeoEventLog,
  generateContentBriefs,
  analyzeCompetitors,
  optimizeBlogPostSeo,
  generateLlmsTxt,
  generateLlmsFullTxt,
  generateAiCitationMeta,
  getAllProgrammaticPages,
  getTopicClusters,
  getFeaturedSnippetTargets,
  analyzeContentFreshness,
  analyzeContentGaps,
  getSemanticKeywordClusters,
  getSearchIntentMappings,
  generateEnhancedStructuredData,
  generateEEATStructuredData,
  generateSitemapIndex,
  submitBatchToGoogleIndexing,
} from "../engines/seoEngine";

const router: IRouter = Router();

router.get("/api/seo/health", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await analyzeSeoHealth());
});

router.get("/api/seo/keywords", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await analyzeKeywords());
});

router.get("/api/seo/meta", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await optimizeMetaTags());
});

router.get("/api/seo/report", requireAdmin, async (_req, res): Promise<void> => {
  const cached = getCachedReport();
  if (cached && Date.now() - cached.generatedAt < 3_600_000) { res.json(cached); return; }
  res.json(await generateSeoReport());
});

router.post("/api/seo/optimize", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await runScheduledSeoOptimization());
});

router.get("/api/seo/structured-data", requireAdmin, async (_req, res): Promise<void> => {
  res.json(generateStructuredData());
});

router.get("/api/seo/og", requireAdmin, async (req, res): Promise<void> => {
  res.json(getOpenGraphTags(String(req.query["path"] ?? "/")));
});

router.get("/api/seo/pages", requireAdmin, async (_req, res): Promise<void> => {
  res.json(getPublicPages());
});

router.get("/api/seo/last-run", requireAdmin, async (_req, res): Promise<void> => {
  res.json({ lastRun: getLastOptimizationRun() });
});

router.get("/api/seo/web-vitals", requireAdmin, async (_req, res): Promise<void> => {
  res.json(getWebVitalsSummary());
});

router.get("/api/seo/redirects", requireAdmin, async (_req, res): Promise<void> => {
  res.json(getRedirects());
});

router.post("/api/seo/index-now", requireAdmin, async (req, res): Promise<void> => {
  const { urls } = req.body as { urls: string[] };
  res.json(await submitToIndexNow(urls ?? []));
});

router.get("/api/seo/event-log", requireAdmin, async (req, res): Promise<void> => {
  const limit = parseInt(String(req.query["limit"] ?? "50"), 10);
  res.json(getSeoEventLog(limit));
});

router.get("/api/seo/internal-links", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await analyzeInternalLinks());
});

router.get("/api/seo/competitors", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await analyzeCompetitors());
});

router.get("/api/seo/content-briefs", requireAdmin, async (req, res): Promise<void> => {
  const count = parseInt(String(req.query["count"] ?? "5"), 10);
  res.json(await generateContentBriefs(count));
});

router.get("/api/seo/status", requireAdmin, async (_req, res): Promise<void> => {
  const lastRun = getLastOptimizationRun();
  const cached = getCachedReport();
  res.json({
    version: "4.0",
    lastRun,
    hasCachedReport: !!cached,
    cachedReportAge: cached ? Date.now() - cached.generatedAt : null,
    killed: isSeoKilled(),
    features: ["meta-optimization", "structured-data", "internal-links", "event-log", "geo", "content-briefs"],
  });
});

router.post("/api/seo/kill-switch", requireAdmin, async (req, res): Promise<void> => {
  try { res.json(triggerSeoKillSwitch(String(req.body?.code ?? ""))); }
  catch (e) { res.status(400).json({ error: String(e) }); }
});

router.post("/api/seo/reset-kill-switch", requireAdmin, async (req, res): Promise<void> => {
  try { res.json(resetSeoKillSwitch(String(req.body?.code ?? ""))); }
  catch (e) { res.status(400).json({ error: String(e) }); }
});

router.get("/api/seo/llms-txt", async (_req, res): Promise<void> => {
  res.json({ llmsTxt: generateLlmsTxt(), llmsFullTxt: generateLlmsFullTxt() });
});

router.get("/api/seo/programmatic-pages", requireAdmin, async (_req, res): Promise<void> => {
  res.json(getAllProgrammaticPages());
});

router.get("/api/seo/topic-clusters", requireAdmin, async (_req, res): Promise<void> => {
  res.json(getTopicClusters());
});

router.get("/api/seo/snippet-targets", requireAdmin, async (_req, res): Promise<void> => {
  res.json(getFeaturedSnippetTargets());
});

router.get("/api/seo/search-intents", requireAdmin, async (_req, res): Promise<void> => {
  res.json(getSearchIntentMappings());
});

router.get("/api/seo/semantic-clusters", requireAdmin, async (_req, res): Promise<void> => {
  res.json(getSemanticKeywordClusters());
});

router.get("/api/seo/content-freshness", requireAdmin, async (_req, res): Promise<void> => {
  res.json(analyzeContentFreshness());
});

router.get("/api/seo/content-gaps", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await analyzeContentGaps());
});

router.get("/api/seo/enhanced-structured-data", requireAdmin, async (_req, res): Promise<void> => {
  res.json(generateEnhancedStructuredData());
});

router.get("/api/seo/eeat-structured-data", requireAdmin, async (_req, res): Promise<void> => {
  res.json(generateEEATStructuredData());
});

router.get("/api/seo/sitemap-index", requireAdmin, async (_req, res): Promise<void> => {
  res.json(generateSitemapIndex());
});

router.post("/api/seo/google-indexing", requireAdmin, async (req, res): Promise<void> => {
  const { urls } = req.body as { urls: string[] };
  res.json(await submitBatchToGoogleIndexing(urls ?? []));
});

export default router;
