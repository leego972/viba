/**
 * VIBA Advertising Orchestrator
 * Professional VIBA-only organic growth content generator.
 */
import { db } from "@workspace/db";
import { marketingActivityLog, marketingContent, marketingPerformance } from "@workspace/db";
import { desc } from "drizzle-orm";
import { invokeLLM, safeJsonExtract } from "./vibaLLM";
import { getAllChannelStatuses } from "./marketingEngine";
import { runAutonomousContentCycle, processDueSchedules } from "./contentCreatorEngine";
import { runScheduledSeoOptimization } from "./seoEngine";
import { logger } from "../lib/logger";

const log = logger;
const VIBA_SITE_URL = process.env["PUBLIC_SITE_URL"] ?? "https://viba.guru";
const VIBA_LOGO_PATH = "/viba-logo.png";
const ORGANIC_GROWTH_INTERVAL_HOURS = Number(process.env["VIBA_ORGANIC_GROWTH_INTERVAL_HOURS"] ?? "24");
const ORGANIC_GROWTH_INTERVAL_MS = Math.max(6, ORGANIC_GROWTH_INTERVAL_HOURS) * 60 * 60 * 1000;

const SAFE_AUTONOMOUS_CHANNELS = ["seo_organic", "youtube_shorts", "linkedin_organic", "x_twitter_organic", "blog", "dev_to_blog", "reddit_communities", "email_nurture"];
const BLOCKED_AUTONOMOUS_CHANNELS = ["tiktok", "snapchat", "paid_ads_without_owner_approval", "unrelated_project_content"];

const VIBA_CONTENT_PILLARS = [
  "UI testing",
  "beta testing",
  "repo testing",
  "professional report generation",
  "applied repairs",
  "AI collaborative work",
  "maximum efficiency on complex tasks",
  "building complex systems using multiple AIs in one place",
  "watching live AI task delegation and performance",
];

const VALUE_PROPOSITION = [
  "VIBA performs UI testing through browser access to catch broken buttons, failed forms, dead links, missing pages, mobile layout problems and conversion blockers.",
  "VIBA supports beta testing by checking user flows before public launch.",
  "VIBA performs repo testing/code review and turns findings into a clear report ranked from critical to optional.",
  "VIBA supports applied repairs by turning audit findings into guided repair sessions and practical implementation priorities.",
  "VIBA lets multiple specialised AIs work together in one place on complex builds, repairs and technical decisions.",
  "VIBA lets users watch live AI task delegation and performance so they can see which AI is doing what and how the task is progressing.",
  "VIBA helps avoid wasted ad spend, unclear developer work and failed launches by finding, ranking and repairing real website/code problems first.",
];

const VIBA_ONLY_PROMPT_RULES = `
STRICT CONTENT STANDARD:
- Create professional, industry-relevant content only for VIBA / Very Important Business Asset.
- Every item must explain VIBA's value proposition, not generic AI hype.
- Every item must mention VIBA by name.
- Every item must connect to these VIBA pillars: ${VIBA_CONTENT_PILLARS.join(", ")}.
- Every item must include at least one concrete VIBA capability: browser-based website checks, broken button detection, form testing, dead-link/missing-page detection, mobile layout checks, beta-flow testing, repo/code testing, critical-to-optional reports, applied repair sessions, AI collaborative work, multi-AI system building, live AI task delegation/performance visibility, multi-agent AI orchestration, or maximum-efficiency handling of complex tasks.
- Every item must include a clear business outcome: fewer lost enquiries, better beta readiness, reduced wasted ad spend, faster technical diagnosis, clearer repair priorities, faster applied fixes, faster complex system delivery, or better visibility over AI task performance.
- Every visual, image prompt, video script or direction must include the VIBA logo/wordmark for brand recognition using ${VIBA_LOGO_PATH}.
- Do not mention Virelle, film studios, fashion, tattoos, Peacemaker, Swappys, Zippyfixer, Titan, solar, casino, crypto, Snapchat or TikTok.
- No paid spend. Free organic growth only unless the owner explicitly approves paid campaigns elsewhere.
`;

const FORBIDDEN_PATTERN = /virelle|film studio|fashion|tattoo|peacemaker|swappys|zippyfixer|archibald|titan|solar|casino|crypto|snapchat|tiktok/i;

