import { Router, type IRouter } from "express";

const router: IRouter = Router();

// ─── VIBA product context (injected into every generation prompt) ─────────────

const VIBA_CONTEXT = `
VIBA is a collaborative multi-agent AI orchestration platform at viba.guru.

Key capabilities:
- Connect ChatGPT (OpenAI), Claude (Anthropic), Gemini (Google), Groq, Perplexity, and Replit agents in ONE session
- Assign each AI a role (architect, coder, reviewer, researcher, etc.)
- Set a goal — VIBA routes tasks by capability, runs agents autonomously, then surfaces results
- Real-time streaming across all agents simultaneously
- Human-in-the-loop approval gates for high-stakes decisions
- BYOK (Bring Your Own Keys) — use your own API keys, no lock-in
- Proof reports: auditable session logs showing what each agent did and why
- Circuit breakers: automatic fallback when an agent fails
- Credit-based billing: $50/month + 1000 credits, transparent per-session cost tracking
- Free to start with Groq (no credit card required)

Target audience: developers, AI engineers, technical founders, startup teams
USP: the ONLY platform that orchestrates competing AI providers (ChatGPT + Claude + Gemini) in a single collaborative workflow
Site: https://viba.guru
`.trim();

// ─── Free channel definitions ─────────────────────────────────────────────────

export type Channel = {
  id: string;
  name: string;
  url: string;
  category: "launch" | "community" | "social" | "content" | "newsletter" | "directory";
  priority: "critical" | "high" | "medium";
  note: string;
};

const CHANNELS: Channel[] = [
  { id: "product_hunt",        name: "Product Hunt",                url: "https://www.producthunt.com/posts/new",  category: "launch",      priority: "critical", note: "Biggest single-day traffic spike. Schedule Tuesday 12:01 am PST for maximum visibility." },
  { id: "hacker_news",         name: "Hacker News (Show HN)",       url: "https://news.ycombinator.com/submit",   category: "community",   priority: "critical", note: "Title must start 'Show HN:'. Post 9–11 am ET weekday. Ask a genuine question at the end." },
  { id: "reddit_ml",           name: "Reddit r/MachineLearning",    url: "https://reddit.com/r/MachineLearning/submit", category: "community", priority: "high", note: "Technical audience — lead with architecture. No hype." },
  { id: "reddit_artificial",   name: "Reddit r/artificial",         url: "https://reddit.com/r/artificial/submit",category: "community",   priority: "high",     note: "Broader AI community. Show a concrete multi-agent use-case example." },
  { id: "reddit_sideproject",  name: "Reddit r/SideProject",        url: "https://reddit.com/r/SideProject/submit",category: "community",  priority: "high",     note: "Be authentic. Share the builder journey and ask for feedback." },
  { id: "reddit_localllama",   name: "Reddit r/LocalLLaMA",         url: "https://reddit.com/r/LocalLLaMA/submit",category: "community",   priority: "medium",   note: "Focus on Groq / keyless free tier angle." },
  { id: "twitter_x",           name: "Twitter / X Thread",          url: "https://x.com",                         category: "social",      priority: "high",     note: "10-tweet thread. Post with a screen-recording GIF for maximum engagement." },
  { id: "linkedin",            name: "LinkedIn Post",               url: "https://linkedin.com",                  category: "social",      priority: "high",     note: "Post Tue–Thu 8–10 am. Use line breaks. Tag AI influencers." },
  { id: "devto",               name: "Dev.to Article",              url: "https://dev.to/new",                    category: "content",     priority: "high",     note: "Tags: ai, webdev, llm, opensource. Technical deep-dives perform best." },
  { id: "medium",              name: "Medium Article",              url: "https://medium.com/new-story",          category: "content",     priority: "medium",   note: "Crosspost from Dev.to for SEO longtail coverage." },
  { id: "indiehackers",        name: "IndieHackers",                url: "https://www.indiehackers.com/post",     category: "community",   priority: "high",     note: "IH loves transparent metrics + builder stories. Share MRR, users, lessons." },
  { id: "betalist",            name: "BetaList",                    url: "https://betalist.com/startups/new",     category: "launch",      priority: "medium",   note: "Free listing — takes 1–2 weeks to appear. Good for early adopter emails." },
  { id: "discord_communities", name: "Discord (AI Communities)",    url: "https://discord.com",                   category: "community",   priority: "high",     note: "Target: Hugging Face, EleutherAI, Latent Space, AI Tinkerers, LangChain Discord." },
  { id: "github_awesome",      name: "GitHub Awesome Lists",        url: "https://github.com/search?q=awesome+llm", category: "content",  priority: "medium",   note: "Open PRs to awesome-llm-apps, awesome-ai-agents, awesome-generative-ai." },
  { id: "tldr_ai",             name: "TLDR AI Newsletter",          url: "https://tldr.tech/ai/submit",           category: "newsletter",  priority: "high",     note: "500 k+ subscribers. Free submission. Reviewed weekly." },
  { id: "bens_bites",          name: "Ben's Bites Newsletter",      url: "https://bensbites.beehiiv.com/forms",   category: "newsletter",  priority: "medium",   note: "Large AI-focused newsletter. Submit a link or reach out on Twitter." },
  { id: "the_rundown_ai",      name: "The Rundown AI Newsletter",   url: "https://www.therundown.ai/submit",      category: "newsletter",  priority: "medium",   note: "Fast-growing AI newsletter. Free tool submissions. 600 k+ subscribers." },
  { id: "futurepedia",         name: "Futurepedia",                 url: "https://www.futurepedia.io/submit-tool",category: "directory",   priority: "critical", note: "Largest AI tools directory. High SEO value. Approvals in 24–48 h. Free listing." },
  { id: "taaft",               name: "There's An AI For That",      url: "https://theresanaiforthat.com/tool/submit/", category: "directory", priority: "critical", note: "2nd largest AI directory. 10 m+ monthly visitors. Free submission." },
  { id: "topai_tools",         name: "TopAI.tools",                 url: "https://topai.tools/submit",            category: "directory",   priority: "high",     note: "Growing AI directory with SEO-rich category pages. Free submission." },
  { id: "toolify_ai",          name: "Toolify.ai",                  url: "https://www.toolify.ai/submit",         category: "directory",   priority: "high",     note: "AI tools directory with 6 m+ monthly visits. Free submission form." },
  { id: "alternativeto",       name: "AlternativeTo",               url: "https://alternativeto.net/software/add/", category: "directory", priority: "high",     note: "Software alternatives directory. Huge SEO. List VIBA as alternative to CrewAI, AutoGen." },
  { id: "g2",                  name: "G2 (Software Reviews)",       url: "https://sell.g2.com/free-listing",      category: "directory",   priority: "high",     note: "Biggest B2B software review site. Free listing. Reviews drive purchase intent." },
  { id: "peerlist",            name: "Peerlist",                    url: "https://peerlist.io/new-project",       category: "launch",      priority: "medium",   note: "Developer-focused product launches. Good for technical audience." },
  { id: "devhunt",             name: "DevHunt",                     url: "https://devhunt.org/submit",            category: "launch",      priority: "medium",   note: "Weekly developer tool launch spotlight. Small but targeted audience." },
  { id: "uneed",               name: "Uneed",                       url: "https://www.uneed.best/submit",         category: "directory",   priority: "medium",   note: "Curated dev tool directory. Gets you on a weekly email blast. Free." },
  { id: "youtube_demo",        name: "YouTube Demo Video",          url: "https://studio.youtube.com",            category: "content",     priority: "high",     note: "A 3–5 min screen-recording demo. SEO-indexed by Google. Search: 'multi-agent AI tutorial'." },
  { id: "quora",               name: "Quora (AI Questions)",        url: "https://quora.com",                     category: "community",   priority: "medium",   note: "Answer questions like 'What is the best AI orchestration tool?' and 'How to use multiple AI agents together?' — mention VIBA naturally." },
];

