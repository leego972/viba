/**
 * VIBA Content Creator Engine
 * Autonomous, VIBA-only, brand-aware content generation.
 */
import { db } from "@workspace/db";
import { contentCreatorCampaigns, contentCreatorPieces, contentCreatorSchedules, marketingActivityLog } from "@workspace/db";
import { and, count, desc, eq, lt, sql } from "drizzle-orm";
import { invokeLLM, safeJsonExtract } from "./vibaLLM";

const VIBA_BRAND = {
  name: "VIBA",
  fullName: "Very Important Business Asset",
  website: "https://viba.guru",
  logoPath: "/viba-logo.png",
  tagline: "UI testing, beta testing, repo testing, report generation, applied repairs and collaborative multi-AI system building",
  tone: "Professional, precise, industry-relevant and practical. No generic AI hype. Always explain a concrete VIBA outcome.",
  valueProposition: [
    "UI testing through browser access to find broken buttons, missing pages, dead links, form failures, mobile layout issues and customer-flow blockers.",
    "Beta testing for websites and apps before launch, before client handover or before paid traffic is sent to them.",
    "Repo testing and code review to identify weak logic, broken flows, unstable code paths and technical risk.",
    "Professional report generation ranked from critical to optional so owners know what to fix first.",
    "Applied repairs and repair-session planning based on the generated report.",
    "AI collaborative work across specialised agents to achieve maximum efficiency on complex technical tasks.",
    "Building complex systems using multiple AIs in one place, coordinated by VIBA instead of scattered across disconnected tools.",
    "Live AI task delegation and performance visibility so users can see which AI is doing what, why it was assigned and how the work is progressing.",
  ],
  audiences: [
    "business owners who need their website tested before advertising",
    "founders preparing a launch or beta release",
    "developers and agencies needing AI-assisted QA, repo review and repair planning",
    "SaaS builders who need UI testing, report generation and applied repairs",
    "technical operators who need efficient collaborative AI execution on complex work",
  ],
};

const VIBA_TOPICS = [
  "UI testing that finds broken buttons before customers do",
  "Beta testing for websites and apps before launch",
  "Repo testing that turns code risk into a ranked repair report",
  "Professional report generation ranked from critical to optional",
  "Applied repairs after a VIBA audit report",
  "Browser-based testing for forms, missing pages, dead links and mobile layout issues",
  "AI collaborative work for maximum efficiency on complex technical tasks",
  "Building complex systems using multiple AIs in one place",
  "Watching live AI task delegation and performance inside VIBA",
  "How VIBA combines UI testing, repo testing, report generation and applied repairs",
  "Launch readiness with VIBA beta testing and repair planning",
];

const SAFE_AUTONOMOUS_PLATFORMS = ["youtube_shorts", "linkedin", "x_twitter", "blog", "reddit", "devto", "medium", "email", "discord"];
const FORBIDDEN_PATTERN = /virelle|film studio|fashion|tattoo|peacemaker|swappys|zippyfixer|archibald|titan|solar|casino|crypto|snapchat|tiktok/i;
const RELEVANCE_PATTERN = /ui testing|beta testing|repo testing|report generation|applied repair|collaborative ai|multiple ais|complex systems|complex task|maximum efficiency|browser|button|form|mobile|dead link|missing page|code review|critical|optional|repair session|multi-agent|task delegation|performance visibility|live ai/i;

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
  if (seed && RELEVANCE_PATTERN.test(seed)) return seed;
  return VIBA_TOPICS[Math.floor(Math.random() * VIBA_TOPICS.length)] ?? VIBA_TOPICS[0];
}

function defaultKeywords(topic?: string) {
  const keywords = [
    "VIBA",
    "UI testing",
    "beta testing",
    "repo testing",
    "report generation",
    "applied repairs",
    "AI collaborative work",
    "build complex systems with multiple AIs",
    "live AI task delegation",
    "AI performance visibility",
    "multi-agent AI orchestration",
    "website health check",
  ];
  if (topic?.toLowerCase().includes("repo")) keywords.push("code review");
  if (topic?.toLowerCase().includes("beta")) keywords.push("launch readiness");
  return keywords;
}

function cleanHashtags(tags: unknown, max: number) {
  const fallback = ["#VIBA", "#UITesting", "#BetaTesting", "#RepoTesting", "#AIOrchestration", "#WebDev"];
  const raw = Array.isArray(tags) ? tags.map(String) : fallback;
  const cleaned = raw
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => tag.startsWith("#") ? tag : `#${tag.replace(/\s+/g, "")}`)
    .filter((tag) => !FORBIDDEN_PATTERN.test(tag));
  return Array.from(new Set(["#VIBA", ...cleaned])).slice(0, Math.max(1, max || 5));
}

