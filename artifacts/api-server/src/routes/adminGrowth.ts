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

type SubmissionStatus = "draft" | "posted" | "scheduled";

type Submission = {
  id: string;
  channelId: string;
  channelName: string;
  contentType: string;
  content: string;
  status: SubmissionStatus;
  note: string;
  createdAt: string;
};

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

export default router;