// ─── Content generation templates ────────────────────────────────────────────

type Template = { label: string; system: string; userPrompt: string };

const TEMPLATES: Record<string, Template> = {
  product_hunt: {
    label: "Product Hunt listing",
    system: "You are a product copywriter specialising in Product Hunt launches. Write punchy, benefit-led copy — never use buzzwords or 'thrilled to announce'.",
    userPrompt: `Write a complete Product Hunt submission for VIBA:

1. Tagline (max 60 chars — benefit-led, specific, no buzzwords)
2. Short description (max 260 chars)
3. Maker comment / first comment (200–300 words, personal story-driven)
4. 5 bullet-point feature highlights

Product context:\n${VIBA_CONTEXT}`,
  },

  hacker_news: {
    label: "Show HN post",
    system: "You write Hacker News Show HN posts. Be direct, technical, and humble. No marketing speak. HN rewards honesty.",
    userPrompt: `Write a Show HN post for VIBA.

Format:
Title: "Show HN: [title]" (max 80 chars, factual and specific)
Body: 3–5 short paragraphs. Open with what it does, then the technical approach (how agent routing works), then what makes it different from CrewAI/AutoGen. End with a genuine question inviting feedback.

Tone: developer-to-developer. Admit limitations honestly.

Product context:\n${VIBA_CONTEXT}`,
  },

  reddit_ml: {
    label: "Reddit r/MachineLearning post",
    system: "You write Reddit posts for the ML research community. Technical, precise, no fluff.",
    userPrompt: `Write a Reddit post for r/MachineLearning introducing VIBA.

Format:
- Title (specific, technical, not clickbait)
- Body: explain the orchestration architecture, how capability-based task routing works, what problems it solves vs single-model approaches. Include a "Questions / feedback welcome" section.

Avoid sales language. Treat readers as peers.

Product context:\n${VIBA_CONTEXT}`,
  },

  reddit_artificial: {
    label: "Reddit r/artificial post",
    system: "You write engaging posts for the r/artificial Reddit community.",
    userPrompt: `Write a Reddit post for r/artificial introducing VIBA.

Format:
- Title (engaging, describes what it actually does)
- Body: what it is, a concrete use-case example (e.g. "I assigned Claude as the architect, GPT-4 as the coder, Gemini as the reviewer — VIBA routed the task automatically and surfaced a proof report"), then invite discussion about multi-agent AI.

Product context:\n${VIBA_CONTEXT}`,
  },

  reddit_sideproject: {
    label: "Reddit r/SideProject post",
    system: "You write authentic builder posts for the SideProject community. Honest, personal, never corporate.",
    userPrompt: `Write a Reddit post for r/SideProject introducing VIBA.

Format:
- Title: "[Launch] VIBA — [description]"
- Body: share the builder journey — why you built it, what problems you hit, what you learned. Include current status. End with the link and a request for honest feedback.

Be personal, honest, avoid corporate language.

Product context:\n${VIBA_CONTEXT}`,
  },

  reddit_localllama: {
    label: "Reddit r/LocalLLaMA post",
    system: "You write posts for the LocalLLaMA Reddit community who care about running open/free AI locally.",
    userPrompt: `Write a Reddit post for r/LocalLLaMA about VIBA.

Focus on:
- The free Groq integration (fast inference, no cost, no credit card)
- BYOK philosophy (no lock-in, bring your own keys)
- How VIBA could be used with open/local providers in the future
- Ask for community input on which local providers to support next

Product context:\n${VIBA_CONTEXT}`,
  },

  twitter_x: {
    label: "Twitter / X thread",
    system: "You write viral Twitter/X threads about AI tools. Strong hook, numbered tweets, concrete examples, curiosity gaps.",
    userPrompt: `Write a 10-tweet thread introducing VIBA.

Format:
Tweet 1: (hook — bold statement or surprising insight about multi-agent AI)
Tweet 2–9: (build the story, include concrete examples, explain how it works)
Tweet 10: (CTA with viba.guru link + ask people to RT if they found it useful)

Rules: each tweet max 280 chars. Use line breaks for readability. Tweet 1 must make people click "read more". Use "🧵" at end of tweet 1.

Product context:\n${VIBA_CONTEXT}`,
  },

  linkedin: {
    label: "LinkedIn post",
    system: "You write high-performing LinkedIn posts about AI and developer tools. No 'thrilled to announce'. Open with a scroll-stopper.",
    userPrompt: `Write a LinkedIn post announcing VIBA.

Format:
- Hook line (stops the scroll — a provocative statement or surprising fact about multi-agent AI)
- 3–4 short paragraphs (LinkedIn rewards white space)
- 3–5 bullet highlights
- CTA with viba.guru link
- 5 relevant hashtags

Tone: professional but human. Share a real insight about why multi-agent orchestration matters.

Product context:\n${VIBA_CONTEXT}`,
  },

  devto: {
    label: "Dev.to article",
    system: "You write technical blog posts for developer audiences on Dev.to. Practical, detailed, with code examples.",
    userPrompt: `Write a complete Dev.to article about VIBA.

Structure:
- Title (SEO-friendly, descriptive — e.g. "How I Built a Multi-Agent AI Orchestration Platform")
- Tags: ai, webdev, llm, opensource
- Introduction: why multi-agent AI matters now
- Architecture: how VIBA routes tasks between agents (capability scoring, circuit breakers)
- Quick start walkthrough: set goal → assign roles → run session → review proof report
- 3–4 concrete use-cases
- Conclusion + link to viba.guru

Length: 900–1200 words. Include code snippets where relevant.

Product context:\n${VIBA_CONTEXT}`,
  },

  medium: {
    label: "Medium article",
    system: "You write engaging Medium articles about AI and technology. More narrative-driven than Dev.to.",
    userPrompt: `Write a Medium article about VIBA.

Angle: "The AI coordination problem — and how multi-agent orchestration solves it"

Structure:
- Hook: a real limitation of single-AI workflows
- Narrative: the insight behind VIBA (why you need specialised agents working together)
- How VIBA works (accessible, not overly technical)
- Real-world examples
- Conclusion + viba.guru CTA

Length: 800–1000 words. More story-driven than a tutorial.

Product context:\n${VIBA_CONTEXT}`,
  },

  indiehackers: {
    label: "IndieHackers project post",
    system: "You write transparent, metrics-driven builder posts for IndieHackers. Authentic, honest, builder-to-builder.",
    userPrompt: `Write an IndieHackers project introduction for VIBA.

Include:
- What it is (2 sentences, plain English)
- The problem it solves and who it's for
- How it works (brief)
- Current status: launched, early users, free to start
- Tech stack (Express, React, Drizzle, PostgreSQL, Groq)
- What you're looking for: feedback, early users, collaborators
- Link to viba.guru

Tone: honest, builder-to-builder, no hype.

Product context:\n${VIBA_CONTEXT}`,
  },

  discord_communities: {
    label: "Discord announcement",
    system: "You write concise, engaging Discord messages for AI community servers. Conversational, not a press release.",
    userPrompt: `Write a Discord message to introduce VIBA in an AI community server.

Format:
- 2–3 short paragraphs
- Lead with what makes it different (multi-provider orchestration, BYOK, free via Groq)
- Invite people to try it and share feedback
- Link to viba.guru
- Tasteful use of emojis (don't overdo it)

Keep it conversational — like a community member sharing something cool, not a brand announcement.

Product context:\n${VIBA_CONTEXT}`,
  },

  github_awesome: {
    label: "GitHub Awesome List PR",
    system: "You write concise, accurate descriptions for GitHub awesome lists. One-liner entries and clear PR descriptions.",
    userPrompt: `Write a pull request to add VIBA to an awesome list (e.g. awesome-llm-apps, awesome-ai-agents).

Include:
1. Markdown list entry: [VIBA](https://viba.guru) — one-liner description (max 100 chars)
2. PR title
3. PR body: why VIBA belongs in the list (2–3 sentences), what category it fits

Product context:\n${VIBA_CONTEXT}`,
  },

  tldr_ai: {
    label: "TLDR AI newsletter submission",
    system: "You write tight, punchy newsletter submissions for TLDR AI. Readers scan fast — every word counts.",
    userPrompt: `Write a TLDR AI newsletter submission for VIBA.

Format:
- Headline (max 80 chars, factual and intriguing)
- Summary (2–3 sentences: what it is, what makes it notable, why readers should care)
- Link: https://viba.guru

No hype. No adjectives like "revolutionary". Just what it does and why it matters.

Product context:\n${VIBA_CONTEXT}`,
  },

  bens_bites: {
    label: "Ben's Bites newsletter pitch",
    system: "You write short, direct newsletter pitches for Ben's Bites AI newsletter.",
    userPrompt: `Write a Ben's Bites newsletter submission pitch for VIBA.

Format:
- Subject line (for the email pitch)
- 2–3 sentence description of VIBA (why Ben's Bites readers would care)
- Link: https://viba.guru
- One sentence on why it's timely / relevant now

Tone: direct, confident, no buzzwords.

Product context:\n${VIBA_CONTEXT}`,
  },
};