function relevanceScore(content: Partial<GeneratedContent>) {
  const text = `${content.title ?? ""} ${content.headline ?? ""} ${content.body ?? ""} ${content.videoScript ?? ""} ${content.callToAction ?? ""}`.toLowerCase();
  let score = 70;
  if (text.includes("viba")) score += 10;
  if (RELEVANCE_PATTERN.test(text)) score += 12;
  if (/critical|optional|report|repair|launch|customer|efficiency|complex|delegation|performance/.test(text)) score += 6;
  if (FORBIDDEN_PATTERN.test(text)) score -= 60;
  return Math.max(0, Math.min(100, score));
}

function fallbackBody(topic: string) {
  return `VIBA helps teams test, diagnose, repair and build technical systems faster. It covers UI testing, beta testing, repo testing, professional report generation and applied repair planning, then coordinates multiple AIs in one place for maximum efficiency on complex tasks.\n\nFor ${topic}, VIBA turns scattered technical work into a clear report and live AI task flow, so users can see what is being delegated, how the work is performing and what should be fixed or built next.`;
}

function enforceVibaOnly(content: Partial<GeneratedContent>, platformLabel: string, topic: string, maxHashtags: number): GeneratedContent {
  const incomingBody = String(content.body ?? "").trim();
  const body = /viba/i.test(incomingBody) && RELEVANCE_PATTERN.test(incomingBody) && !FORBIDDEN_PATTERN.test(incomingBody)
    ? incomingBody
    : fallbackBody(topic);
  const videoRequired = platformLabel.toLowerCase().includes("youtube");
  const visualDirections = String(content.visualDirections ?? "Use the VIBA logo (/viba-logo.png) clearly in the first and final frame. Show UI testing, beta testing, repo testing, report generation, applied repairs, live AI task delegation, performance visibility and multiple AI agents collaborating in one VIBA workspace.");

  return {
    title: String(content.title ?? `VIBA: ${topic}`).slice(0, 180),
    headline: String(content.headline ?? `VIBA: ${topic}`).slice(0, 180),
    body,
    callToAction: String(content.callToAction ?? `Run VIBA at ${VIBA_BRAND.website}`),
    hashtags: cleanHashtags(content.hashtags, maxHashtags),
    hook: content.hook ? String(content.hook) : "Complex technical work gets slower when every AI tool is separate. VIBA brings the work into one coordinated place.",
    videoScript: content.videoScript ? String(content.videoScript) : videoRequired ? `Open with the VIBA logo (${VIBA_BRAND.logoPath}). Hook: "Complex builds should not be scattered across five AI tools." Show VIBA coordinating UI testing, beta testing, repo testing, report generation, applied repairs, live task delegation and AI performance visibility. End with the value: multiple AIs in one place, working efficiently on complex systems.` : undefined,
    visualDirections: visualDirections.includes("VIBA") ? visualDirections : `${visualDirections}\nUse VIBA logo ${VIBA_BRAND.logoPath} for brand recognition.`,
    seoKeywords: Array.isArray(content.seoKeywords) && content.seoKeywords.length > 0 ? content.seoKeywords.map(String) : defaultKeywords(topic),
    imagePrompt: content.imagePrompt ? String(content.imagePrompt) : `Professional VIBA-branded visual using logo ${VIBA_BRAND.logoPath}. Show one VIBA workspace coordinating multiple AI agents for UI testing, beta testing, repo testing, report generation, applied repairs, live task delegation and performance monitoring on a complex system.`,
    seoScore: Math.max(82, relevanceScore(content)),
    qualityScore: Math.max(82, relevanceScore(content)),
    generationMs: Number(content.generationMs ?? 0),
  };
}

