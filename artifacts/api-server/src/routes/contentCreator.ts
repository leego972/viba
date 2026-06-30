import { Router, type IRouter } from "express";
import { requireAdmin } from "../middlewares/adminAuth";
import { db } from "@workspace/db";
import {
  contentCreatorCampaigns,
  contentCreatorPieces,
  contentCreatorSchedules,
  contentCreatorAnalytics,
} from "@workspace/db";
import { eq, desc, and, sql, gte, lte, count } from "drizzle-orm";
import {
  generateCreatorContent,
  bulkGenerateForCampaign,
  generateSeoContentBriefs,
  scheduleContentPiece,
  processDueSchedules,
  getContentCreatorDashboard,
  generateCampaignStrategy,
  PLATFORM_CONFIG,
  autoApproveHighQualityContent,
  runAutonomousContentCycle,
} from "../engines/contentCreatorEngine";

const router: IRouter = Router();

router.get("/api/content-creator/dashboard", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await getContentCreatorDashboard());
});

router.get("/api/content-creator/platforms", requireAdmin, async (_req, res): Promise<void> => {
  res.json(Object.entries(PLATFORM_CONFIG).map(([key, cfg]) => ({
    key,
    label: cfg.label,
    maxChars: cfg.maxChars,
    maxHashtags: cfg.hashtagCount,
    contentTypes: cfg.contentTypes,
  })));
});

router.get("/api/content-creator/seo-briefs", requireAdmin, async (req, res): Promise<void> => {
  const count_ = parseInt(String(req.query["count"] ?? "5"), 10);
  res.json(await generateSeoContentBriefs(count_));
});

router.get("/api/content-creator/campaigns", requireAdmin, async (req, res): Promise<void> => {
  const { status, limit = "20", offset = "0" } = req.query as Record<string, string>;
  let query = db.select().from(contentCreatorCampaigns).orderBy(desc(contentCreatorCampaigns.createdAt))
    .limit(parseInt(limit, 10)).offset(parseInt(offset, 10));
  if (status) query = query.where(eq(contentCreatorCampaigns.status, status)) as typeof query;
  const campaigns = await query;
  const [countRow] = await db.select({ count: count() }).from(contentCreatorCampaigns);
  res.json({ campaigns, total: Number(countRow?.count ?? 0) });
});

router.get("/api/content-creator/campaigns/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  const [campaign] = await db.select().from(contentCreatorCampaigns).where(eq(contentCreatorCampaigns.id, id)).limit(1);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json(campaign);
});

router.post("/api/content-creator/campaigns", requireAdmin, async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  let aiStrategy: string | undefined;
  if (body["generateStrategy"] && body["objective"]) {
    try { aiStrategy = await generateCampaignStrategy({ name: String(body["name"]), objective: String(body["objective"]), targetAudience: body["targetAudience"] ? String(body["targetAudience"]) : undefined }); }
    catch { /* skip */ }
  }
  const [inserted] = await db.insert(contentCreatorCampaigns).values({
    name: String(body["name"] ?? ""),
    description: body["description"] ? String(body["description"]) : undefined,
    objective: body["objective"] ? String(body["objective"]) : undefined,
    targetAudience: body["targetAudience"] ? String(body["targetAudience"]) : undefined,
    platforms: Array.isArray(body["platforms"]) ? body["platforms"] : [],
    seoKeywords: Array.isArray(body["seoKeywords"]) ? body["seoKeywords"] : [],
    brandVoice: body["brandVoice"] ? String(body["brandVoice"]) : undefined,
    aiStrategy,
    status: "draft",
    tiktokLinked: Boolean(body["tiktokLinked"]),
    seoLinked: body["seoLinked"] !== false,
    advertisingLinked: Boolean(body["advertisingLinked"]),
    startDate: body["startDate"] ? new Date(String(body["startDate"])) : undefined,
    endDate: body["endDate"] ? new Date(String(body["endDate"])) : undefined,
  } as never).returning({ id: contentCreatorCampaigns.id });
  res.json({ id: inserted?.id, success: true });
});