// ─── In-memory submission log (max 200 entries, cleared on restart) ───────────

type SubmissionStatus = "draft" | "posted" | "scheduled" | "failed";

type Submission = {
  id: string;
  channelId: string;
  channelName: string;
  contentType: string;
  content: string;
  status: SubmissionStatus;
  note: string;
  createdAt: string;
  postedUrl?: string;
  submitError?: string;
};

// ─── Auto-submit result type ──────────────────────────────────────────────────

type SubmitResult =
  | { ok: true; url?: string }
  | { ok: false; reason: string; manualUrl?: string; credential?: string };

// ─── Runtime credential store (in-memory, survives per-process) ───────────────
// Values set here take precedence over process.env.
// Keys: devto_api_key, discord_webhook_url, reddit_client_id,
//       reddit_client_secret, reddit_username, reddit_password

const channelConfigs: Record<string, string> = {};

function getCred(envKey: string, storeKey: string): string | undefined {
  return channelConfigs[storeKey] || process.env[envKey] || undefined;
}

// ─── Dev.to submitter ─────────────────────────────────────────────────────────

async function submitDevTo(content: string): Promise<SubmitResult> {
  const apiKey = getCred("DEV_TO_API_KEY", "devto_api_key");
  if (!apiKey) return { ok: false, reason: "missing_credential", credential: "DEV_TO_API_KEY", manualUrl: "https://dev.to/new" };

  // Parse title — first markdown heading, bold line, or first line
  const titleMatch = content.match(/^#+\s+(.+)$/m) ?? content.match(/^\*\*(.+?)\*\*/) ?? content.match(/^(.+)$/m);
  const rawTitle = (titleMatch?.[1] ?? "VIBA — Multi-Agent AI Orchestration Platform").replace(/[*_#`]/g, "").trim();
  const title = rawTitle.slice(0, 100);

  // Strip the title line from body to avoid duplication
  const body = content.replace(/^#+\s+.+\n?/, "").trim();

  const res = await fetch("https://dev.to/api/articles", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      article: {
        title,
        body_markdown: body,
        tags: ["ai", "webdev", "llm", "opensource"],
        published: true,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => String(res.status));
    return { ok: false, reason: `Dev.to API error ${res.status}: ${err.slice(0, 200)}`, manualUrl: "https://dev.to/new" };
  }

  const data = await res.json() as { url?: string };
  return { ok: true, url: data.url };
}

// ─── Discord webhook submitter ────────────────────────────────────────────────

async function submitDiscord(content: string): Promise<SubmitResult> {
  const webhookUrl = getCred("DISCORD_WEBHOOK_URL", "discord_webhook_url");
  if (!webhookUrl) return { ok: false, reason: "missing_credential", credential: "DISCORD_WEBHOOK_URL", manualUrl: "https://discord.com" };

  // Discord messages max 2000 chars — split if needed
  const chunk = content.slice(0, 2000);

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: chunk, username: "VIBA Growth Bot" }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => String(res.status));
    return { ok: false, reason: `Discord webhook error ${res.status}: ${err.slice(0, 200)}`, manualUrl: "https://discord.com" };
  }
  return { ok: true };
}

// ─── Reddit submitter (script-app password grant) ────────────────────────────

const REDDIT_SUBREDDITS: Record<string, string> = {
  reddit_ml:          "MachineLearning",
  reddit_artificial:  "artificial",
  reddit_sideproject: "SideProject",
  reddit_localllama:  "LocalLLaMA",
};

async function submitReddit(channelId: string, content: string): Promise<SubmitResult> {
  const clientId     = getCred("REDDIT_CLIENT_ID",     "reddit_client_id");
  const clientSecret = getCred("REDDIT_CLIENT_SECRET", "reddit_client_secret");
  const username     = getCred("REDDIT_USERNAME",      "reddit_username");
  const password     = getCred("REDDIT_PASSWORD",      "reddit_password");

  const subreddit = REDDIT_SUBREDDITS[channelId];
  if (!subreddit) return { ok: false, reason: `No subreddit mapping for ${channelId}` };

  if (!clientId || !clientSecret || !username || !password) {
    return {
      ok: false,
      reason: "missing_credential",
      credential: "REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD",
      manualUrl: `https://reddit.com/r/${subreddit}/submit`,
    };
  }

  // Obtain access token (password grant — requires "script" app type on reddit.com/prefs/apps)
  const tokenRes = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "VIBA-Growth-Bot/1.0 by /u/vibabot",
    },
    body: new URLSearchParams({ grant_type: "password", username, password }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!tokenRes.ok) {
    return { ok: false, reason: `Reddit auth failed: ${tokenRes.status}`, manualUrl: `https://reddit.com/r/${subreddit}/submit` };
  }

  const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    return { ok: false, reason: `Reddit auth error: ${tokenData.error ?? "no token"}`, manualUrl: `https://reddit.com/r/${subreddit}/submit` };
  }

  // Parse title (first heading or first non-empty line) and body
  const lines = content.split("\n").filter(Boolean);
  const rawTitle = (lines[0] ?? "VIBA — Multi-Agent AI Orchestration").replace(/^#+\s*/, "").replace(/^\[.*?\]\s*/, "").replace(/\*\*/g, "").trim();
  const title = rawTitle.slice(0, 300);
  const body = lines.slice(1).join("\n").trim();

  const submitRes = await fetch("https://oauth.reddit.com/api/submit", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "VIBA-Growth-Bot/1.0 by /u/vibabot",
    },
    body: new URLSearchParams({ sr: subreddit, kind: "self", title, text: body, nsfw: "false", spoiler: "false", resubmit: "true" }),
    signal: AbortSignal.timeout(20_000),
  });

  const submitData = await submitRes.json() as { json?: { errors?: unknown[]; data?: { url?: string } } };
  const errors = submitData?.json?.errors ?? [];
  if (errors.length > 0) {
    return { ok: false, reason: `Reddit submit error: ${JSON.stringify(errors).slice(0, 200)}`, manualUrl: `https://reddit.com/r/${subreddit}/submit` };
  }

  const url = submitData?.json?.data?.url;
  return { ok: true, url };
}

