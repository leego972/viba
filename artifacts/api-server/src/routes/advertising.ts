import { Router, type IRouter } from "express";
import { requireAdmin } from "../middlewares/adminAuth";
import { db } from "@workspace/db";
import { marketingContent, marketingPerformance } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import {
  runAdvertisingCycle,
  getStrategyOverview,
  getRecentActivity,
  getPerformanceMetrics,
  GROWTH_STRATEGIES,
  getChannelPerformanceReport,
  getCrossChannelAttribution,
  getActiveABTests,
  createABTest,
  recordABTestResult,
  generateBlastContent,
} from "../engines/advertisingEngine";
import { getAllChannelStatuses } from "../engines/marketingEngine";
import {
  getAutonomousGrowthStatus,
  getFreeChannelConnectionStatus,
  publishApprovedFreeContent,
  restartAutonomousGrowthScheduler,
  runAutonomousGrowthCycle,
  stopAutonomousGrowthScheduler,
  updateAutonomousGrowthSettings,
} from "../engines/autonomousGrowthEngine";

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
  const [performance, recentActivity, growth] = await Promise.all([
    getPerformanceMetrics(30),
    getRecentActivity(10),
    getAutonomousGrowthStatus(),
  ]);
  const contentCounts = await db.select({ status: marketingContent.status, count: count() })
    .from(marketingContent).groupBy(marketingContent.status);
  const contentQueue: Record<string, number> = { draft: 0, approved: 0, queued: 0, published: 0, rejected: 0 };
  for (const c of contentCounts) {
    if (c.status && c.status in contentQueue) contentQueue[c.status] = Number(c.count);
  }
  res.json({
    strategy: getStrategyOverview(),
    performance,
    recentActivity,
    contentQueue,
    growth,
    scheduler: growth,
  });
});

router.get("/api/advertising/channels", requireAdmin, async (_req, res): Promise<void> => {
  const core = getAllChannelStatuses();
  const free = getFreeChannelConnectionStatus();
  res.json({
    core,
    free,
    summary: {
      coreConnected: core.filter(c => c.connected).length,
      coreTotal: core.length,
      freeConnected: free.filter(c => c.connected).length,
      freeTotal: free.length,
    },
  });
});

router.get("/api/advertising/channel-performance", requireAdmin, async (_req, res): Promise<void> => {
  res.json(getChannelPerformanceReport());
});

router.get("/api/advertising/budget", requireAdmin, async (_req, res): Promise<void> => {
  const overview = getStrategyOverview();
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

router.get("/api/advertising/scheduler/status", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await getAutonomousGrowthStatus());
});

router.post("/api/advertising/scheduler/start", requireAdmin, async (_req, res): Promise<void> => {
  res.json({ success: true, message: "VIBA autonomous growth system started", status: await restartAutonomousGrowthScheduler() });
});

router.post("/api/advertising/scheduler/stop", requireAdmin, async (_req, res): Promise<void> => {
  res.json({ success: true, message: "VIBA autonomous growth system stopped", status: await stopAutonomousGrowthScheduler() });
});

router.get("/api/advertising/growth/status", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await getAutonomousGrowthStatus());
});

router.post("/api/advertising/growth/start", requireAdmin, async (_req, res): Promise<void> => {
  res.json({ success: true, message: "VIBA autonomous growth system started", status: await restartAutonomousGrowthScheduler() });
});

router.post("/api/advertising/growth/stop", requireAdmin, async (_req, res): Promise<void> => {
  res.json({ success: true, message: "VIBA autonomous growth system stopped", status: await stopAutonomousGrowthScheduler() });
});

router.put("/api/advertising/growth/settings", requireAdmin, async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  res.json(await updateAutonomousGrowthSettings({
    enabled: body["enabled"] === undefined ? undefined : Boolean(body["enabled"]),
    intervalMinutes: body["intervalMinutes"] === undefined ? undefined : Number(body["intervalMinutes"]),
    freeChannels: Array.isArray(body["freeChannels"]) ? body["freeChannels"].map(String) : undefined,
    autoPublishChannels: Array.isArray(body["autoPublishChannels"]) ? body["autoPublishChannels"].map(String) : undefined,
    maxPiecesPerCycle: body["maxPiecesPerCycle"] === undefined ? undefined : Number(body["maxPiecesPerCycle"]),
    autoApproveThreshold: body["autoApproveThreshold"] === undefined ? undefined : Number(body["autoApproveThreshold"]),
  }));
});

router.post("/api/advertising/growth/cycle", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await runAutonomousGrowthCycle("admin-api"));
});

router.post("/api/advertising/growth/publish-approved", requireAdmin, async (req, res): Promise<void> => {
  const { limit = 20, autoPublishChannels } = req.body as { limit?: number; autoPublishChannels?: string[] };
  res.json(await publishApprovedFreeContent(limit, autoPublishChannels));
});

router.get("/api/advertising/blog-posts", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(marketingContent)
    .where(eq(marketingContent.platform, "blog"))
    .orderBy(desc(marketingContent.createdAt))
    .limit(20);
  res.json({ items: rows, total: rows.length });
});

router.get("/api/advertising/campaign-performance", requireAdmin, async (_req, res): Promise<void> => {
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