router.patch("/api/content-creator/campaigns/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  const updates = req.body as Record<string, unknown>;
  const filtered = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
  if (Object.keys(filtered).length > 0) {
    await db.update(contentCreatorCampaigns).set(filtered as never).where(eq(contentCreatorCampaigns.id, id));
  }
  res.json({ success: true });
});

router.delete("/api/content-creator/campaigns/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  await db.update(contentCreatorCampaigns).set({ status: "archived" } as never).where(eq(contentCreatorCampaigns.id, id));
  res.json({ success: true });
});

router.post("/api/content-creator/campaigns/:id/strategy", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  const { name, objective, targetAudience } = req.body as { name: string; objective: string; targetAudience?: string };
  const strategy = await generateCampaignStrategy({ name, objective, targetAudience });
  await db.update(contentCreatorCampaigns).set({ aiStrategy: strategy } as never).where(eq(contentCreatorCampaigns.id, id));
  res.json({ strategy });
});

router.post("/api/content-creator/generate", requireAdmin, async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const content = await generateCreatorContent({
    platform: String(body["platform"] ?? "linkedin"),
    contentType: String(body["contentType"] ?? "social_post"),
    topic: body["topic"] ? String(body["topic"]) : undefined,
    campaignObjective: body["campaignObjective"] ? String(body["campaignObjective"]) : undefined,
    seoKeywords: Array.isArray(body["seoKeywords"]) ? body["seoKeywords"] : [],
    brandVoice: body["brandVoice"] ? String(body["brandVoice"]) : undefined,
    includeImage: Boolean(body["includeImage"]),
    campaignId: body["campaignId"] ? Number(body["campaignId"]) : undefined,
  });
  let pieceId: number | undefined;
  if (body["saveToDb"] !== false) {
    const [inserted] = await db.insert(contentCreatorPieces).values({
      campaignId: body["campaignId"] ? Number(body["campaignId"]) : undefined,
      platform: String(body["platform"] ?? "linkedin"),
      contentType: String(body["contentType"] ?? "social_post"),
      title: content.title,
      headline: content.headline,
      body: content.body,
      callToAction: content.callToAction,
      hashtags: content.hashtags,
      hook: content.hook,
      videoScript: content.videoScript,
      visualDirections: content.visualDirections,
      seoKeywords: content.seoKeywords,
      imagePrompt: content.imagePrompt,
      seoScore: content.seoScore,
      qualityScore: content.qualityScore,
      status: "draft",
      aiPrompt: body["topic"] ? String(body["topic"]) : "Single piece generation",
      aiModel: "groq/llama-3.3-70b",
      generationMs: content.generationMs,
    } as never).returning({ id: contentCreatorPieces.id });
    pieceId = inserted?.id;
    if (body["campaignId"]) {
      await db.update(contentCreatorCampaigns)
        .set({ totalPieces: sql`total_pieces + 1` })
        .where(eq(contentCreatorCampaigns.id, Number(body["campaignId"])));
    }
  }
  res.json({ ...content, pieceId });
});

router.post("/api/content-creator/bulk-generate", requireAdmin, async (req, res): Promise<void> => {
  const { campaignId, platforms, topic, seoKeywords, includeImages } = req.body as Record<string, unknown>;
  res.json(await bulkGenerateForCampaign({
    campaignId: Number(campaignId),
    platforms: Array.isArray(platforms) ? platforms : [],
    topic: topic ? String(topic) : undefined,
    seoKeywords: Array.isArray(seoKeywords) ? seoKeywords : [],
    includeImages: Boolean(includeImages),
  }));
});

router.get("/api/content-creator/pieces", requireAdmin, async (req, res): Promise<void> => {
  const { campaignId, platform, status, limit = "20", offset = "0" } = req.query as Record<string, string>;
  const conditions = [];
  if (campaignId) conditions.push(eq(contentCreatorPieces.campaignId, parseInt(campaignId, 10)));
  if (platform) conditions.push(eq(contentCreatorPieces.platform, platform));
  if (status) conditions.push(eq(contentCreatorPieces.status, status));
  const pieces = await db.select().from(contentCreatorPieces)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(contentCreatorPieces.createdAt))
    .limit(parseInt(limit, 10)).offset(parseInt(offset, 10));
  const [countRow] = await db.select({ count: count() }).from(contentCreatorPieces)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  res.json({ pieces, total: Number(countRow?.count ?? 0) });
});

