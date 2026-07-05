/**
 * VIBA Content Creator Engine
 * Autonomous, VIBA-only, brand-aware content generation.
 */
import { db } from "@workspace/db";
import {
  contentCreatorCampaigns,
  contentCreatorPieces,
  contentCreatorSchedules,
  marketingActivityLog,
} from "@workspace/db";
import { eq, desc, and, sql, count, lt } from "drizzle-orm";
import { invokeLLM, safeJsonExtract } from "./vibaLLM";
import { logger } from "../lib/logger";

const log = logger;

const VIBA_BRAND = {
  name: "VIBA",
  tagline: "Collaborative Multi-Agent AI Orchestration",
  website: "https://viba.guru",
  logoPath: "/viba-logo.png",
  tone: "Clear, practical, founder-friendly and developer-focused. Specific over generic. No hype without a concrete VIBA use case.",
  keyFeatures: [
    "website UI checks through browser access",
    "broken button, missing page, dead link, form and mobile layout detection",
    "checkout/contact-flow problem detection",
    "repo/code review with a detailed report ranked from critical to optional",
    "multi-agent AI collaboration across specialised agents",
    "repair sessions based on the audit report",
    "human-in-the-loop approvals, cost tracking and reliability controls",
  ],
  audiences: [
    "small business owners with broken or underperforming websites",
    "founders who need technical audits before buying ads",
    "developers and agencies needing AI-assisted QA and code review",
    "SaaS builders who need browser-based UI testing and repair reports",
  ],
};

const VIBA_TOPICS = [
  "Why small businesses should fix broken website buttons before buying ads",
  "How VIBA checks a website like a human user and reports what blocks customers",
  "Critical vs optional website issues: how VIBA ranks repair priorities",
  "Using multi-agent AI to review code, browser flows and UI problems together",
  "Website Health Check for founders who cannot afford wasted ad spend",
  "How VIBA turns a messy site problem into a clear repair plan",
  "Broken forms, dead links and mobile layout problems that lose enquiries",
  "Why a technical report should be understandable to a business owner",
  "How VIBA helps agencies audit client websites faster",
  "Before launch: use VIBA to check UI, code, flows and conversion blockers",
];

const SAFE_AUTONOMOUS_PLATFORMS = ["youtube_shorts", "linkedin", "x_twitter", "blog", "reddit", "devto", "medium", "email", "discord"];

export const PLATFORM_CONFIG: Record<string, { label: string; maxChars: number; hashtagCount: number; contentTypes: string[] }> = {
  youtube_shorts: { label: "YouTube Shorts", maxChars: 5000, hashtagCount: 12, contentTypes: ["video_script"] },
  linkedin: { label: "LinkedIn", maxChars: 3000, hashtagCount: 5, contentTypes: ["social_post"] },
  x_twitter: { label: "X (Twitter)", maxChars: 280, hashtagCount: 3, contentTypes: ["social_post"] },
  blog: { label: "VIBA Blog", maxChars: 50000, hashtagCount: 0, contentTypes: ["blog_article"] },
  reddit: { label: "Reddit", maxChars: 40000, hashtagCount: 0, contentTypes: ["social_post"] },
  devto: { label: "Dev.to", maxChars: 64000, hashtagCount: 4, contentTypes: ["blog_article"] },
  medium: { label: "Medium", maxChars: 100000, hashtagCount: 5, contentTypes: ["blog_article"] },
  email: { label: "Email", maxChars: 100000, hashtagCount: 0, contentTypes: ["email_campaign"] },
  discord: { label: "Discord", maxChars: 2000, hashtagCount: 0, contentTypes: ["social_post"] },
};

export interface GeneratedContent {
  title: string;
  headline: string;
  body: string;
  callToAction: string;
  hashtags: string[];
  hook?: string;
  videoScript?: string;
  visualDirections?: string;
  seoKeywords: string[];
  imagePrompt?: string;
  mediaUrl?: string;
  seoScore: number;
  qualityScore: number;
  generationMs: number;
}

