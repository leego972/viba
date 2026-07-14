import { Router, type IRouter } from "express";
import { requireAdmin } from "../middlewares/adminAuth";
import { db } from "@workspace/db";
import {
  marketingContent,
  marketingPerformance,
  marketingCampaigns,
  marketingActivityLog,
} from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import {
  runAdvertisingCycle,
  getStrategyOverview,
  getRecentActivity,
  getPerformanceMetrics,
  GROWTH_STRATEGIES,
  startAdvertisingScheduler,
  stopAdvertisingScheduler,
  getChannelPerformanceReport,
  getCrossChannelAttribution,
  getActiveABTests,
  createABTest,
  recordABTestResult,
  generateBlastContent,
} from "../engines/advertisingEngine";
import { getAllChannelStatuses } from "../engines/marketingEngine";

const router: IRouter = Router();

router.get("/api/advertising/strategy", requireAdmin, async (_req, res): Promise<void> => {
  res.json(getStrategyOverview());
});

router.get("/api/advertising/performance", requireAdmin, async (req, res): Promise<void> => {
  const days = parseInt(String(req.query["days"] ?? "30"), 10);
  res.json(await getPerformanceMetrics(days));
});

router.get("/api/advertising/activity", requireAdmin, async (req, res): Promise<void> => {
  const limit = parseInt(String(req.query["limit"] ?? "50"), 10);
  res.json(await getRecentActivity(limit));
});

router.post("/api/advertising/cycle", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await runAdvertisingCycle());
});

router.get("/api/advertising/strategies", requireAdmin, async (_req, res): Promise<void> => {
  res.json(GROWTH_STRATEGIES);
});

router.get("/api/advertising/content", requireAdmin, async (req, res): Promise<void> => {
  const { status = "all", limit = "50", offset = "0" } = req.query as Record<string, string>;
  let query = db.select().from(marketingContent).orderBy(desc(marketingContent.createdAt))
    .limit(parseInt(limit, 10)).offset(parseInt(offset, 10));
  if (status !== "all") query = query.where(eq(marketingContent.status, status)) as typeof query;
  const items = await query;
  const [totalRow] = await db.select({ count: count() }).from(marketingContent);
  res.json({ items, total: Number(totalRow?.count ?? 0) });
});

router.patch("/api/advertising/content/:id/status", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  const { status, publishedUrl } = req.body as { status: string; publishedUrl?: string };
  await db.update(marketingContent).set({
    status,
    ...(publishedUrl ? { publishedUrl } : {}),
    ...(status === "published" ? { publishedAt: new Date() } : {}),
  } as never).where(eq(marketingContent.id, id));
  res.json({ success: true });
});

router.get("/api/advertising/content/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  const [row] = await db.select().from(marketingContent).where(eq(marketingContent.id, id)).limit(1);
  res.json(row ?? null);
});

router.get("/api/advertising/dashboard", requireAdmin, async (_req, res): Promise<void> => {
  const [performance, recentActivity] = await Promise.all([
    getPerformanceMetrics(30),
    getRecentActivity(10),
  ]);
  const contentCounts = await db.select({ status: marketingContent.status, count: count() })
    .from(marketingContent).groupBy(marketingContent.status);
  const contentQueue: Record<string, number> = { draft: 0, approved: 0, published: 0, rejected: 0 };
  for (const c of contentCounts) {
    if (c.status && c.status in contentQueue) contentQueue[c.status] = Number(c.count);
  }
  res.json({
    strategy: getStrategyOverview(),
    performance,
    recentActivity,
    contentQueue,
  });
});

router.get("/api/advertising/channels", requireAdmin, async (_req, res): Promise<void> => {
  const core = getAllChannelStatuses();
  res.json({ core, summary: { coreConnected: core.filter(c => c.connected).length, coreTotal: core.length } });
});

router.get("/api/advertising/channel-performance", requireAdmin, async (_req, res): Promise<void> => {
  res.json(getChannelPerformanceReport());
});

router.get("/api/advertising/budget", requireAdmin, async (_req, res): Promise<void> => {
  const overview = getStrategyOverview();
  const performance = await getPerformanceMetrics(30);
  res.json({
    monthlyBudget: overview.monthlyBudget,
    currency: overview.currency,
    allocation: overview.budgetAllocation,
    freeChannels: overview.freeChannelCount,
    paidChannels: overview.paidChannelCount,
    costBreakdown: GROWTH_STRATEGIES.map(s => ({
      channel: s.channel,
      costPerMonth: s.costPerMonth,
      frequency: s.frequency,
      impact: s.expectedImpact,
      automatable: s.automatable,
    })),
  });
});

router.get("/api/advertising/attribution", requireAdmin, async (req, res): Promise<void> => {
  const days = parseInt(String(req.query["days"] ?? "30"), 10);
  res.json(await getCrossChannelAttribution(days));
});

router.get("/api/advertising/ab-tests", requireAdmin, async (_req, res): Promise<void> => {
  res.json(getActiveABTests());
});

router.post("/api/advertising/ab-tests", requireAdmin, async (req, res): Promise<void> => {
  const { channel, variantADesc, variantBDesc } = req.body as { channel: string; variantADesc: string; variantBDesc: string };
  res.json(createABTest(channel, variantADesc, variantBDesc));
});

router.post("/api/advertising/ab-tests/:id/result", requireAdmin, async (req, res): Promise<void> => {
  const { variant, success } = req.body as { variant: "A" | "B"; success: boolean };
  recordABTestResult(String(req.params["id"] ?? ""), variant, success);
  res.json({ success: true });
});

router.post("/api/advertising/scheduler/start", requireAdmin, async (_req, res): Promise<void> => {
  startAdvertisingScheduler();
  res.json({ success: true, message: "VIBA advertising scheduler started" });
});

router.post("/api/advertising/scheduler/stop", requireAdmin, async (_req, res): Promise<void> => {
  stopAdvertisingScheduler();
  res.json({ success: true, message: "VIBA advertising scheduler stopped" });
});

router.get("/api/advertising/blog-posts", requireAdmin, async (req, res): Promise<void> => {
  const { limit = "20", offset = "0" } = req.query as Record<string, string>;
  res.json({ items: [], total: 0 });
});

router.get("/api/advertising/campaign-performance", requireAdmin, async (req, res): Promise<void> => {
  const rows = await db.select().from(marketingPerformance).orderBy(desc(marketingPerformance.createdAt)).limit(100);
  res.json(rows);
});

router.post("/api/advertising/blast", requireAdmin, async (req, res): Promise<void> => {
  const { channelIds } = req.body as { channelIds?: string[] };
  res.json(await generateBlastContent(channelIds));
});

router.post("/api/advertising/content/auto-approve", requireAdmin, async (req, res): Promise<void> => {
  const { threshold = 75 } = req.body as { threshold?: number };
  const { autoApproveHighQualityContent } = await import("../engines/contentCreatorEngine");
  res.json(await autoApproveHighQualityContent(threshold));
});

router.post("/api/advertising/content/autonomous-cycle", requireAdmin, async (req, res): Promise<void> => {
  const { maxPiecesPerPlatform = 2, autoApproveThreshold = 75, autoSchedule = true } = req.body as Record<string, number | boolean>;
  const { runAutonomousContentCycle } = await import("../engines/contentCreatorEngine");
  res.json(await runAutonomousContentCycle({
    maxPiecesPerPlatform: Number(maxPiecesPerPlatform),
    autoApproveThreshold: Number(autoApproveThreshold),
    autoSchedule: Boolean(autoSchedule),
  }));
});

export default router;