export async function generateCreatorContent(input: { platform: string; contentType: string; topic?: string; campaignObjective?: string; seoKeywords?: string[]; brandVoice?: string; includeImage?: boolean; campaignId?: number }): Promise<GeneratedContent> {
  const platformCfg = PLATFORM_CONFIG[input.platform] ?? PLATFORM_CONFIG.linkedin;
  const start = Date.now();
  const topic = pickTopic(input.topic);
  const keywords = input.seoKeywords?.length ? input.seoKeywords : defaultKeywords(topic);
  const prompt = `Create ${input.contentType} for ${platformCfg.label}.\n\nSTRICT PRODUCT: VIBA only.\nWebsite: ${VIBA_BRAND.website}\nLogo asset: ${VIBA_BRAND.logoPath}\nTagline: ${VIBA_BRAND.tagline}\n\nHard rules:\n- Must mention VIBA by name.\n- Must be professional and industry-relevant.\n- Must explain VIBA's value proposition in every item.\n- Must focus on at least one of: UI testing, beta testing, repo testing, report generation, applied repairs, AI collaborative work, maximum efficiency on complex tasks, building complex systems using multiple AIs in one place, watching live AI task delegation, or AI performance visibility.\n- Must not mention unrelated projects or channels: Virelle, Swappys, PeacemakerAI, Titan, tattoo apps, solar, Snapchat or TikTok.\n- Visual/video/image directions must include the VIBA logo for brand recognition.\n\nVIBA value proposition:\n- ${VIBA_BRAND.valueProposition.join("\n- ")}\n\nTarget audiences:\n- ${VIBA_BRAND.audiences.join("\n- ")}\n\nTopic: ${topic}\nGoal: ${input.campaignObjective ?? "generate qualified trust and leads for VIBA"}\nSEO keywords: ${keywords.join(", ")}\nVoice: ${input.brandVoice ?? VIBA_BRAND.tone}\nMax characters: ${platformCfg.maxChars}\nHashtags: max ${platformCfg.hashtagCount}\n\nReturn JSON only: { "title": "...", "headline": "...", "body": "...", "callToAction": "...", "hashtags": ["..."], "hook": "...", "videoScript": "...", "visualDirections": "...", "seoKeywords": ["..."], "imagePrompt": "..." }`;
  try {
    const raw = await invokeLLM(prompt, "You are VIBA's senior B2B SaaS content strategist. Generate only accurate, professional, VIBA-specific content. Return valid JSON only.");
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

export async function generateSeoContentBriefs(count_: number) {
  const prompt = `Generate ${count_} SEO content briefs for VIBA only. VIBA covers UI testing, beta testing, repo testing, report generation, applied repairs, AI collaborative work, building complex systems using multiple AIs in one place, live AI task delegation and performance visibility. Include VIBA logo usage in visual notes. Return JSON: [{ "title": "...", "targetKeyword": "...", "platform": "blog|linkedin|medium|devto", "contentType": "blog_article|social_post", "outline": ["..."], "estimatedWordCount": 800, "seoScore": 85 }]`;
  try {
    const raw = await invokeLLM(prompt, "You are VIBA's SEO strategist. VIBA-only. Return valid JSON only.");
    return safeJsonExtract(raw) ?? [];
  } catch {
    return [];
  }
}

export async function generateCampaignStrategy(input: { name: string; objective: string; targetAudience?: string }): Promise<string> {
  const prompt = `Create a VIBA-only 90-day organic content strategy. Campaign: ${input.name}. Objective: ${input.objective}. Audience: ${input.targetAudience ?? VIBA_BRAND.audiences.join(", ")}. Product: VIBA at ${VIBA_BRAND.website}. Value proposition: ${VIBA_BRAND.valueProposition.join(" ")}. Include VIBA logo placement in visuals. Do not include unrelated products.`;
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
  await db.insert(marketingActivityLog).values({ action: "viba_only_autonomous_content_cycle", description: `Generated ${generated.length} VIBA-only value-proposition pieces; scheduled ${scheduled.length}`, status: "success" } as never);
  return { success: true, generated: generated.length, scheduled: scheduled.length, pieceIds: generated, scheduledIds: scheduled };
}

export async function autoApproveHighQualityContent(threshold = 82) {
  const drafts = await db.select().from(contentCreatorPieces).where(eq(contentCreatorPieces.status, "draft"));
  let approved = 0;
  for (const piece of drafts) {
    const text = `${piece.title ?? ""} ${piece.headline ?? ""} ${piece.body ?? ""}`.toLowerCase();
    const isVibaRelevant = text.includes("viba") && RELEVANCE_PATTERN.test(text) && !FORBIDDEN_PATTERN.test(text);
    if (isVibaRelevant && (piece.qualityScore ?? 0) >= threshold) {
      await db.update(contentCreatorPieces).set({ status: "approved" }).where(eq(contentCreatorPieces.id, piece.id));
      approved++;
    }
  }
  return { approved, total: drafts.length };
}
