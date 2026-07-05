import { db } from "@workspace/db";
import {
  marketingActivityLog,
  marketingContent,
  marketingSettings,
  contentCreatorPieces,
  contentCreatorSchedules,
} from "@workspace/db";
import { and, desc, eq, lt } from "drizzle-orm";
import { logger } from "../lib/logger";
import { generateBlastContent } from "./advertisingEngine";
import { runAutonomousContentCycle, generateCreatorContent } from "./contentCreatorEngine";
import { runScheduledSeoOptimization, submitToIndexNow } from "./seoEngine";

const log = logger;

const DEFAULT_ENABLED = process.env["VIBA_AUTONOMOUS_GROWTH_ENABLED"] !== "false";
const DEFAULT_INTERVAL_MINUTES = Math.max(30, Number(process.env["VIBA_GROWTH_INTERVAL_MINUTES"] ?? 360));
const DEFAULT_FREE_CHANNELS = ["blog", "linkedin", "x_twitter", "reddit", "devto", "discord", "youtube_shorts"];
const DEFAULT_AUTO_PUBLISH_CHANNELS = ["blog", "discord", "devto"];
const DEFAULT_GENERATE_CHANNELS = ["blog", "linkedin", "x_twitter", "reddit", "devto", "discord", "youtube_shorts"];
const SITE_URL = process.env["PUBLIC_SITE_URL"] ?? "https://viba.guru";

type GrowthSettingMap = Record<string, string>;

type PublishResult = {
  contentId: number;
  platform: string;
  status: "published" | "queued" | "failed";
  publishedUrl?: string;
  reason?: string;
};

type GrowthCycleResult = {
  success: boolean;
  generated: number;
  published: number;
  queued: number;
  failed: number;
  results: PublishResult[];
  message: string;
};

let growthInterval: ReturnType<typeof setInterval> | null = null;
let growthRunning = false;
let growthCycleCount = 0;
let growthLastRun: Date | null = null;
let growthNextRun: Date | null = null;
let growthLastResult: GrowthCycleResult | null = null;

function splitList(value: string | undefined, fallback: string[]) {
  return (value ?? fallback.join(",")).split(",").map((v) => v.trim()).filter(Boolean);
}

async function getSettings(): Promise<GrowthSettingMap> {
  try {
    const rows = await db.select().from(marketingSettings);
    const map: GrowthSettingMap = {};
    for (const row of rows) map[row.key] = row.value ?? "";
    return map;
  } catch {
    return {};
  }
}

async function setSetting(key: string, value: string) {
  const existing = await db.select().from(marketingSettings).where(eq(marketingSettings.key, key)).limit(1);
  if (existing.length > 0) {
    await db.update(marketingSettings).set({ value, updatedAt: new Date() } as never).where(eq(marketingSettings.key, key));
  } else {
    await db.insert(marketingSettings).values({ key, value } as never);
  }
}

async function logActivity(action: string, description: string, status = "success", details?: unknown) {
  try {
    await db.insert(marketingActivityLog).values({ action, description, status, details: details as never } as never);
  } catch (err) {
    log.warn({ err }, "Failed to write growth activity log");
  }
}

export async function updateAutonomousGrowthSettings(input: { enabled?: boolean; intervalMinutes?: number; freeChannels?: string[]; autoPublishChannels?: string[]; maxPiecesPerCycle?: number; autoApproveThreshold?: number }) {
  if (input.enabled !== undefined) await setSetting("growth_enabled", String(input.enabled));
  if (input.intervalMinutes !== undefined) await setSetting("growth_interval_minutes", String(Math.max(30, input.intervalMinutes)));
  if (input.freeChannels !== undefined) await setSetting("growth_free_channels", input.freeChannels.join(","));
  if (input.autoPublishChannels !== undefined) await setSetting("growth_auto_publish_channels", input.autoPublishChannels.join(","));
  if (input.maxPiecesPerCycle !== undefined) await setSetting("growth_max_pieces_per_cycle", String(Math.max(1, input.maxPiecesPerCycle)));
  if (input.autoApproveThreshold !== undefined) await setSetting("growth_auto_approve_threshold", String(Math.max(0, Math.min(100, input.autoApproveThreshold))));
  return getAutonomousGrowthStatus();
}