// ─── Channel dispatch table ───────────────────────────────────────────────────

async function dispatchSubmit(entry: Submission): Promise<SubmitResult> {
  const { channelId, content } = entry;
  const channel = CHANNELS.find(c => c.id === channelId);

  if (channelId === "devto")                            return submitDevTo(content);
  if (channelId === "discord_communities")              return submitDiscord(content);
  if (Object.keys(REDDIT_SUBREDDITS).includes(channelId)) return submitReddit(channelId, content);

  // All other channels require manual posting — return URL + content ready to paste
  return {
    ok: false,
    reason: "manual_required",
    manualUrl: channel?.url ?? "https://viba.guru",
  };
}

const submissionLog: Submission[] = [];

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── GET /api/admin/growth/channels ──────────────────────────────────────────

router.get("/channels", (_req, res): void => {
  const postedIds = new Set(submissionLog.filter(s => s.status === "posted").map(s => s.channelId));
  res.json({
    channels: CHANNELS.map(c => ({ ...c, posted: postedIds.has(c.id) })),
    totalPosted: postedIds.size,
    totalChannels: CHANNELS.length,
  });
});

// ─── GET /api/admin/growth/seo ────────────────────────────────────────────────

router.get("/seo", (_req, res): void => {
  res.json({
    domain: "viba.guru",
    keywords: {
      primary: [
        "multi-agent AI",
        "AI orchestration platform",
        "agent collaboration",
        "AI workflow automation",
      ],
      secondary: [
        "ChatGPT Claude Gemini together",
        "AI agent roles",
        "BYOK AI platform",
        "multi-LLM orchestration",
      ],
      longtail: [
        "how to run multiple AI agents together",
        "connect ChatGPT and Claude in one workflow",
        "AI orchestration platform for developers",
        "multi-LLM task routing open source",
        "AI agent role assignment platform",
        "VIBA vs CrewAI vs AutoGen",
      ],
      competitors: ["CrewAI", "AutoGen", "LangGraph", "AgentOps", "Flowise", "Dify"],
    },
    checklist: [
      { item: "Title tag optimised (60 chars, primary keyword)", done: false },
      { item: "Meta description < 160 chars", done: false },
      { item: "Open Graph image (1200×630)", done: false },
      { item: "Twitter Card meta tags", done: false },
      { item: "Sitemap.xml at /sitemap.xml", done: false },
      { item: "robots.txt configured", done: false },
      { item: "Schema.org SoftwareApplication markup", done: false },
      { item: "/llms.txt for GEO / AI-search citation", done: false },
      { item: "Comparison pages (VIBA vs CrewAI, VIBA vs AutoGen)", done: false },
      { item: "Blog: 3 keyword-targeted posts published", done: false },
      { item: "Backlinks from 3+ awesome-* GitHub lists", done: false },
      { item: "Mentioned in 2+ AI newsletters", done: false },
    ],
    geoActions: [
      "Add /llms.txt — plain-English description for AI crawlers",
      "Add SoftwareApplication + FAQPage schema markup",
      "Create /compare/viba-vs-crewai and /compare/viba-vs-autogen pages",
      "Get cited in TLDR AI, Ben's Bites, The Rundown AI",
      "Post 3 technical articles on Dev.to (indexed by Perplexity/ChatGPT browse)",
    ],
  });
});

