/**
 * VIBA Advertising Orchestrator
 * Ported from virellestudios/advertising-orchestrator — adapted for VIBA
 */
import { db } from "@workspace/db";
import {
  marketingContent,
  marketingActivityLog,
  marketingCampaigns,
  marketingPerformance,
} from "@workspace/db";
import { eq, desc, and, gte, sql, count } from "drizzle-orm";
import { invokeLLM, safeJsonExtract } from "./vibaLLM";
import { getAllChannelStatuses } from "./marketingEngine";
import { runAutonomousContentCycle, processDueSchedules } from "./contentCreatorEngine";
import { runScheduledSeoOptimization } from "./seoEngine";
import { logger } from "../lib/logger";

const log = logger;

const ORGANIC_GROWTH_INTERVAL_HOURS = Number(process.env["VIBA_ORGANIC_GROWTH_INTERVAL_HOURS"] ?? "24");
const ORGANIC_GROWTH_INTERVAL_MS = Math.max(6, ORGANIC_GROWTH_INTERVAL_HOURS) * 60 * 60 * 1000;
const SAFE_AUTONOMOUS_CHANNELS = ["seo_organic", "youtube_shorts", "linkedin_organic", "twitter_organic", "blog", "dev_to_blog", "reddit_communities", "email_nurture"];
const BLOCKED_AUTONOMOUS_CHANNELS = ["tiktok", "snapchat", "paid_ads_without_approval"];

export const GROWTH_STRATEGIES = [
  { channel: "seo_organic", costPerMonth: 0, frequency: "continuous", expectedImpact: "high", automatable: true, description: "Organic search via content & technical SEO" },
  { channel: "youtube_shorts", costPerMonth: 0, frequency: "weekly", expectedImpact: "high", automatable: true, description: "Short-form educational demos and audit walkthrough scripts for YouTube" },
  { channel: "linkedin_organic", costPerMonth: 0, frequency: "daily", expectedImpact: "high", automatable: true, description: "LinkedIn posts targeting founders, developers, agencies and technical operators" },
  { channel: "twitter_organic", costPerMonth: 0, frequency: "daily", expectedImpact: "medium", automatable: true, description: "X posts, short threads, build-in-public updates and AI workflow tips" },
  { channel: "blog", costPerMonth: 0, frequency: "weekly", expectedImpact: "high", automatable: true, description: "SEO articles targeting website audits, AI orchestration, broken UI checks and multi-agent workflows" },
  { channel: "reddit_communities", costPerMonth: 0, frequency: "weekly", expectedImpact: "medium", automatable: false, description: "Value-first posts for relevant business, SaaS, startup and developer communities; manual posting recommended" },
  { channel: "dev_to_blog", costPerMonth: 0, frequency: "weekly", expectedImpact: "medium", automatable: true, description: "Technical blog posts on dev.to" },
  { channel: "email_nurture", costPerMonth: 0, frequency: "weekly", expectedImpact: "high", automatable: true, description: "Onboarding and re-engagement email sequences" },
  { channel: "google_ads", costPerMonth: 0, frequency: "manual_only", expectedImpact: "high", automatable: false, description: "Disabled by default. Requires explicit owner approval and budget cap before spend." },
  { channel: "linkedin_ads", costPerMonth: 0, frequency: "manual_only", expectedImpact: "medium", automatable: false, description: "Disabled by default. Requires explicit owner approval and budget cap before spend." },
];

const _abTests: Record<string, { channel: string; variantA: string; variantB: string; aWins: number; bWins: number; createdAt: Date }> = {};

export function getStrategyOverview() {
  const freeChannels = GROWTH_STRATEGIES.filter(s => s.costPerMonth === 0 && s.frequency !== "manual_only");
  const paidChannels = GROWTH_STRATEGIES.filter(s => s.frequency === "manual_only");
  const totalBudget = GROWTH_STRATEGIES.reduce((sum, s) => sum + s.costPerMonth, 0);

  return {
    monthlyBudget: totalBudget,
    currency: "USD",
    freeChannelCount: freeChannels.length,
    paidChannelCount: paidChannels.length,
    budgetAllocation: paidChannels.map(s => ({ channel: s.channel, amount: s.costPerMonth, mode: "manual approval required" })),
    strategy: "100% free organic growth until paid ads are explicitly approved by the owner",
    topOpportunities: ["SEO content hub", "YouTube Shorts demos", "LinkedIn organic", "Developer/community content"],
    safeAutonomousChannels: SAFE_AUTONOMOUS_CHANNELS,
    blockedAutonomousChannels: BLOCKED_AUTONOMOUS_CHANNELS,
  };
}