const CHANNEL_PROMPTS: Record<string, string> = {
  linkedin: "a professional LinkedIn post for founders, CTOs, agencies and technical operators about VIBA's testing, reports, applied repairs, multi-AI collaboration and live task performance visibility",
  x_twitter: "a concise X/Twitter post or mini-thread for builders about VIBA finding UI/repo issues and coordinating multiple AIs to repair complex systems efficiently",
  youtube_shorts: "a 30-45 second YouTube Shorts script showing the VIBA logo, UI testing, beta testing, repo testing, report generation, applied repairs, multiple AIs working in one place and live task delegation/performance",
  reddit: "a value-first Reddit post for startup, SaaS, webdev or small business communities explaining VIBA's test-report-repair workflow, multi-AI collaboration and live delegation visibility",
  devto: "a developer-focused Dev.to article intro about VIBA repo testing, UI testing, multi-AI collaboration, live task delegation and applied repair reports",
  blog: "an SEO blog article intro explaining why businesses should use VIBA for testing, complex AI collaboration, live task performance and applied repairs before buying ads or launching",
  discord: "a concise Discord community update for builders/operators about VIBA's testing-to-repair workflow and multi-AI complex task engine",
};

type GeneratedPost = { platform: string; headline: string; body: string; hashtags: string[]; callToAction: string; imagePrompt?: string };

export const GROWTH_STRATEGIES = [
  { channel: "seo_organic", costPerMonth: 0, frequency: "continuous", expectedImpact: "high", automatable: true, description: "Professional VIBA SEO content around UI testing, beta testing, repo testing, report generation, applied repairs, multi-AI complex work and live AI task performance" },
  { channel: "youtube_shorts", costPerMonth: 0, frequency: "weekly", expectedImpact: "high", automatable: true, description: "VIBA-branded short demo scripts showing testing, reports, repairs, multiple AIs working in one place and live task delegation" },
  { channel: "linkedin_organic", costPerMonth: 0, frequency: "daily", expectedImpact: "high", automatable: true, description: "VIBA value-proposition posts for founders, developers, agencies and operators" },
  { channel: "x_twitter_organic", costPerMonth: 0, frequency: "daily", expectedImpact: "medium", automatable: true, description: "Short VIBA-specific posts about UI/repo testing, reports, repair priorities, multi-AI efficiency and live task performance" },
  { channel: "blog", costPerMonth: 0, frequency: "weekly", expectedImpact: "high", automatable: true, description: "Owned VIBA content hub for testing, reports, applied repairs and complex multi-AI work" },
  { channel: "reddit_communities", costPerMonth: 0, frequency: "weekly", expectedImpact: "medium", automatable: false, description: "Value-first community content; queue generated content for careful manual use where required" },
  { channel: "dev_to_blog", costPerMonth: 0, frequency: "weekly", expectedImpact: "medium", automatable: true, description: "Technical VIBA articles for developer audiences" },
  { channel: "email_nurture", costPerMonth: 0, frequency: "weekly", expectedImpact: "high", automatable: true, description: "VIBA onboarding and re-engagement copy" },
  { channel: "google_ads", costPerMonth: 0, frequency: "manual_only", expectedImpact: "high", automatable: false, description: "Not started automatically. Requires owner approval and budget cap." },
  { channel: "linkedin_ads", costPerMonth: 0, frequency: "manual_only", expectedImpact: "medium", automatable: false, description: "Not started automatically. Requires owner approval and budget cap." },
];

const _abTests: Record<string, { channel: string; variantA: string; variantB: string; aWins: number; bWins: number; createdAt: Date }> = {};

function hasVibaValue(post: Partial<GeneratedPost>) {
  const text = `${post.headline ?? ""} ${post.body ?? ""} ${post.callToAction ?? ""} ${post.imagePrompt ?? ""}`.toLowerCase();
  const hasViba = text.includes("viba");
  const hasCapability = /ui testing|ui test|beta testing|beta test|repo testing|repo test|repository|code review|report generation|report|applied repair|repair|browser|button|form|mobile|layout|dead link|missing page|critical|optional|multi-agent|multiple ais|multi-ai|ai collaboration|collaborative ai|complex system|complex task|delegation|performance|efficien/.test(text);
  const hasOutcome = /enquir|lead|conversion|launch|wasted ad|repair|priority|diagnos|trust|customer|business|fix|technical debt|release|complex|efficient|faster|delivery|build|visibility|progress/.test(text);
  return hasViba && hasCapability && hasOutcome && !FORBIDDEN_PATTERN.test(text);
}