// ─── GET /api/admin/growth/submissions ───────────────────────────────────────

router.get("/submissions", (_req, res): void => {
  res.json({ submissions: [...submissionLog].reverse(), total: submissionLog.length });
});

// ─── POST /api/admin/growth/submissions ──────────────────────────────────────

router.post("/submissions", (req, res): void => {
  const body = req.body as Partial<Submission>;
  if (!body.channelId || !body.content) {
    res.status(400).json({ error: "channelId and content are required" });
    return;
  }
  const entry: Submission = {
    id: makeId(),
    channelId: String(body.channelId),
    channelName: String(body.channelName ?? body.channelId),
    contentType: String(body.contentType ?? "post"),
    content: String(body.content).slice(0, 10_000),
    status: (["draft", "posted", "scheduled"].includes(body.status as string)
      ? body.status
      : "draft") as SubmissionStatus,
    note: String(body.note ?? ""),
    createdAt: new Date().toISOString(),
  };
  submissionLog.push(entry);
  if (submissionLog.length > 200) submissionLog.splice(0, submissionLog.length - 200);
  res.json({ ok: true, entry });
});

// ─── PATCH /api/admin/growth/submissions/:id ─────────────────────────────────

router.patch("/submissions/:id", (req, res): void => {
  const entry = submissionLog.find(s => s.id === String(req.params.id ?? ""));
  if (!entry) { res.status(404).json({ error: "not found" }); return; }
  const body = req.body as Partial<Submission>;
  if (body.status && ["draft", "posted", "scheduled"].includes(body.status)) {
    entry.status = body.status as SubmissionStatus;
  }
  if (body.note !== undefined) entry.note = String(body.note);
  res.json({ ok: true, entry });
});

// ─── DELETE /api/admin/growth/submissions/:id ────────────────────────────────

router.delete("/submissions/:id", (req, res): void => {
  const idx = submissionLog.findIndex(s => s.id === String(req.params.id ?? ""));
  if (idx === -1) { res.status(404).json({ error: "not found" }); return; }
  submissionLog.splice(idx, 1);
  res.json({ ok: true });
});

// ─── POST /api/admin/growth/generate ─────────────────────────────────────────