export async function getPerformanceMetrics(days: number) {
  try {
    const rows = await db.select().from(marketingPerformance).orderBy(desc(marketingPerformance.createdAt)).limit(days);
    const totals = rows.reduce((acc, r) => ({
      impressions: acc.impressions + Number(r.impressions ?? 0),
      clicks: acc.clicks + Number(r.clicks ?? 0),
      conversions: acc.conversions + Number(r.conversions ?? 0),
      spend: acc.spend + parseFloat(String(r.spend ?? 0)),
    }), { impressions: 0, clicks: 0, conversions: 0, spend: 0 });

    return {
      ...totals,
      ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : 0,
      cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0,
      daysAnalyzed: days,
      budgetUtilization: 0,
    };
  } catch {
    return { impressions: 0, clicks: 0, conversions: 0, spend: 0, ctr: 0, cpc: 0, daysAnalyzed: days, budgetUtilization: 0 };
  }
}

export async function getRecentActivity(limit: number) {
  try {
    return await db.select().from(marketingActivityLog).orderBy(desc(marketingActivityLog.createdAt)).limit(limit);
  } catch {
    return [];
  }
}

export async function runAdvertisingCycle() {
  log.info("[AdvertisingEngine] Running advertising cycle");
  const results: string[] = [];

  try {
    const prompt = `Generate 6 short marketing content pieces for VIBA at https://viba.guru.
VIBA focus: multi-agent AI orchestration, website UI checks, broken button detection, code/repo review, AI collaboration and professional reports.
Platforms must be: linkedin, x_twitter, youtube_shorts, blog, reddit, devto.
Do not generate TikTok or Snapchat content.
Do not create paid ads or imply paid spend.
Return JSON: [{ "platform": "linkedin|x_twitter|youtube_shorts|blog|reddit|devto", "headline": "...", "body": "...", "hashtags": ["..."], "callToAction": "..." }]`;

    const raw = await invokeLLM(prompt, "You are a lean B2B SaaS growth marketer. Return valid JSON only.");
    const posts = safeJsonExtract(raw) as { platform: string; headline: string; body: string; hashtags: string[]; callToAction: string }[] | null;

    if (posts && Array.isArray(posts)) {
      for (const post of posts) {
        if (["tiktok", "snapchat"].includes(post.platform)) continue;

        await db.insert(marketingContent).values({
          platform: post.platform,
          type: post.platform === "youtube_shorts" ? "video_script" : post.platform === "blog" || post.platform === "devto" ? "blog_article" : "organic_post",
          headline: post.headline,
          body: post.body,
          hashtags: post.hashtags,
          callToAction: post.callToAction,
          status: "draft",
        } as never);
        results.push(`Generated ${post.platform} content`);
      }
    }

    await db.insert(marketingActivityLog).values({
      action: "advertising_cycle",
      description: `Organic cycle generated ${results.length} content pieces`,
      status: "success",
    } as never);

    return { success: true, postsGenerated: results.length, results };
  } catch (err) {
    log.error("[AdvertisingEngine] Cycle failed");
    return { success: false, postsGenerated: 0, results: [], error: String(err) };
  }
}

export async function runOrganicGrowthAutopilotCycle() {
  log.info("[AdvertisingEngine] Running VIBA organic growth autopilot cycle");

  const seo = await runScheduledSeoOptimization().catch((err) => ({ ran: false, score: 0, error: String(err) }));
  const advertising = await runAdvertisingCycle();
  const content = await runAutonomousContentCycle({
    maxPiecesPerPlatform: Number(process.env["VIBA_CONTENT_PIECES_PER_CYCLE"] ?? "4"),
    autoApproveThreshold: Number(process.env["VIBA_CONTENT_AUTO_APPROVE_THRESHOLD"] ?? "82"),
    autoSchedule: true,
  });
  const schedules = await processDueSchedules().catch((err) => ({ processed: 0, total: 0, error: String(err) }));

  await db.insert(marketingActivityLog).values({
    action: "organic_growth_autopilot_cycle",
    description: `SEO: ${"ran" in seo ? seo.ran : false}; advertising drafts: ${advertising.postsGenerated}; creator pieces: ${content.generated}; schedules processed: ${schedules.processed}`,
    status: advertising.success && content.success ? "success" : "partial",
  } as never);

  return { success: advertising.success && content.success, seo, advertising, content, schedules };
}

export function getChannelPerformanceReport() {
  return getAllChannelStatuses().map(ch => ({
    ...ch,
    successRate: ch.connected ? 0.95 : 0,
    avgLatencyMs: ch.connected ? 450 : 0,
    throttled: false,
    lastUsed: null,
  }));
}

export async function getCrossChannelAttribution(days: number) {
  return GROWTH_STRATEGIES.slice(0, 8).map(s => ({
    channel: s.channel,
    attributedConversions: 0,
    assistedConversions: 0,
    revenue: 0,
    estimatedValue: s.costPerMonth > 0 ? `Paid: $${s.costPerMonth}/mo` : "Free/manual-safe",
  }));
}

export function getActiveABTests() {
  return Object.entries(_abTests).map(([id, t]) => ({ id, ...t }));
}

export function createABTest(channel: string, variantADesc: string, variantBDesc: string) {
  const id = `ab_${Date.now()}`;
  _abTests[id] = { channel, variantA: variantADesc, variantB: variantBDesc, aWins: 0, bWins: 0, createdAt: new Date() };
  return { id, channel, variantA: variantADesc, variantB: variantBDesc };
}