export async function getAutonomousGrowthStatus() {
  const settings = await getSettings();
  const enabled = (settings["growth_enabled"] ?? String(DEFAULT_ENABLED)) === "true";
  const intervalMinutes = Math.max(30, Number(settings["growth_interval_minutes"] ?? DEFAULT_INTERVAL_MINUTES));
  const freeChannels = splitList(settings["growth_free_channels"], DEFAULT_FREE_CHANNELS);
  const autoPublishChannels = splitList(settings["growth_auto_publish_channels"], DEFAULT_AUTO_PUBLISH_CHANNELS);
  const maxPiecesPerCycle = Math.max(1, Number(settings["growth_max_pieces_per_cycle"] ?? 6));
  const autoApproveThreshold = Math.max(0, Math.min(100, Number(settings["growth_auto_approve_threshold"] ?? 82)));
  return {
    enabled,
    schedulerActive: growthInterval !== null,
    active: growthInterval !== null,
    currentlyRunning: growthRunning,
    cycleCount: growthCycleCount,
    lastRun: growthLastRun?.toISOString() ?? null,
    nextRun: growthNextRun?.toISOString() ?? null,
    lastResult: growthLastResult,
    intervalMinutes,
    maxPiecesPerCycle,
    autoApproveThreshold,
    freeChannels,
    autoPublishChannels,
    channelConnections: getFreeChannelConnectionStatus(),
    notes: [
      "Free channels are prioritised. Paid ads are not launched by this scheduler.",
      "Blog publishing is internal and automatic.",
      "Discord and Dev.to publish automatically only when their environment keys are configured.",
      "LinkedIn, X/Twitter, Reddit and YouTube Shorts generate approved/queued VIBA-only content unless a publisher is configured.",
    ],
  };
}

export function getFreeChannelConnectionStatus() {
  return [
    { id: "blog", name: "VIBA Blog / Owned SEO", connected: true, envKey: null, mode: "internal_publish" },
    { id: "discord", name: "Discord Webhook", connected: !!process.env["DISCORD_WEBHOOK_URL"], envKey: "DISCORD_WEBHOOK_URL", mode: "auto_publish_if_configured" },
    { id: "devto", name: "Dev.to", connected: !!process.env["DEVTO_API_KEY"], envKey: "DEVTO_API_KEY", mode: "auto_publish_if_configured" },
    { id: "linkedin", name: "LinkedIn Organic", connected: !!process.env["LINKEDIN_ACCESS_TOKEN"], envKey: "LINKEDIN_ACCESS_TOKEN", mode: "queue_without_publisher" },
    { id: "x_twitter", name: "X/Twitter Organic", connected: !!process.env["TWITTER_API_KEY"], envKey: "TWITTER_API_KEY", mode: "queue_without_publisher" },
    { id: "reddit", name: "Reddit Communities", connected: !!process.env["REDDIT_CLIENT_ID"], envKey: "REDDIT_CLIENT_ID", mode: "queue_without_publisher" },
    { id: "youtube_shorts", name: "YouTube Shorts", connected: !!process.env["YOUTUBE_CLIENT_ID"], envKey: "YOUTUBE_CLIENT_ID", mode: "queue_without_publisher" },
  ];
}

function normalizeAdvertisingPlatform(platform: string) {
  if (platform === "twitter") return "x_twitter";
  if (platform === "dev.to") return "devto";
  return platform;
}