router.post("/generate", async (req, res): Promise<void> => {
  const { channelId } = req.body as { channelId?: string };
  if (!channelId) { res.status(400).json({ error: "channelId required" }); return; }

  const template = TEMPLATES[channelId];
  if (!template) {
    res.status(400).json({ error: `No generation template for '${channelId}'` });
    return;
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    res.status(503).json({ error: "GROQ_API_KEY not set — add it to start generating content" });
    return;
  }

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: template.system },
          { role: "user", content: template.userPrompt },
        ],
        temperature: 0.72,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      res.status(502).json({ error: `Groq API error ${groqRes.status}: ${errText.slice(0, 300)}` });
      return;
    }

    const data = (await groqRes.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    res.json({ ok: true, content, channelId, label: template.label });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /api/admin/growth/blast ─────────────────────────────────────────────
// Generates content for every channel that has a template and saves each as a
// draft in the submission log. Returns a per-channel result summary.

router.post("/blast", async (req, res): Promise<void> => {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    res.status(503).json({ error: "GROQ_API_KEY not set — add it to start generating content" });
    return;
  }

  // delayMs between requests — Groq free tier is 12 000 TPM (~2 000 tokens/request → max 6 req/min)
  // Default 10 s gap keeps us safely under limit. Caller can pass { delayMs } to override.
  const body = req.body as { delayMs?: unknown };
  const delayMs = typeof body.delayMs === "number" && body.delayMs >= 0 ? body.delayMs : 10_000;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const templateIds = Object.keys(TEMPLATES);
  const results: { channelId: string; channelName: string; label: string; ok: boolean; error?: string }[] = [];

  for (let i = 0; i < templateIds.length; i++) {
    const channelId = templateIds[i]!;
    const template = TEMPLATES[channelId]!;
    const channel = CHANNELS.find(c => c.id === channelId);
    const channelName = channel?.name ?? channelId;

    // Rate-limit guard: pause between requests (skip before first)
    if (i > 0) await sleep(delayMs);

    try {
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: template.system },
            { role: "user", content: template.userPrompt },
          ],
          temperature: 0.72,
          max_tokens: 2048,
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (!groqRes.ok) {
        const errText = await groqRes.text();
        results.push({ channelId, channelName, label: template.label, ok: false, error: `Groq ${groqRes.status}: ${errText.slice(0, 200)}` });
        continue;
      }

      const data = (await groqRes.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content ?? "";

      const entry: Submission = {
        id: makeId(),
        channelId,
        channelName,
        contentType: "post",
        content,
        status: "draft",
        note: `Blast generated ${new Date().toISOString()}`,
        createdAt: new Date().toISOString(),
      };
      submissionLog.push(entry);
      if (submissionLog.length > 200) submissionLog.splice(0, submissionLog.length - 200);

      results.push({ channelId, channelName, label: template.label, ok: true });
    } catch (err) {
      results.push({ channelId, channelName, label: template.label, ok: false, error: String(err) });
    }
  }

  const succeeded = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  res.json({ ok: true, succeeded, failed, total: results.length, results });
});

// ─── GET /api/admin/growth/credentials ───────────────────────────────────────
// Shows which auto-submit credentials are configured so the admin panel
// can indicate which channels can post automatically vs manually.

router.get("/credentials", (_req, res): void => {
  res.json({
    devto:   { configured: !!(getCred("DEV_TO_API_KEY", "devto_api_key")),      credential: "DEV_TO_API_KEY",       channel: "Dev.to" },
    discord: { configured: !!(getCred("DISCORD_WEBHOOK_URL", "discord_webhook_url")), credential: "DISCORD_WEBHOOK_URL",  channel: "Discord" },
    reddit:  {
      configured: !!(getCred("REDDIT_CLIENT_ID","reddit_client_id") && getCred("REDDIT_CLIENT_SECRET","reddit_client_secret") && getCred("REDDIT_USERNAME","reddit_username") && getCred("REDDIT_PASSWORD","reddit_password")),
      credential: "REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET + REDDIT_USERNAME + REDDIT_PASSWORD",
      channel: "Reddit (r/MachineLearning, r/artificial, r/SideProject, r/LocalLLaMA)",
    },
    manual_channels: [
      { id: "product_hunt",   name: "Product Hunt",  url: "https://www.producthunt.com/posts/new",  reason: "OAuth required" },
      { id: "hacker_news",    name: "Hacker News",   url: "https://news.ycombinator.com/submit",   reason: "No API" },
      { id: "twitter_x",      name: "Twitter / X",   url: "https://x.com",                         reason: "OAuth required (paid tier)" },
      { id: "linkedin",       name: "LinkedIn",      url: "https://linkedin.com/post/new",          reason: "OAuth required" },
      { id: "medium",         name: "Medium",        url: "https://medium.com/new-story",           reason: "No public API" },
      { id: "indiehackers",   name: "IndieHackers",  url: "https://www.indiehackers.com/post",      reason: "No API" },
      { id: "tldr_ai",        name: "TLDR AI",       url: "https://tldr.tech/ai/submit",            reason: "Email/form only" },
      { id: "bens_bites",     name: "Ben's Bites",   url: "https://bensbites.beehiiv.com/forms",    reason: "Email/form only" },
      { id: "futurepedia",    name: "Futurepedia",   url: "https://www.futurepedia.io/submit-tool", reason: "Web form only" },
      { id: "taaft",          name: "TAAFT",         url: "https://theresanaiforthat.com/tool/submit/", reason: "Web form only" },
      { id: "github_awesome", name: "GitHub Awesome Lists", url: "https://github.com/search?q=awesome+llm", reason: "Manual PR to target repo" },
    ],
  });
});

// ─── GET /api/admin/growth/channel-config ────────────────────────────────────
// Returns which credential keys are set (values masked). Used by admin UI to
// show "configured" badges and pre-populate form fields (empty string = not set).

router.get("/channel-config", (_req, res): void => {
  const mask = (key: string) => channelConfigs[key] ? "••••••••" : "";
  res.json({
    devto_api_key:        mask("devto_api_key"),
    discord_webhook_url:  mask("discord_webhook_url"),
    reddit_client_id:     mask("reddit_client_id"),
    reddit_client_secret: mask("reddit_client_secret"),
    reddit_username:      channelConfigs["reddit_username"] ?? "",   // username is not secret
    reddit_password:      mask("reddit_password"),
    configured: {
      devto:   !!(getCred("DEV_TO_API_KEY", "devto_api_key")),
      discord: !!(getCred("DISCORD_WEBHOOK_URL", "discord_webhook_url")),
      reddit:  !!(getCred("REDDIT_CLIENT_ID","reddit_client_id") && getCred("REDDIT_CLIENT_SECRET","reddit_client_secret") && getCred("REDDIT_USERNAME","reddit_username") && getCred("REDDIT_PASSWORD","reddit_password")),
    },
  });
});

// ─── POST /api/admin/growth/channel-config ────────────────────────────────────
// Saves runtime credentials for auto-submit channels. Values are stored in the
// in-memory channelConfigs map — they take effect immediately and survive
// until the process restarts. Set an env var of the same name for persistence.
// Body: { devto_api_key?, discord_webhook_url?, reddit_client_id?,
//          reddit_client_secret?, reddit_username?, reddit_password? }