router.get("/api/content-creator/pieces/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  const [piece] = await db.select().from(contentCreatorPieces).where(eq(contentCreatorPieces.id, id)).limit(1);
  if (!piece) { res.status(404).json({ error: "Piece not found" }); return; }
  res.json(piece);
});

router.patch("/api/content-creator/pieces/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  const updates = req.body as Record<string, unknown>;
  const filtered = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
  if (Object.keys(filtered).length > 0) {
    await db.update(contentCreatorPieces).set(filtered as never).where(eq(contentCreatorPieces.id, id));
  }
  res.json({ success: true });
});

router.patch("/api/content-creator/pieces/:id/status", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  const { status } = req.body as { status: string };
  await db.update(contentCreatorPieces).set({ status } as never).where(eq(contentCreatorPieces.id, id));
  res.json({ success: true });
});

router.post("/api/content-creator/pieces/:id/approve", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  await db.update(contentCreatorPieces).set({ status: "approved" } as never).where(eq(contentCreatorPieces.id, id));
  res.json({ success: true });
});

router.post("/api/content-creator/pieces/:id/reject", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  await db.update(contentCreatorPieces).set({ status: "archived" } as never).where(eq(contentCreatorPieces.id, id));
  res.json({ success: true });
});

router.delete("/api/content-creator/pieces/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  await db.update(contentCreatorPieces).set({ status: "archived" } as never).where(eq(contentCreatorPieces.id, id));
  res.json({ success: true });
});

router.post("/api/content-creator/schedule", requireAdmin, async (req, res): Promise<void> => {
  const { pieceId, scheduledAt, campaignId } = req.body as { pieceId: number; scheduledAt: string; campaignId?: number };
  res.json(await scheduleContentPiece({ pieceId, scheduledAt: new Date(scheduledAt), campaignId }));
});

router.get("/api/content-creator/schedules", requireAdmin, async (req, res): Promise<void> => {
  const { campaignId, platform, status, from, to, limit = "50" } = req.query as Record<string, string>;
  const conditions = [];
  if (campaignId) conditions.push(eq(contentCreatorSchedules.campaignId, parseInt(campaignId, 10)));
  if (platform) conditions.push(eq(contentCreatorSchedules.platform, platform));
  if (status) conditions.push(eq(contentCreatorSchedules.status, status));
  if (from) conditions.push(gte(contentCreatorSchedules.scheduledAt, new Date(from)));
  if (to) conditions.push(lte(contentCreatorSchedules.scheduledAt, new Date(to)));
  const schedules = await db.select().from(contentCreatorSchedules)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(contentCreatorSchedules.scheduledAt)
    .limit(parseInt(limit, 10));
  res.json(schedules);
});

router.delete("/api/content-creator/schedules/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  await db.update(contentCreatorSchedules).set({ status: "cancelled" } as never).where(eq(contentCreatorSchedules.id, id));
  res.json({ success: true });
});

router.post("/api/content-creator/schedules/process-due", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await processDueSchedules());
});

router.post("/api/content-creator/autonomous-cycle", requireAdmin, async (req, res): Promise<void> => {
  const { maxPiecesPerPlatform = 2, autoApproveThreshold = 75, autoSchedule = true } = req.body as Record<string, unknown>;
  res.json(await runAutonomousContentCycle({
    maxPiecesPerPlatform: Number(maxPiecesPerPlatform),
    autoApproveThreshold: Number(autoApproveThreshold),
    autoSchedule: Boolean(autoSchedule),
  }));
});

router.post("/api/content-creator/auto-approve", requireAdmin, async (req, res): Promise<void> => {
  const { threshold = 75 } = req.body as { threshold?: number };
  res.json(await autoApproveHighQualityContent(Number(threshold)));
});

export default router;