async function ensureMarketingContentForChannels(channels: string[], maxPieces: number) {
  const generatedIds: number[] = [];
  const blastChannels = channels.filter((c) => ["linkedin", "x_twitter", "reddit", "devto", "discord"].includes(c));
  if (blastChannels.length > 0) {
    const blast = await generateBlastContent(blastChannels.slice(0, maxPieces));
    for (const result of blast.results ?? []) {
      if (result.success && result.contentId) generatedIds.push(result.contentId);
    }
  }

  if (channels.includes("blog")) {
    const content = await generateCreatorContent({
      platform: "blog",
      contentType: "blog_article",
      topic: "How VIBA combines UI testing, beta testing, repo testing, report generation, applied repairs and multi-AI collaboration",
      campaignObjective: "organic SEO and qualified VIBA leads",
      seoKeywords: ["VIBA", "UI testing", "beta testing", "repo testing", "AI report generation", "applied repairs", "multi-AI collaboration"],
    });
    const [inserted] = await db.insert(marketingContent).values({
      platform: "blog",
      type: "blog_article",
      headline: content.title || content.headline,
      body: [content.headline, content.body, content.callToAction].filter(Boolean).join("\n\n"),
      hashtags: content.hashtags,
      callToAction: content.callToAction,
      imagePrompt: content.imagePrompt,
      status: "approved",
    } as never).returning({ id: marketingContent.id });
    if (inserted?.id) generatedIds.push(inserted.id);
  }

  if (channels.includes("youtube_shorts")) {
    const content = await generateCreatorContent({
      platform: "youtube_shorts",
      contentType: "video_script",
      topic: "Watch VIBA delegate UI testing, repo testing, report generation and applied repairs across multiple AIs",
      campaignObjective: "show VIBA's live task delegation and performance value",
      seoKeywords: ["VIBA", "live AI task delegation", "multiple AIs in one place", "UI testing", "repo testing", "applied repairs"],
    });
    const [inserted] = await db.insert(marketingContent).values({
      platform: "youtube_shorts",
      type: "video_script",
      headline: content.title || content.hook || content.headline,
      body: [content.hook, content.videoScript ?? content.body, content.visualDirections, content.callToAction].filter(Boolean).join("\n\n"),
      hashtags: content.hashtags,
      callToAction: content.callToAction,
      imagePrompt: content.imagePrompt,
      status: "approved",
    } as never).returning({ id: marketingContent.id });
    if (inserted?.id) generatedIds.push(inserted.id);
  }
  return generatedIds;
}