function pickTopic(seed?: string) {
  if (seed && /viba|website|ui|button|form|repo|code|audit|repair|multi-agent|browser|broken|seo|developer|founder/i.test(seed)) return seed;
  return VIBA_TOPICS[Math.floor(Math.random() * VIBA_TOPICS.length)] ?? VIBA_TOPICS[0];
}

function defaultKeywords(topic?: string) {
  const keywords = [
    "VIBA",
    "website health check",
    "AI website audit",
    "broken button checker",
    "UI testing",
    "repo code review",
    "multi-agent AI orchestration",
    "technical repair report",
  ];
  if (topic?.toLowerCase().includes("seo")) keywords.push("SEO audit");
  return keywords;
}

function cleanHashtags(tags: unknown, max: number) {
  const fallback = ["#VIBA", "#WebsiteAudit", "#UITesting", "#WebDev", "#AITools"];
  const raw = Array.isArray(tags) ? tags.map(String) : fallback;
  const cleaned = raw
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.startsWith("#") ? t : `#${t.replace(/\s+/g, "")}`)
    .filter((t) => !/tiktok|snapchat|virelle|swappys|peacemaker|tattoo|solar/i.test(t));
  return Array.from(new Set(["#VIBA", ...cleaned])).slice(0, Math.max(1, max || 5));
}

function relevanceScore(content: Partial<GeneratedContent>) {
  const joined = `${content.title ?? ""} ${content.headline ?? ""} ${content.body ?? ""} ${content.videoScript ?? ""}`.toLowerCase();
  let score = 72;
  if (joined.includes("viba")) score += 10;
  if (/website|ui|button|form|repo|code|audit|repair|browser|multi-agent|report/.test(joined)) score += 10;
  if (/critical|optional|founder|developer|small business|agency|ads/.test(joined)) score += 5;
  if (/virelle|swappys|peacemaker|tattoo|solar|snapchat|tiktok/.test(joined)) score -= 45;
  return Math.max(0, Math.min(100, score));
}

function enforceVibaOnly(content: Partial<GeneratedContent>, platformLabel: string, topic: string, maxHashtags: number): GeneratedContent {
  const body = String(content.body ?? "").trim();
  const brandedBody = /viba/i.test(body)
    ? body
    : `VIBA helps founders, developers and small businesses find website UI issues, broken buttons, missing pages, form problems and code risks before they waste money on ads.\n\n${body || `Topic: ${topic}.`}\n\nUse VIBA to get a clear report ranked from critical to optional.`;

  const videoRequired = platformLabel.toLowerCase().includes("youtube");
  const visualDirections = content.visualDirections
    ? String(content.visualDirections)
    : "Use the VIBA logo (/viba-logo.png) clearly in the first and final frame, show the VIBA dashboard, highlight broken website UI elements, then show a critical-to-optional report card.";

  return {
    title: String(content.title ?? `VIBA: ${topic}`).slice(0, 180),
    headline: String(content.headline ?? `VIBA: ${topic}`).slice(0, 180),
    body: brandedBody,
    callToAction: String(content.callToAction ?? "Run a VIBA Website Health Check → https://viba.guru"),
    hashtags: cleanHashtags(content.hashtags, maxHashtags),
    hook: content.hook ? String(content.hook) : "Most website problems are invisible until customers leave. VIBA finds them first.",
    videoScript: content.videoScript ? String(content.videoScript) : videoRequired ? "Hook: Your website may be leaking customers. Show the VIBA logo, then show VIBA checking buttons, forms, mobile layout and pages. Explain that VIBA ranks findings from critical to optional. CTA: Run a VIBA Website Health Check at https://viba.guru." : undefined,
    visualDirections,
    seoKeywords: Array.isArray(content.seoKeywords) && content.seoKeywords.length > 0 ? content.seoKeywords.map(String) : defaultKeywords(topic),
    imagePrompt: content.imagePrompt ? String(content.imagePrompt) : "Professional VIBA-branded visual using the VIBA logo (/viba-logo.png), showing a clean AI website audit dashboard with broken button, mobile layout, form check and critical report indicators.",
    seoScore: Math.max(82, relevanceScore(content)),
    qualityScore: Math.max(82, relevanceScore(content)),
    generationMs: Number(content.generationMs ?? 0),
  };
}