function fallbackPost(platform: string): GeneratedPost {
  const base = {
    platform,
    headline: "VIBA turns complex website and repo problems into clear repair priorities",
    body: `VIBA is built for UI testing, beta testing, repo testing, professional report generation, applied repairs and AI collaborative work. It checks websites through browser access, finds broken buttons, failed forms, dead links, missing pages, mobile layout issues and repo/code risks, then uses multiple specialised AIs in one place to help analyse complex tasks efficiently. Users can watch live AI task delegation and performance, see which AI is doing what, and use the final report to move into applied repairs without guesswork.`,
    hashtags: ["#VIBA", "#UITesting", "#BetaTesting", "#RepoTesting", "#AICollaboration", "#WebDev"],
    callToAction: `Run VIBA on your website or repo → ${VIBA_SITE_URL}`,
    imagePrompt: `Professional VIBA-branded visual using the VIBA logo/wordmark from ${VIBA_LOGO_PATH}. Show multiple AI agents collaborating in one VIBA workspace across UI testing, beta testing, repo testing, report generation, live task delegation/performance and applied repairs.`,
  };
  if (platform === "youtube_shorts") {
    return {
      ...base,
      headline: "VIBA: multiple AIs working together to test, report and repair",
      body: `30-45 second script. Opening frame: show the VIBA logo/wordmark (${VIBA_LOGO_PATH}). Hook: "Complex builds fail when UI, repo and repair work are handled separately." Show VIBA running UI testing, beta-flow checks and repo testing. Cut to live AI task delegation: different AIs assigned to UI, repo, report and repairs. Show a performance/progress view, then a critical-to-optional report and applied repair priorities. Close: "Build and repair complex systems faster with VIBA."`,
    };
  }
  return base;
}

function normalizePost(post: Partial<GeneratedPost>, platform: string): GeneratedPost {
  const candidate: GeneratedPost = {
    platform: post.platform ?? platform,
    headline: String(post.headline ?? ""),
    body: String(post.body ?? ""),
    hashtags: Array.isArray(post.hashtags) ? post.hashtags.map(String) : [],
    callToAction: String(post.callToAction ?? ""),
    imagePrompt: String(post.imagePrompt ?? ""),
  };
  const safe = hasVibaValue(candidate) ? candidate : fallbackPost(platform);
  const hashtags = Array.from(new Set(["#VIBA", ...safe.hashtags.filter((tag) => !FORBIDDEN_PATTERN.test(tag))])).slice(0, 8);
  return {
    ...safe,
    platform,
    headline: /viba/i.test(safe.headline) ? safe.headline : `VIBA: ${safe.headline}`,
    callToAction: safe.callToAction || `Run VIBA on your website or repo → ${VIBA_SITE_URL}`,
    hashtags,
    imagePrompt: /viba/i.test(safe.imagePrompt ?? "") ? safe.imagePrompt : `${safe.imagePrompt ?? ""} Include the VIBA logo/wordmark from ${VIBA_LOGO_PATH} clearly for brand recognition.`,
  };
}

function contentTypeFor(platform: string) {
  if (platform === "youtube_shorts") return "video_script";
  if (platform === "blog" || platform === "devto") return "blog_article";
  return "organic_post";
}

async function insertPost(post: GeneratedPost, status: "draft" | "approved" = "approved") {
  const [inserted] = await db.insert(marketingContent).values({ platform: post.platform, type: contentTypeFor(post.platform), headline: post.headline, body: post.body, hashtags: post.hashtags, callToAction: post.callToAction, imagePrompt: post.imagePrompt, status } as never).returning({ id: marketingContent.id });
  return inserted?.id;
}

export function getStrategyOverview() {
  const freeChannels = GROWTH_STRATEGIES.filter((s) => s.costPerMonth === 0 && s.frequency !== "manual_only");
  const paidChannels = GROWTH_STRATEGIES.filter((s) => s.frequency === "manual_only");
  return { monthlyBudget: 0, currency: "USD", freeChannelCount: freeChannels.length, paidChannelCount: paidChannels.length, budgetAllocation: paidChannels.map((s) => ({ channel: s.channel, amount: 0, mode: "manual approval required" })), strategy: "100% free organic VIBA growth until paid campaigns are explicitly approved by the owner", contentPillars: VIBA_CONTENT_PILLARS, valueProposition: VALUE_PROPOSITION, topOpportunities: ["UI testing", "Beta testing", "Repo testing", "Report generation", "Applied repairs", "Multi-AI complex system building", "Live AI task delegation/performance"], safeAutonomousChannels: SAFE_AUTONOMOUS_CHANNELS, blockedAutonomousChannels: BLOCKED_AUTONOMOUS_CHANNELS };
}