router.post("/channel-config", (req, res): void => {
  const allowed = ["devto_api_key","discord_webhook_url","reddit_client_id","reddit_client_secret","reddit_username","reddit_password"];
  const body = req.body as Record<string, unknown>;
  let saved = 0;
  for (const key of allowed) {
    const val = body[key];
    if (typeof val === "string") {
      if (val.trim() === "") {
        delete channelConfigs[key];
      } else {
        channelConfigs[key] = val.trim();
        saved++;
      }
    }
  }
  res.json({
    ok: true,
    saved,
    configured: {
      devto:   !!(getCred("DEV_TO_API_KEY", "devto_api_key")),
      discord: !!(getCred("DISCORD_WEBHOOK_URL", "discord_webhook_url")),
      reddit:  !!(getCred("REDDIT_CLIENT_ID","reddit_client_id") && getCred("REDDIT_CLIENT_SECRET","reddit_client_secret") && getCred("REDDIT_USERNAME","reddit_username") && getCred("REDDIT_PASSWORD","reddit_password")),
    },
  });
});

// ─── POST /api/admin/growth/auto-submit/:id ───────────────────────────────────
// Attempts to auto-post a saved submission draft to its channel.
// Updates submission status to "posted" on success or "failed" on error.
// For manual-only channels, returns { ok: false, manual: true, content, url }.