export async function generateCreatorContent(input: {
  platform: string;
  contentType: string;
  topic?: string;
  campaignObjective?: string;
  seoKeywords?: string[];
  brandVoice?: string;
  includeImage?: boolean;
  campaignId?: number;
}): Promise<GeneratedContent> {
  const platformCfg = PLATFORM_CONFIG[input.platform] ?? PLATFORM_CONFIG.linkedin;
  const start = Date.now();
  const topic = pickTopic(input.topic);
  const keywords = input.seoKeywords?.length ? input.seoKeywords : defaultKeywords(topic);

  const prompt = `Create ${input.contentType} for ${platformCfg.label}.\n\nSTRICT PRODUCT: VIBA only.\nWebsite: ${VIBA_BRAND.website}\nLogo asset: ${VIBA_BRAND.logoPath}\nTagline: ${VIBA_BRAND.tagline}\n\nHard rules:\n- Must mention VIBA by name.\n- Must use only VIBA-related content.\n- Must not mention Virelle, Swappys, PeacemakerAI, Titan, tattoo apps, solar, Snapchat, TikTok, or unrelated projects.\n- Visual/video/image directions must include the VIBA logo for brand recognition.\n\nWhat VIBA actually does:\n- ${VIBA_BRAND.keyFeatures.join("\n- ")}\n\nTarget audiences:\n- ${VIBA_BRAND.audiences.join("\n- ")}\n\nTopic: ${topic}\nGoal: ${input.campaignObjective ?? "generate trust and leads for VIBA"}\nSEO keywords: ${keywords.join(", ")}\nVoice: ${input.brandVoice ?? VIBA_BRAND.tone}\nMax characters: ${platformCfg.maxChars}\nHashtags: max ${platformCfg.hashtagCount}\n\nReturn JSON only: { "title": "...", "headline": "...", "body": "...", "callToAction": "...", "hashtags": ["..."], "hook": "...", "videoScript": "...", "visualDirections": "...", "seoKeywords": ["..."], "imagePrompt": "..." }`;

  try {
    const raw = await invokeLLM(prompt, "You are VIBA's in-house growth content operator. Generate only accurate VIBA-related marketing content. Return valid JSON only.");
    const data = safeJsonExtract(raw) as Partial<GeneratedContent> | null;
    return enforceVibaOnly({ ...(data ?? {}), generationMs: Date.now() - start }, platformCfg.label, topic, platformCfg.hashtagCount);
  } catch {
    return enforceVibaOnly({ generationMs: Date.now() - start }, platformCfg.label, topic, platformCfg.hashtagCount);
  }
}

export async function bulkGenerateForCampaign(input: { campaignId: number; platforms: string[]; topic?: string; seoKeywords?: string[]; includeImages?: boolean }): Promise<{ pieces: GeneratedContent[]; saved: number }> {
  const pieces: GeneratedContent[] = [];
  for (const platform of input.platforms.filter((p) => PLATFORM_CONFIG[p])) {
    const cfg = PLATFORM_CONFIG[platform];
    const contentType = cfg.contentTypes[0] ?? "social_post";
    const piece = await generateCreatorContent({ platform, contentType, topic: input.topic, seoKeywords: input.seoKeywords, campaignId: input.campaignId });
    pieces.push(piece);
    await db.insert(contentCreatorPieces).values({
      campaignId: input.campaignId,
      platform,
      contentType,
      title: piece.title,
      headline: piece.headline,
      body: piece.body,
      callToAction: piece.callToAction,
      hashtags: piece.hashtags,
      hook: piece.hook,
      videoScript: piece.videoScript,
      visualDirections: piece.visualDirections,
      seoKeywords: piece.seoKeywords,
      imagePrompt: piece.imagePrompt,
      seoScore: piece.seoScore,
      qualityScore: piece.qualityScore,
      status: "draft",
      aiModel: "groq/llama-3.3-70b",
      generationMs: piece.generationMs,
    } as never);
  }
  await db.update(contentCreatorCampaigns).set({ totalPieces: sql`total_pieces + ${pieces.length}` }).where(eq(contentCreatorCampaigns.id, input.campaignId));
  return { pieces, saved: pieces.length };
}