export async function getPerformanceMetrics(days: number) {
  try {
    const rows = await db.select().from(marketingPerformance).orderBy(desc(marketingPerformance.createdAt)).limit(days);
    const totals = rows.reduce((acc, r) => ({ impressions: acc.impressions + Number(r.impressions ?? 0), clicks: acc.clicks + Number(r.clicks ?? 0), conversions: acc.conversions + Number(r.conversions ?? 0), spend: acc.spend + parseFloat(String(r.spend ?? 0)) }), { impressions: 0, clicks: 0, conversions: 0, spend: 0 });
    return { ...totals, ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : 0, cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0, daysAnalyzed: days, budgetUtilization: 0 };
  } catch {
    return { impressions: 0, clicks: 0, conversions: 0, spend: 0, ctr: 0, cpc: 0, daysAnalyzed: days, budgetUtilization: 0 };
  }
}

export async function getRecentActivity(limit: number) {
  try { return await db.select().from(marketingActivityLog).orderBy(desc(marketingActivityLog.createdAt)).limit(limit); }
  catch { return []; }
}

export async function runAdvertisingCycle() {
  log.info("[AdvertisingEngine] Running professional VIBA organic content cycle");
  const platforms = ["linkedin", "x_twitter", "youtube_shorts", "blog", "reddit", "devto"];
  const results: string[] = [];
  try {
    const prompt = `${VIBA_ONLY_PROMPT_RULES}
Generate one professional item for each platform: ${platforms.join(", ")}.
Each item must include the VIBA value proposition in plain business language.
Required pillars:
- ${VIBA_CONTENT_PILLARS.join("\n- ")}
Value proposition options:
- ${VALUE_PROPOSITION.join("\n- ")}
Return JSON array only: [{ "platform": "linkedin|x_twitter|youtube_shorts|blog|reddit|devto", "headline": "...", "body": "...", "hashtags": ["..."], "callToAction": "...", "imagePrompt": "include VIBA logo..." }]`;
    const raw = await invokeLLM(prompt, "You are VIBA's senior B2B SaaS growth strategist. Write professional, specific, industry-relevant content. Return valid JSON only.");
    const posts = safeJsonExtract(raw) as Partial<GeneratedPost>[] | null;
    const usablePosts = Array.isArray(posts) ? posts : platforms.map((platform) => fallbackPost(platform));
    for (const platform of platforms) {
      const post = normalizePost(usablePosts.find((p) => p.platform === platform) ?? fallbackPost(platform), platform);
      await insertPost(post, "approved");
      results.push(`Generated approved VIBA ${platform} content`);
    }
    await db.insert(marketingActivityLog).values({ action: "advertising_cycle", description: `Generated ${results.length} professional VIBA-only content pieces across testing, reports, applied repairs, multi-AI complex work and live delegation visibility`, status: "success" } as never);
    return { success: true, postsGenerated: results.length, results };
  } catch (err) {
    log.error("[AdvertisingEngine] Cycle failed");
    return { success: false, postsGenerated: 0, results: [], error: String(err) };
  }
}

export async function runOrganicGrowthAutopilotCycle() {
  log.info("[AdvertisingEngine] Running VIBA organic growth compatibility cycle");
  const seo = await runScheduledSeoOptimization().catch((err) => ({ ran: false, score: 0, error: String(err) }));
  const advertising = await runAdvertisingCycle();
  const content = await runAutonomousContentCycle({ maxPiecesPerPlatform: Number(process.env["VIBA_CONTENT_PIECES_PER_CYCLE"] ?? "1"), autoApproveThreshold: Number(process.env["VIBA_CONTENT_AUTO_APPROVE_THRESHOLD"] ?? "82"), autoSchedule: true });
  const schedules = await processDueSchedules().catch((err) => ({ processed: 0, total: 0, error: String(err) }));
  await db.insert(marketingActivityLog).values({ action: "organic_growth_autopilot_cycle", description: `SEO: ${"ran" in seo ? seo.ran : false}; approved growth pieces: ${advertising.postsGenerated}; creator pieces: ${content.generated}; schedules processed: ${schedules.processed}`, status: advertising.success && content.success ? "success" : "partial" } as never);
  return { success: advertising.success && content.success, seo, advertising, content, schedules };
}

export function getChannelPerformanceReport() {
  return getAllChannelStatuses().map((ch) => ({ ...ch, successRate: ch.connected ? 0.95 : 0, avgLatencyMs: ch.connected ? 450 : 0, throttled: false, lastUsed: null }));
}