async function publishToDiscord(item: typeof marketingContent.$inferSelect): Promise<PublishResult> {
  const webhook = process.env["DISCORD_WEBHOOK_URL"];
  if (!webhook) return { contentId: item.id, platform: item.platform, status: "queued", reason: "DISCORD_WEBHOOK_URL not configured" };
  const message = [`**${item.headline ?? "VIBA update"}**`, item.body ?? "", item.callToAction ?? "", Array.isArray(item.hashtags) ? item.hashtags.join(" ") : ""].filter(Boolean).join("\n\n");
  const res = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: message.slice(0, 1900) }) });
  if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}`);
  return { contentId: item.id, platform: item.platform, status: "published", publishedUrl: "discord:webhook" };
}

async function publishToDevTo(item: typeof marketingContent.$inferSelect): Promise<PublishResult> {
  const apiKey = process.env["DEVTO_API_KEY"];
  if (!apiKey) return { contentId: item.id, platform: item.platform, status: "queued", reason: "DEVTO_API_KEY not configured" };
  const tags = Array.isArray(item.hashtags) ? item.hashtags.map((tag) => tag.replace(/^#/, "").toLowerCase()).filter(Boolean).slice(0, 4) : ["ai", "webdev", "saas"];
  const res = await fetch("https://dev.to/api/articles", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({ article: { title: item.headline ?? "VIBA: UI testing, repo testing and multi-AI repairs", published: true, tags, body_markdown: `${item.body ?? ""}\n\n${item.callToAction ?? `Try VIBA: ${SITE_URL}`}` } }),
  });
  if (!res.ok) throw new Error(`Dev.to publish failed: ${res.status}`);
  const data = await res.json().catch(() => ({})) as { url?: string };
  return { contentId: item.id, platform: item.platform, status: "published", publishedUrl: data.url ?? "devto:published" };
}

async function publishInternally(item: typeof marketingContent.$inferSelect): Promise<PublishResult> {
  const publishedUrl = `${SITE_URL}/growth/${item.id}`;
  await submitToIndexNow([publishedUrl]);
  return { contentId: item.id, platform: item.platform, status: "published", publishedUrl };
}

async function publishContentItem(item: typeof marketingContent.$inferSelect, autoPublishChannels: string[]): Promise<PublishResult> {
  const platform = normalizeAdvertisingPlatform(item.platform);
  if (!autoPublishChannels.includes(platform)) return { contentId: item.id, platform, status: "queued", reason: "Channel not enabled for auto-publish" };
  if (platform === "blog") return publishInternally(item);
  if (platform === "discord") return publishToDiscord(item);
  if (platform === "devto") return publishToDevTo(item);
  return { contentId: item.id, platform, status: "queued", reason: "Publisher not implemented or credentials require manual OAuth" };
}

export async function publishApprovedFreeContent(limit = 20, autoPublishChannels = DEFAULT_AUTO_PUBLISH_CHANNELS): Promise<PublishResult[]> {
  const rows = await db.select().from(marketingContent).where(eq(marketingContent.status, "approved")).orderBy(desc(marketingContent.createdAt)).limit(limit);
  const results: PublishResult[] = [];
  for (const item of rows) {
    try {
      const result = await publishContentItem(item, autoPublishChannels);
      results.push(result);
      if (result.status === "published") {
        await db.update(marketingContent).set({ status: "published", publishedUrl: result.publishedUrl, publishedAt: new Date() } as never).where(eq(marketingContent.id, item.id));
      } else if (result.status === "queued") {
        await db.update(marketingContent).set({ status: "queued" } as never).where(eq(marketingContent.id, item.id));
      }
    } catch (err) {
      const reason = String(err);
      results.push({ contentId: item.id, platform: item.platform, status: "failed", reason });
      await db.update(marketingContent).set({ status: "draft" } as never).where(eq(marketingContent.id, item.id));
      await logActivity("free_channel_publish_failed", `${item.platform}: ${reason}`, "failed", { contentId: item.id });
    }
  }
  return results;
}

export async function processCreatorSchedulesWithPublishing() {
  const due = await db.select().from(contentCreatorSchedules).where(and(eq(contentCreatorSchedules.status, "pending"), lt(contentCreatorSchedules.scheduledAt, new Date())));
  let processed = 0;
  for (const schedule of due) {
    const [piece] = await db.select().from(contentCreatorPieces).where(eq(contentCreatorPieces.id, schedule.pieceId)).limit(1);
    if (!piece) {
      await db.update(contentCreatorSchedules).set({ status: "failed", error: "Content piece not found" } as never).where(eq(contentCreatorSchedules.id, schedule.id));
      continue;
    }
    const [inserted] = await db.insert(marketingContent).values({
      platform: normalizeAdvertisingPlatform(piece.platform),
      type: piece.contentType,
      headline: piece.headline ?? piece.title,
      body: piece.body,
      hashtags: piece.hashtags,
      callToAction: piece.callToAction,
      imagePrompt: piece.imagePrompt,
      status: "approved",
    } as never).returning({ id: marketingContent.id });
    await db.update(contentCreatorSchedules).set({ status: "published", publishedAt: new Date() } as never).where(eq(contentCreatorSchedules.id, schedule.id));
    await db.update(contentCreatorPieces).set({ status: "published", publishedAt: new Date() } as never).where(eq(contentCreatorPieces.id, piece.id));
    processed += inserted?.id ? 1 : 0;
  }
  return { processed, total: due.length };
}

export async function runAutonomousGrowthCycle(source = "manual"): Promise<GrowthCycleResult> {
  if (growthRunning) return growthLastResult ?? { success: false, generated: 0, published: 0, queued: 0, failed: 0, results: [], message: "Growth cycle already running" };
  growthRunning = true;
  try {
    const settings = await getSettings();
    const freeChannels = splitList(settings["growth_free_channels"], DEFAULT_GENERATE_CHANNELS);
    const autoPublishChannels = splitList(settings["growth_auto_publish_channels"], DEFAULT_AUTO_PUBLISH_CHANNELS);
    const maxPiecesPerCycle = Math.max(1, Number(settings["growth_max_pieces_per_cycle"] ?? 6));
    const autoApproveThreshold = Math.max(0, Math.min(100, Number(settings["growth_auto_approve_threshold"] ?? 82)));
    await runScheduledSeoOptimization();
    await runAutonomousContentCycle({ maxPiecesPerPlatform: Math.min(2, maxPiecesPerCycle), autoApproveThreshold, autoSchedule: true });
    const generatedIds = await ensureMarketingContentForChannels(freeChannels, maxPiecesPerCycle);
    await processCreatorSchedulesWithPublishing();
    const publishResults = await publishApprovedFreeContent(maxPiecesPerCycle * 2, autoPublishChannels);
    const result: GrowthCycleResult = {
      success: true,
      generated: generatedIds.length,
      published: publishResults.filter((r) => r.status === "published").length,
      queued: publishResults.filter((r) => r.status === "queued").length,
      failed: publishResults.filter((r) => r.status === "failed").length,
      results: publishResults,
      message: `VIBA autonomous growth cycle complete from ${source}`,
    };
    growthCycleCount++;
    growthLastRun = new Date();
    growthLastResult = result;
    await setSetting("last_growth_cycle_at", growthLastRun.toISOString());
    await logActivity("autonomous_growth_cycle", result.message, "success", result);
    return result;
  } catch (err) {
    const result: GrowthCycleResult = { success: false, generated: 0, published: 0, queued: 0, failed: 1, results: [], message: String(err) };
    growthLastResult = result;
    await logActivity("autonomous_growth_cycle_failed", String(err), "failed");
    return result;
  } finally {
    growthRunning = false;
  }
}

export async function startAutonomousGrowthScheduler() {
  const settings = await getSettings();
  const enabled = (settings["growth_enabled"] ?? String(DEFAULT_ENABLED)) === "true";
  const intervalMinutes = Math.max(30, Number(settings["growth_interval_minutes"] ?? DEFAULT_INTERVAL_MINUTES));
  if (!enabled) {
    log.info("[Growth] Autonomous growth scheduler disabled by settings");
    return getAutonomousGrowthStatus();
  }
  if (growthInterval) return getAutonomousGrowthStatus();
  const intervalMs = intervalMinutes * 60 * 1000;
  growthNextRun = new Date(Date.now() + intervalMs);
  growthInterval = setInterval(() => {
    runAutonomousGrowthCycle("scheduler").catch((err) => log.error({ err }, "Autonomous growth scheduler failed"));
    growthNextRun = new Date(Date.now() + intervalMs);
  }, intervalMs);
  log.info({ intervalMinutes }, "[Growth] Autonomous growth scheduler started");
  setTimeout(() => runAutonomousGrowthCycle("startup").catch((err) => log.error({ err }, "Startup growth cycle failed")), 30_000);
  return getAutonomousGrowthStatus();
}

export async function stopAutonomousGrowthScheduler() {
  if (growthInterval) {
    clearInterval(growthInterval);
    growthInterval = null;
    growthNextRun = null;
  }
  await setSetting("growth_enabled", "false");
  await logActivity("autonomous_growth_scheduler_stopped", "Autonomous growth scheduler stopped");
  return getAutonomousGrowthStatus();
}

export async function restartAutonomousGrowthScheduler() {
  if (growthInterval) {
    clearInterval(growthInterval);
    growthInterval = null;
  }
  await setSetting("growth_enabled", "true");
  return startAutonomousGrowthScheduler();
}