router.post("/auto-submit/:id", async (req, res): Promise<void> => {
  const id = String(req.params["id"] ?? "");
  const entry = submissionLog.find(s => s.id === id);
  if (!entry) {
    res.status(404).json({ error: "submission_not_found", message: `No draft with id '${id}'` });
    return;
  }

  try {
    const result = await dispatchSubmit(entry);

    if (result.ok) {
      entry.status = "posted";
      entry.postedUrl = result.url;
      entry.note = `Auto-posted ${new Date().toISOString()}${result.url ? ` → ${result.url}` : ""}`;
      res.json({ ok: true, channelId: entry.channelId, channelName: entry.channelName, url: result.url });
    } else {
      const isManual = result.reason === "manual_required";
      const isMissingCred = result.reason === "missing_credential";

      if (isManual || isMissingCred) {
        // Not an error — just requires human action
        res.json({
          ok: false,
          manual: true,
          channelId: entry.channelId,
          channelName: entry.channelName,
          reason: result.reason,
          credential: (result as { credential?: string }).credential,
          manualUrl: result.manualUrl,
          content: entry.content,
          instructions: isManual
            ? `Open ${result.manualUrl} and paste the generated content.`
            : `Set ${(result as { credential?: string }).credential ?? "required"} in environment variables to enable auto-posting.`,
        });
      } else {
        entry.status = "failed";
        entry.submitError = result.reason;
        res.status(502).json({ ok: false, channelId: entry.channelId, error: result.reason, manualUrl: result.manualUrl });
      }
    }
  } catch (err) {
    entry.status = "failed";
    entry.submitError = String(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── AUTOPILOT ────────────────────────────────────────────────────────────────
// Background scheduler: generates content for every templated channel via Groq,
// then auto-submits to all configured channels (Dev.to, Discord, Reddit).
// Manual channels get their content saved as ready-to-paste drafts.

type AutopilotRunResult = {
  channelId: string;
  channelName: string;
  generated: boolean;
  posted: boolean;
  manual: boolean;
  url?: string;
  error?: string;
};

type AutopilotState = {
  enabled: boolean;
  intervalHours: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  running: boolean;
  lastRunResults: AutopilotRunResult[];
  lastRunSummary: { generated: number; posted: number; manual: number; failed: number } | null;
};

const autopilot: AutopilotState = {
  enabled: true,
  intervalHours: 24,
  lastRunAt: null,
  nextRunAt: null,
  running: false,
  lastRunResults: [],
  lastRunSummary: null,
};

let autopilotTimer: ReturnType<typeof setTimeout> | null = null;

async function runAutopilotCycle(): Promise<void> {
  if (autopilot.running) return;
  autopilot.running = true;
  autopilot.lastRunAt = new Date().toISOString();
  autopilot.lastRunResults = [];

  const groqKey = process.env.GROQ_API_KEY;
  const delayMs = 10_000;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const templateIds = Object.keys(TEMPLATES);

  for (let i = 0; i < templateIds.length; i++) {
    const channelId = templateIds[i]!;
    const template = TEMPLATES[channelId]!;
    const channel = CHANNELS.find(c => c.id === channelId);
    const channelName = channel?.name ?? channelId;
    const result: AutopilotRunResult = { channelId, channelName, generated: false, posted: false, manual: false };

    if (!groqKey) {
      result.error = "GROQ_API_KEY not set";
      autopilot.lastRunResults.push(result);
      continue;
    }

    if (i > 0) await sleep(delayMs);

    // 1. Generate content
    let content = "";
    try {
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "system", content: template.system }, { role: "user", content: template.userPrompt }],
          temperature: 0.72,
          max_tokens: 2048,
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!groqRes.ok) {
        result.error = `Groq ${groqRes.status}`;
        autopilot.lastRunResults.push(result);
        continue;
      }
      const data = await groqRes.json() as { choices?: { message?: { content?: string } }[] };
      content = data.choices?.[0]?.message?.content ?? "";
      result.generated = true;
    } catch (err) {
      result.error = `Generate failed: ${String(err)}`;
      autopilot.lastRunResults.push(result);
      continue;
    }

    // 2. Save as draft
    const entry: Submission = {
      id: makeId(),
      channelId,
      channelName,
      contentType: "post",
      content,
      status: "draft",
      note: `Autopilot run ${autopilot.lastRunAt}`,
      createdAt: new Date().toISOString(),
    };
    submissionLog.push(entry);
    if (submissionLog.length > 200) submissionLog.splice(0, submissionLog.length - 200);

    // 3. Attempt auto-submit
    try {
      const submitResult = await dispatchSubmit(entry);
      if (submitResult.ok) {
        entry.status = "posted";
        entry.postedUrl = submitResult.url;
        entry.note = `Autopilot posted ${new Date().toISOString()}${submitResult.url ? ` → ${submitResult.url}` : ""}`;
        result.posted = true;
        result.url = submitResult.url;
      } else {
        result.manual = submitResult.reason === "manual_required" || submitResult.reason === "missing_credential";
        if (!result.manual) result.error = submitResult.reason;
      }
    } catch (err) {
      result.error = `Submit failed: ${String(err)}`;
    }

    autopilot.lastRunResults.push(result);
  }

  autopilot.running = false;
  autopilot.lastRunSummary = {
    generated: autopilot.lastRunResults.filter(r => r.generated).length,
    posted:    autopilot.lastRunResults.filter(r => r.posted).length,
    manual:    autopilot.lastRunResults.filter(r => r.manual && !r.error).length,
    failed:    autopilot.lastRunResults.filter(r => !!r.error).length,
  };

  // Schedule next run if still enabled
  if (autopilot.enabled) scheduleAutopilot();
}

function scheduleAutopilot(): void {
  if (autopilotTimer) { clearTimeout(autopilotTimer); autopilotTimer = null; }
  if (!autopilot.enabled) { autopilot.nextRunAt = null; return; }

  const nextMs = autopilot.intervalHours * 60 * 60 * 1000;
  autopilot.nextRunAt = new Date(Date.now() + nextMs).toISOString();
  autopilotTimer = setTimeout(() => { void runAutopilotCycle(); }, nextMs);
}

// ─── GET /api/admin/growth/autopilot ─────────────────────────────────────────

router.get("/autopilot", (_req, res): void => {
  res.json(autopilot);
});

// ─── POST /api/admin/growth/autopilot ────────────────────────────────────────
// Body: { enabled: boolean, intervalHours?: number }

router.post("/autopilot", (req, res): void => {
  const body = req.body as { enabled?: unknown; intervalHours?: unknown };
  if (typeof body.enabled === "boolean") autopilot.enabled = body.enabled;
  if (typeof body.intervalHours === "number" && body.intervalHours >= 1) {
    autopilot.intervalHours = Math.min(body.intervalHours, 168); // max 1 week
  }
  scheduleAutopilot();
  res.json({ ok: true, autopilot });
});

// ─── POST /api/admin/growth/autopilot/run-now ─────────────────────────────────
// Trigger one autopilot cycle immediately (does not affect the schedule).

router.post("/autopilot/run-now", async (req, res): Promise<void> => {
  if (autopilot.running) {
    res.status(409).json({ error: "Autopilot cycle already running" });
    return;
  }
  // Respond immediately then run in background
  res.json({ ok: true, message: "Autopilot cycle started — results will appear in /autopilot status" });
  void runAutopilotCycle();
});

// ─── POST /api/admin/growth/generate-and-submit ───────────────────────────────
// Generate content for a channel with Groq, save as draft, then immediately
// attempt to auto-submit. Single endpoint for one-click publish flows.
// Body: { channelId: string }

router.post("/generate-and-submit", async (req, res): Promise<void> => {
  const { channelId } = req.body as { channelId?: string };
  if (!channelId) { res.status(400).json({ error: "channelId required" }); return; }

  const template = TEMPLATES[channelId];
  if (!template) { res.status(400).json({ error: `No generation template for '${channelId}'` }); return; }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) { res.status(503).json({ error: "GROQ_API_KEY not set" }); return; }

  const channel = CHANNELS.find(c => c.id === channelId);

  // Step 1 — generate content
  let content: string;
  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: template.system }, { role: "user", content: template.userPrompt }],
        temperature: 0.72,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!groqRes.ok) {
      const errText = await groqRes.text();
      res.status(502).json({ error: `Groq error ${groqRes.status}: ${errText.slice(0, 300)}` });
      return;
    }
    const data = await groqRes.json() as { choices?: { message?: { content?: string } }[] };
    content = data.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    res.status(500).json({ error: `Content generation failed: ${String(err)}` });
    return;
  }

  // Step 2 — save as draft
  const entry: Submission = {
    id: makeId(),
    channelId,
    channelName: channel?.name ?? channelId,
    contentType: "post",
    content,
    status: "draft",
    note: `generate-and-submit ${new Date().toISOString()}`,
    createdAt: new Date().toISOString(),
  };
  submissionLog.push(entry);
  if (submissionLog.length > 200) submissionLog.splice(0, submissionLog.length - 200);

  // Step 3 — attempt auto-submit
  try {
    const result = await dispatchSubmit(entry);
    if (result.ok) {
      entry.status = "posted";
      entry.postedUrl = result.url;
      entry.note = `Auto-posted ${new Date().toISOString()}${result.url ? ` → ${result.url}` : ""}`;
      res.json({ ok: true, posted: true, channelId, channelName: entry.channelName, url: result.url, content });
    } else {
      const isManual = result.reason === "manual_required" || result.reason === "missing_credential";
      res.json({
        ok: true,
        posted: false,
        manual: isManual,
        channelId,
        channelName: entry.channelName,
        submissionId: entry.id,
        reason: result.reason,
        credential: (result as { credential?: string }).credential,
        manualUrl: result.manualUrl,
        content,
        instructions: result.reason === "missing_credential"
          ? `Add ${(result as { credential?: string }).credential ?? "required env var"} to auto-post this channel.`
          : `Open ${result.manualUrl ?? channel?.url} and paste the content.`,
      });
    }
  } catch (err) {
    entry.status = "failed";
    entry.submitError = String(err);
    res.status(500).json({ ok: false, error: String(err), content, submissionId: entry.id });
  }
});

// Auto-start the growth autopilot when the module loads.
// First cycle fires after 5-minute warm-up (lets DB and sessions stabilise);
// subsequent cycles run every `intervalHours` hours (default 24h).
// Channels with credentials (DEV_TO_API_KEY, DISCORD_WEBHOOK_URL, etc.) will
// be auto-posted; all others are saved as ready-to-paste drafts in the
// submission log at GET /api/admin/growth/submissions.
setTimeout(() => {
  scheduleAutopilot();
}, 5 * 60 * 1000);

export default router;