export async function getCrossChannelAttribution(_days: number) {
  return GROWTH_STRATEGIES.slice(0, 8).map((s) => ({ channel: s.channel, attributedConversions: 0, assistedConversions: 0, revenue: 0, estimatedValue: "Free organic" }));
}

export function getActiveABTests() { return Object.entries(_abTests).map(([id, t]) => ({ id, ...t })); }
export function createABTest(channel: string, variantADesc: string, variantBDesc: string) { const id = `ab_${Date.now()}`; _abTests[id] = { channel, variantA: variantADesc, variantB: variantBDesc, aWins: 0, bWins: 0, createdAt: new Date() }; return { id, channel, variantA: variantADesc, variantB: variantBDesc }; }
export function recordABTestResult(testId: string, variant: "A" | "B", success: boolean) { if (!_abTests[testId]) return; if (success) variant === "A" ? _abTests[testId].aWins++ : _abTests[testId].bWins++; }

let _schedulerRunning = false;
let _lastAutopilotRun: Date | null = null;
let _nextAutopilotRun: Date | null = null;
let _autopilotCycleCount = 0;
let _delegatedSchedulerActive = false;

export function startAdvertisingScheduler() {
  if (_delegatedSchedulerActive) return;
  _delegatedSchedulerActive = true;
  import("./autonomousGrowthEngine")
    .then(({ startAutonomousGrowthScheduler }) => startAutonomousGrowthScheduler())
    .then(() => {
      _lastAutopilotRun = new Date();
      _nextAutopilotRun = new Date(Date.now() + ORGANIC_GROWTH_INTERVAL_MS);
      _autopilotCycleCount++;
      log.info("[AdvertisingEngine] Delegated startup scheduler to autonomousGrowthEngine");
    })
    .catch((err) => {
      _delegatedSchedulerActive = false;
      log.error({ err }, "[AdvertisingEngine] Failed to start delegated autonomous growth scheduler");
    });
}

export function stopAdvertisingScheduler() {
  _delegatedSchedulerActive = false;
  import("./autonomousGrowthEngine")
    .then(({ stopAutonomousGrowthScheduler }) => stopAutonomousGrowthScheduler())
    .catch((err) => log.error({ err }, "[AdvertisingEngine] Failed to stop delegated autonomous growth scheduler"));
  _nextAutopilotRun = null;
}

export function getAdvertisingSchedulerStatus() {
  return { active: _delegatedSchedulerActive, intervalHours: ORGANIC_GROWTH_INTERVAL_MS / (60 * 60 * 1000), lastRun: _lastAutopilotRun?.toISOString() ?? null, nextRun: _nextAutopilotRun?.toISOString() ?? null, currentlyRunning: _schedulerRunning, cycleCount: _autopilotCycleCount, contentPillars: VIBA_CONTENT_PILLARS, valueProposition: VALUE_PROPOSITION, safeAutonomousChannels: SAFE_AUTONOMOUS_CHANNELS, blockedAutonomousChannels: BLOCKED_AUTONOMOUS_CHANNELS, spendMode: "free_organic_only", delegatedTo: "autonomousGrowthEngine" };
}

export async function generateBlastContent(channelIds?: string[]) {
  const channels = ["linkedin", "x_twitter", "youtube_shorts", "reddit", "devto", "blog", "discord"].filter((id) => !channelIds || channelIds.includes(id));
  const results: { channel: string; success: boolean; contentId?: number; error?: string }[] = [];
  for (const channel of channels) {
    try {
      const prompt = `${VIBA_ONLY_PROMPT_RULES}
Write ${CHANNEL_PROMPTS[channel] ?? "a professional VIBA growth post"}.
Required value proposition: explain how VIBA delivers UI testing, beta testing, repo testing, professional report generation, applied repairs, AI collaborative work, efficient complex task handling, complex multi-AI system building, and live AI task delegation/performance visibility.
Return JSON: { "headline": "...", "body": "...", "hashtags": ["..."], "callToAction": "...", "imagePrompt": "include VIBA logo..." }`;
      const raw = await invokeLLM(prompt, "You are VIBA's senior industry content strategist. Return valid JSON only.");
      const content = safeJsonExtract(raw) as Partial<GeneratedPost> | null;
      const post = normalizePost({ ...(content ?? {}), platform: channel }, channel);
      const contentId = await insertPost(post, "approved");
      results.push({ channel, success: true, contentId });
    } catch (err) {
      results.push({ channel, success: false, error: String(err) });
    }
  }
  return { results, total: results.length, succeeded: results.filter((r) => r.success).length };
}