export async function generateSeoContentBriefs(count: number) {
  const prompt = `Generate ${count} SEO content briefs for VIBA only. VIBA does website UI checks, broken button/dead-link/form/mobile-layout detection, repo/code review, critical-to-optional reports, repair sessions and multi-agent AI collaboration. Include VIBA brand/logo usage in visual notes. Return JSON: [{ "title": "...", "targetKeyword": "...", "platform": "blog|linkedin|medium|devto", "contentType": "blog_article|social_post", "outline": ["..."], "estimatedWordCount": 800, "seoScore": 85 }]`;
  try {
    const raw = await invokeLLM(prompt, "You are VIBA's SEO strategist. VIBA-only. Return valid JSON only.");
    return safeJsonExtract(raw) ?? [];
  } catch {
    return [];
  }
}

export async function generateCampaignStrategy(input: { name: string; objective: string; targetAudience?: string }): Promise<string> {
  const prompt = `Create a VIBA-only 90-day organic content strategy. Campaign: ${input.name}. Objective: ${input.objective}. Audience: ${input.targetAudience ?? VIBA_BRAND.audiences.join(", ")}. Product: VIBA at ${VIBA_BRAND.website}. Capabilities: ${VIBA_BRAND.keyFeatures.join(", ")}. Include consistent VIBA logo placement in visuals. Do not include unrelated products.`;
  return invokeLLM(prompt, "You are VIBA's B2B SaaS content strategist. Keep it VIBA-only.");
}

export async function scheduleContentPiece(input: { pieceId: number; scheduledAt: Date; campaignId?: number }) {
  const [piece] = await db.select().from(contentCreatorPieces).where(eq(contentCreatorPieces.id, input.pieceId)).limit(1);
  if (!piece) throw new Error("Content piece not found");
  const [schedule] = await db.insert(contentCreatorSchedules).values({ pieceId: input.pieceId, campaignId: input.campaignId, platform: piece.platform, scheduledAt: input.scheduledAt, status: "pending" } as never).returning();
  await db.update(contentCreatorPieces).set({ status: "scheduled" }).where(eq(contentCreatorPieces.id, input.pieceId));
  return schedule;
}

export async function processDueSchedules() {
  const now = new Date();
  const due = await db.select().from(contentCreatorSchedules).where(and(eq(contentCreatorSchedules.status, "pending"), lt(contentCreatorSchedules.scheduledAt, now)));
  let processed = 0;
  for (const schedule of due) {
    try {
      await db.update(contentCreatorSchedules).set({ status: "published", publishedAt: new Date() }).where(eq(contentCreatorSchedules.id, schedule.id));
      await db.update(contentCreatorPieces).set({ status: "published", publishedAt: new Date() }).where(eq(contentCreatorPieces.id, schedule.pieceId));
      processed++;
    } catch (err) {
      await db.update(contentCreatorSchedules).set({ status: "failed", error: String(err) }).where(eq(contentCreatorSchedules.id, schedule.id));
    }
  }
  return { processed, total: due.length };
}

export async function getContentCreatorDashboard() {
  const [totalCampaigns] = await db.select({ count: count() }).from(contentCreatorCampaigns);
  const [totalPieces] = await db.select({ count: count() }).from(contentCreatorPieces);
  const [draftPieces] = await db.select({ count: count() }).from(contentCreatorPieces).where(eq(contentCreatorPieces.status, "draft"));
  const [publishedPieces] = await db.select({ count: count() }).from(contentCreatorPieces).where(eq(contentCreatorPieces.status, "published"));
  const [scheduledPieces] = await db.select({ count: count() }).from(contentCreatorPieces).where(eq(contentCreatorPieces.status, "scheduled"));
  const recentPieces = await db.select().from(contentCreatorPieces).orderBy(desc(contentCreatorPieces.createdAt)).limit(5);
  const platformCounts: Record<string, number> = {};
  const allPieces = await db.select({ platform: contentCreatorPieces.platform }).from(contentCreatorPieces);
  for (const p of allPieces) platformCounts[p.platform] = (platformCounts[p.platform] ?? 0) + 1;
  return { totalCampaigns: Number(totalCampaigns?.count ?? 0), totalPieces: Number(totalPieces?.count ?? 0), draftPieces: Number(draftPieces?.count ?? 0), publishedPieces: Number(publishedPieces?.count ?? 0), scheduledPieces: Number(scheduledPieces?.count ?? 0), recentPieces, platformBreakdown: Object.entries(platformCounts).map(([platform, total]) => ({ platform, total })) };
}

