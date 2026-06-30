import { Router, type IRouter } from "express";
import { requireAdmin } from "../middlewares/adminAuth";
import { db } from "@workspace/db";
import {
  marketingSettings,
  marketingBudgets,
  marketingCampaigns,
  marketingContent,
  marketingPerformance,
  marketingActivityLog,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import {
  generateContent,
  allocateBudget,
  createCampaignPlan,
  executeCampaign,
  analyzePerformance,
  runAutonomousCycle,
  getAllChannelStatuses,
} from "../engines/marketingEngine";

const router: IRouter = Router();

router.get("/api/marketing/settings", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(marketingSettings);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value ?? "";
  res.json({
    enabled: map["enabled"] === "true",
    monthlyBudget: parseFloat(map["monthly_budget"] ?? "0"),
    autoPublish: map["auto_publish"] === "true",
    contentFrequency: map["content_frequency"] ?? "daily",
    lastCycleAt: map["last_cycle_at"] ?? null,
    totalSpendThisMonth: parseFloat(map["total_spend_this_month"] ?? "0"),
  });
});

router.put("/api/marketing/settings", requireAdmin, async (req, res): Promise<void> => {
  const { enabled, monthlyBudget, autoPublish, contentFrequency } = req.body as Record<string, unknown>;
  const updates: { key: string; value: string }[] = [];
  if (enabled !== undefined) updates.push({ key: "enabled", value: String(enabled) });
  if (monthlyBudget !== undefined) updates.push({ key: "monthly_budget", value: String(monthlyBudget) });
  if (autoPublish !== undefined) updates.push({ key: "auto_publish", value: String(autoPublish) });
  if (contentFrequency !== undefined) updates.push({ key: "content_frequency", value: String(contentFrequency) });

  for (const { key, value } of updates) {
    const existing = await db.select().from(marketingSettings).where(eq(marketingSettings.key, key)).limit(1);
    if (existing.length > 0) {
      await db.update(marketingSettings).set({ value }).where(eq(marketingSettings.key, key));
    } else {
      await db.insert(marketingSettings).values({ key, value } as never);
    }
  }
  res.json({ success: true });
});

router.get("/api/marketing/channels", requireAdmin, async (_req, res): Promise<void> => {
  res.json(getAllChannelStatuses());
});

router.get("/api/marketing/budget", requireAdmin, async (_req, res): Promise<void> => {
  const currentMonth = new Date().toISOString().substring(0, 7);
  const rows = await db.select().from(marketingBudgets)
    .where(eq(marketingBudgets.month, currentMonth))
    .orderBy(desc(marketingBudgets.createdAt)).limit(1);
  res.json(rows[0] ?? null);
});

router.get("/api/marketing/budget/history", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(marketingBudgets).orderBy(desc(marketingBudgets.createdAt)).limit(12);
  res.json(rows);
});

router.post("/api/marketing/budget/allocate", requireAdmin, async (req, res): Promise<void> => {
  const { monthlyBudget } = req.body as { monthlyBudget: number };
  const allocations = await allocateBudget({ monthlyBudget });
  const month = new Date().toISOString().substring(0, 7);
  for (const a of allocations) {
    await db.insert(marketingBudgets).values({
      month,
      channel: a.channel,
      allocatedAmount: String(Math.round(a.amount * 100)),
      reasoning: a.reasoning,
    } as never);
  }
  res.json({ allocations, month });
});

router.post("/api/marketing/content/generate", requireAdmin, async (req, res): Promise<void> => {
  const { platform, contentType, topic, campaignGoal, includeImage } = req.body as Record<string, unknown>;
  const content = await generateContent({
    platform: String(platform ?? "linkedin"),
    contentType: String(contentType ?? "organic_post"),
    topic: topic ? String(topic) : undefined,
    campaignGoal: campaignGoal ? String(campaignGoal) : undefined,
    includeImage: Boolean(includeImage),
  });
  await db.insert(marketingActivityLog).values({
    action: "content_generated",
    description: `Content generated for ${platform}`,
    metadata: { type: contentType, headline: content.headline } as never,
  } as never);
  res.json(content);
});

router.get("/api/marketing/content", requireAdmin, async (req, res): Promise<void> => {
  const { status, channel, limit = "50" } = req.query as Record<string, string>;
  let query = db.select().from(marketingContent).orderBy(desc(marketingContent.createdAt)).limit(parseInt(limit, 10));
  if (status) query = query.where(eq(marketingContent.status, status)) as typeof query;
  if (channel) query = query.where(eq(marketingContent.platform, channel)) as typeof query;
  res.json(await query);
});