export function recordABTestResult(testId: string, variant: "A" | "B", success: boolean) {
  if (!_abTests[testId]) return;
  if (success) {
    if (variant === "A") _abTests[testId].aWins++;
    else _abTests[testId].bWins++;
  }
}

let _schedulerInterval: ReturnType<typeof setInterval> | null = null;
let _schedulerRunning = false;
let _lastAutopilotRun: Date | null = null;
let _nextAutopilotRun: Date | null = null;
let _autopilotCycleCount = 0;

async function runScheduledAutopilotCycle() {
  if (_schedulerRunning) return;
  _schedulerRunning = true;
  try {
    await runOrganicGrowthAutopilotCycle();
    _lastAutopilotRun = new Date();
    _nextAutopilotRun = new Date(Date.now() + ORGANIC_GROWTH_INTERVAL_MS);
    _autopilotCycleCount++;
    log.info(`[AdvertisingEngine] Organic growth autopilot cycle #${_autopilotCycleCount} complete. Next: ${_nextAutopilotRun.toISOString()}`);
  } catch (err) {
    log.error(`[AdvertisingEngine] Organic growth autopilot scheduled cycle error: ${String(err)}`);
  } finally {
    _schedulerRunning = false;
  }
}

export function startAdvertisingScheduler() {
  if (_schedulerInterval) return;
  runScheduledAutopilotCycle().catch(err => log.error(`[AdvertisingEngine] Initial autopilot cycle error: ${String(err)}`));
  _nextAutopilotRun = new Date(Date.now() + ORGANIC_GROWTH_INTERVAL_MS);
  _schedulerInterval = setInterval(() => {
    runScheduledAutopilotCycle().catch(err => log.error(`[AdvertisingEngine] Scheduled cycle error: ${String(err)}`));
  }, ORGANIC_GROWTH_INTERVAL_MS);
  log.info(`[AdvertisingEngine] Organic growth autopilot scheduler started (${ORGANIC_GROWTH_INTERVAL_MS / (60 * 60 * 1000)}h interval)`);
}

export function stopAdvertisingScheduler() {
  if (_schedulerInterval) { clearInterval(_schedulerInterval); _schedulerInterval = null; }
  _nextAutopilotRun = null;
  log.info("[AdvertisingEngine] Scheduler stopped");
}

export function getAdvertisingSchedulerStatus() {
  return {
    active: _schedulerInterval !== null,
    intervalHours: ORGANIC_GROWTH_INTERVAL_MS / (60 * 60 * 1000),
    lastRun: _lastAutopilotRun?.toISOString() ?? null,
    nextRun: _nextAutopilotRun?.toISOString() ?? null,
    currentlyRunning: _schedulerRunning,
    cycleCount: _autopilotCycleCount,
    safeAutonomousChannels: SAFE_AUTONOMOUS_CHANNELS,
    blockedAutonomousChannels: BLOCKED_AUTONOMOUS_CHANNELS,
    paidAdsMode: "disabled_until_manual_owner_approval",
  };
}

export async function generateBlastContent(channelIds?: string[]) {
  const channels = [
    { id: "linkedin", name: "LinkedIn", prompt: "professional B2B post about AI orchestration and website checking" },
    { id: "x_twitter", name: "Twitter/X", prompt: "punchy post about connecting multiple AI models and finding broken website issues" },
    { id: "youtube_shorts", name: "YouTube Shorts", prompt: "short video script showing VIBA finding broken website buttons and producing a report" },
    { id: "reddit", name: "Reddit", prompt: "value-first Reddit post about multi-agent AI and website QA reports" },
    { id: "devto", name: "Dev.to", prompt: "developer-focused article intro about multi-agent orchestration and site QA automation" },
    { id: "blog", name: "Blog", prompt: "SEO blog article intro about AI website audits and multi-agent orchestration" },
  ].filter(c => !channelIds || channelIds.includes(c.id));

  const results: { channel: string; success: boolean; contentId?: number; error?: string }[] = [];

  for (const ch of channels) {
    try {
      const raw = await invokeLLM(
        `Write a ${ch.prompt} for VIBA (https://viba.guru). Return JSON: { "headline": "...", "body": "...", "hashtags": ["..."], "callToAction": "..." }`,
        "You are a social media expert. Return valid JSON only."
      );
      const content = safeJsonExtract(raw) as { headline: string; body: string; hashtags: string[]; callToAction: string } | null;
      if (content) {
        const [inserted] = await db.insert(marketingContent).values({
          platform: ch.id,
          type: ch.id === "youtube_shorts" ? "video_script" : ch.id === "blog" || ch.id === "devto" ? "blog_article" : "organic_post",
          headline: content.headline,
          body: content.body,
          hashtags: content.hashtags,
          callToAction: content.callToAction,
          status: "draft",
        } as never).returning({ id: marketingContent.id });
        results.push({ channel: ch.id, success: true, contentId: inserted?.id });
      }
    } catch (err) {
      results.push({ channel: ch.id, success: false, error: String(err) });
    }
  }

  return { results, total: results.length, succeeded: results.filter(r => r.success).length };
}