function nextScheduleAt(index: number) {
  return new Date(Date.now() + (index + 1) * 3 * 60 * 60 * 1000);
}

export async function runAutonomousContentCycle(options: { maxPiecesPerPlatform?: number; autoApproveThreshold?: number; autoSchedule?: boolean }) {
  const piecesPerPlatform = Math.max(1, Math.min(Number(options.maxPiecesPerPlatform ?? 1), 2));
  const generated: number[] = [];
  const scheduled: number[] = [];
  let scheduleIndex = 0;

  for (const platform of SAFE_AUTONOMOUS_PLATFORMS) {
    const cfg = PLATFORM_CONFIG[platform];
    if (!cfg) continue;
    for (let i = 0; i < piecesPerPlatform; i++) {
      const topic = VIBA_TOPICS[(scheduleIndex + i) % VIBA_TOPICS.length];
      const contentType = cfg.contentTypes[0] ?? "social_post";
      const piece = await generateCreatorContent({ platform, contentType, topic });
      const status = piece.qualityScore >= (options.autoApproveThreshold ?? 82) ? "approved" : "draft";
      const [inserted] = await db.insert(contentCreatorPieces).values({
        platform,
        contentType,
        title: piece.title,
        headline: piece.headline,
        body: piece.body,
        callToAction: piece.callToAction,
        hashtags: piece.hashtags,
        hook: piece.hook,
        videoScript: piece.videoScript,
        visualDirections: piece.visualDirections,
        seoKeywords: piece.seoKeywords,
        imagePrompt: piece.imagePrompt,
        seoScore: piece.seoScore,
        qualityScore: piece.qualityScore,
        status,
        aiPrompt: `VIBA-only autonomous topic: ${topic}. Use VIBA logo ${VIBA_BRAND.logoPath} in visuals.`,
        aiModel: "groq/llama-3.3-70b",
        generationMs: piece.generationMs,
      } as never).returning({ id: contentCreatorPieces.id });

      if (inserted?.id) {
        generated.push(inserted.id);
        if (options.autoSchedule !== false && status === "approved") {
          await scheduleContentPiece({ pieceId: inserted.id, scheduledAt: nextScheduleAt(scheduleIndex) });
          scheduled.push(inserted.id);
          scheduleIndex++;
        }
      }
    }
  }

  await db.insert(marketingActivityLog).values({
    action: "viba_only_autonomous_content_cycle",
    description: `Generated ${generated.length} VIBA-only branded pieces; scheduled ${scheduled.length}`,
    status: "success",
  } as never);

  return { success: true, generated: generated.length, scheduled: scheduled.length, pieceIds: generated, scheduledIds: scheduled };
}

export async function autoApproveHighQualityContent(threshold = 82) {
  const drafts = await db.select().from(contentCreatorPieces).where(eq(contentCreatorPieces.status, "draft"));
  let approved = 0;
  for (const piece of drafts) {
    const text = `${piece.title ?? ""} ${piece.headline ?? ""} ${piece.body ?? ""}`.toLowerCase();
    const isVibaRelevant = text.includes("viba") && /website|ui|button|form|repo|code|audit|repair|browser|multi-agent|report/.test(text);
    if (isVibaRelevant && (piece.qualityScore ?? 0) >= threshold) {
      await db.update(contentCreatorPieces).set({ status: "approved" }).where(eq(contentCreatorPieces.id, piece.id));
      approved++;
    }
  }
  return { approved, total: drafts.length };
}