router.patch("/api/marketing/content/:id/status", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  const { status } = req.body as { status: string };
  await db.update(marketingContent).set({ status } as never).where(eq(marketingContent.id, id));
  res.json({ success: true });
});

router.post("/api/marketing/campaigns", requireAdmin, async (req, res): Promise<void> => {
  const { goal, budget, durationDays, focusChannels } = req.body as Record<string, unknown>;
  const plan = await createCampaignPlan({
    goal: String(goal ?? "awareness"),
    budget: Number(budget ?? 0),
    durationDays: Number(durationDays ?? 30),
    focusChannels: Array.isArray(focusChannels) ? focusChannels : undefined,
  });
  const [inserted] = await db.insert(marketingCampaigns).values({
    channel: plan.channels[0] ?? "meta",
    name: plan.name,
    status: "draft",
    type: goal === "signups" ? "conversion" : "awareness",
    targetAudience: plan.targeting as never,
    dailyBudget: Math.round(Number(budget) / Number(durationDays) * 100),
    budget: Math.round(Number(budget) * 100),
    startDate: new Date(),
    endDate: new Date(Date.now() + Number(durationDays) * 86400000),
    aiStrategy: JSON.stringify(plan),
  } as never).returning({ id: marketingCampaigns.id });
  res.json({ campaignId: inserted?.id, plan });
});

router.get("/api/marketing/campaigns", requireAdmin, async (req, res): Promise<void> => {
  const { status, limit = "50" } = req.query as Record<string, string>;
  let query = db.select().from(marketingCampaigns).orderBy(desc(marketingCampaigns.createdAt)).limit(parseInt(limit, 10));
  if (status) query = query.where(eq(marketingCampaigns.status, status)) as typeof query;
  res.json(await query);
});

router.patch("/api/marketing/campaigns/:id/status", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  const { status } = req.body as { status: string };
  await db.update(marketingCampaigns).set({ status } as never).where(eq(marketingCampaigns.id, id));
  res.json({ success: true });
});

router.get("/api/marketing/campaigns/:id/performance", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  res.json(await analyzePerformance(id));
});

router.get("/api/marketing/metrics", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(marketingPerformance).orderBy(desc(marketingPerformance.date)).limit(90);
  let totalSpend = 0, totalImpressions = 0, totalClicks = 0, totalConversions = 0;
  const channelTotals: Record<string, { spend: number; impressions: number; clicks: number; conversions: number }> = {};
  for (const p of rows) {
    totalSpend += parseFloat(String(p.spend ?? 0));
    totalImpressions += Number(p.impressions ?? 0);
    totalClicks += Number(p.clicks ?? 0);
    totalConversions += Number(p.conversions ?? 0);
    if (!channelTotals[p.channel]) channelTotals[p.channel] = { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
    channelTotals[p.channel].spend += parseFloat(String(p.spend ?? 0));
    channelTotals[p.channel].impressions += Number(p.impressions ?? 0);
    channelTotals[p.channel].clicks += Number(p.clicks ?? 0);
    channelTotals[p.channel].conversions += Number(p.conversions ?? 0);
  }
  res.json({
    totalSpend: totalSpend / 100,
    totalImpressions,
    totalClicks,
    totalConversions,
    avgCtr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
    avgCpc: totalClicks > 0 ? totalSpend / totalClicks / 100 : 0,
    channelBreakdown: Object.entries(channelTotals).map(([channel, t]) => ({ channel, ...t })),
    recentPerformance: rows.slice(0, 30),
  });
});

router.get("/api/marketing/activity", requireAdmin, async (req, res): Promise<void> => {
  const limit = parseInt(String(req.query["limit"] ?? "50"), 10);
  const rows = await db.select().from(marketingActivityLog).orderBy(desc(marketingActivityLog.createdAt)).limit(limit);
  res.json(rows);
});

router.post("/api/marketing/cycle", requireAdmin, async (_req, res): Promise<void> => {
  const result = await runAutonomousCycle();
  const settings = await db.select().from(marketingSettings).where(eq(marketingSettings.key, "last_cycle_at")).limit(1);
  if (settings.length > 0) {
    await db.update(marketingSettings).set({ value: new Date().toISOString() }).where(eq(marketingSettings.key, "last_cycle_at"));
  } else {
    await db.insert(marketingSettings).values({ key: "last_cycle_at", value: new Date().toISOString() } as never);
  }
  res.json(result);
});

export default router;
