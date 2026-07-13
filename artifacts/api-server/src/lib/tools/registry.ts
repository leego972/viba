/**
 * VIBA Unified Tool Registry
 *
 * Every tool VIBA owns lives here. Any agent (Groq, Claude, GPT-4o, Manus, etc.)
 * calls these tools through this registry — no agent needs its own toolset.
 *
 * Tools available:
 *   Web tools        — web_fetch, web_search, npm_search, npm_package_info
 *   HTTP tools       — http_request (call any REST API)
 *   GitHub tools     — read/write repo files (when githubToken provided)
 *   Browser tools    — navigate, screenshot, click, type, extract (VIBA Chromium)
 *   User Browser     — navigate, screenshot, click, type, extract (user's real Chrome via CDP)
 *   Vision tools     — analyze_image, compare_frames, check_person, check_background (Groq free)
 *   Continuity tools — run_check, score_report (Groq free vision)
 *   Site operator    — site_login, site_api_call, site_fill_and_submit (vault + Chromium)
 *   Memory tools     — memory_store, memory_recall, memory_clear (in-session agent memory)
 *   Email tools      — email_send (SMTP)
 *   Discord tools    — discord_webhook (post to Discord channels)
 *   PDF tools        — pdf_extract (read PDF content from URL)
 *   File tools       — file_write, file_read, file_list (agent workspace)
 *   Code sandbox     — code_run (execute Node.js safely)
 *   SQL tools        — sql_query (read-only PostgreSQL)
 *   Translate tools  — text_translate (any language via Groq)
 *   Diff/Stripe tools — diff_generate, stripe_query
 */

import { getGitHubTools, type GitHubContext } from "./github";
import { getWebTools } from "./web";
import { getBrowserTools } from "./browser";
import { getVisionTools } from "./vision";
import { getContinuityTools } from "./continuity";
import { getSiteOperatorTools } from "./siteOperator";
import { getUserBrowserTools } from "./userBrowser";
import { getSearchTools } from "./search";
import { getHttpTools } from "./httprequest";
import { getMailerTools } from "./mailer";
import { getMemoryTools } from "./memory";
import { getSandboxTools } from "./sandbox";
import { getDiscordTools } from "./discord";
import { getPdfTools } from "./pdf";
import { getFilestoreTools } from "./filestore";
import { getSqlTools } from "./sqltool";
import { getTranslateTools } from "./translate";
import { getDiffTools } from "./diff";

export interface ToolContext {
  githubToken?: string;
  userId?: number | null;
}

export interface RegistryTool {
  definition: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

function buildAllTools(ctx: ToolContext): RegistryTool[] {
  const tools: RegistryTool[] = [];

  const wrap = (t: { definition: RegistryTool["definition"]; execute(args: Record<string, unknown>): Promise<string> }) =>
    ({ definition: t.definition, execute: (args: Record<string, unknown>) => t.execute(args) });

  // ── Web tools — always available ─────────────────────────────────────────
  for (const t of getWebTools()) tools.push(wrap(t));

  // ── Search tools — always available ──────────────────────────────────────
  for (const t of getSearchTools()) tools.push(wrap(t));

  // ── HTTP tools — always available ────────────────────────────────────────
  for (const t of getHttpTools()) tools.push(wrap(t));

  // ── Browser tools — VIBA Chromium, always available ──────────────────────
  for (const t of getBrowserTools()) tools.push(wrap(t));

  // ── Vision tools — Groq free vision model, always available ──────────────
  for (const t of getVisionTools()) tools.push(wrap(t));

  // ── Continuity tools — Groq free, always available ───────────────────────
  for (const t of getContinuityTools()) tools.push(wrap(t));

  // ── Site operator tools — vault + Chromium, always available ─────────────
  for (const t of getSiteOperatorTools()) {
    tools.push({ definition: t.definition, execute: (args) => t.execute(args, ctx.userId) });
  }

  // ── User Browser tools — user's real Chrome via CDP (when connected) ──────
  for (const t of getUserBrowserTools()) {
    tools.push({ definition: t.definition, execute: (args) => t.execute(args, ctx.userId ?? null) });
  }

  // ── Memory tools — in-session agent memory, always available ─────────────
  for (const t of getMemoryTools()) tools.push(wrap(t));

  // ── Email tools — SMTP, always available (requires SMTP config) ──────────
  for (const t of getMailerTools()) tools.push(wrap(t));

  // ── Discord tools — webhook, always available (requires DISCORD_WEBHOOK_URL) ──
  for (const t of getDiscordTools()) tools.push(wrap(t));

  // ── PDF tools — always available ─────────────────────────────────────────
  for (const t of getPdfTools()) tools.push(wrap(t));

  // ── File tools — agent workspace, always available ───────────────────────
  for (const t of getFilestoreTools()) tools.push(wrap(t));

  // ── Code sandbox — Node.js execution, always available ───────────────────
  for (const t of getSandboxTools()) tools.push(wrap(t));

  // ── SQL tools — read-only DB, always available (requires DATABASE_URL) ────
  for (const t of getSqlTools()) tools.push(wrap(t));

  // ── Translate tools — Groq + MyMemory fallback, always available ──────────
  for (const t of getTranslateTools()) tools.push(wrap(t));

  // ── Diff + Stripe tools — always available ───────────────────────────────
  for (const t of getDiffTools()) tools.push(wrap(t));

  // ── GitHub tools — only when token is provided ───────────────────────────
  if (ctx.githubToken) {
    const ghCtx: GitHubContext = { token: ctx.githubToken };
    for (const t of getGitHubTools()) {
      tools.push({ definition: t.definition, execute: (args) => t.execute(args, ghCtx) });
    }
  }

  return tools;
}

/**
 * Returns tool definitions (schemas) for all tools available in this context.
 * Pass to any LLM as the `tools` parameter.
 */
export function getToolDefinitions(ctx: ToolContext): RegistryTool["definition"][] {
  return buildAllTools(ctx).map((t) => t.definition);
}

/**
 * Returns tool definitions grouped by category for display purposes.
 */
export function getToolSummary(ctx: ToolContext): Record<string, string[]> {
  const tools = buildAllTools(ctx);
  const summary: Record<string, string[]> = {
    web: [], search: [], http: [], browser: [], user_browser: [],
    vision: [], continuity: [], site_operator: [], memory: [],
    email: [], discord: [], pdf: [], files: [], sandbox: [],
    sql: [], translate: [], diff_stripe: [], github: [],
  };
  for (const t of tools) {
    const name = t.definition.function.name;
    if (name.startsWith("web_") || name.startsWith("npm_")) summary["web"]!.push(name);
    else if (name === "web_search") summary["search"]!.push(name);
    else if (name === "http_request") summary["http"]!.push(name);
    else if (name.startsWith("user_browser_")) summary["user_browser"]!.push(name);
    else if (name.startsWith("browser_")) summary["browser"]!.push(name);
    else if (name.startsWith("vision_")) summary["vision"]!.push(name);
    else if (name.startsWith("continuity_")) summary["continuity"]!.push(name);
    else if (name.startsWith("site_")) summary["site_operator"]!.push(name);
    else if (name.startsWith("memory_")) summary["memory"]!.push(name);
    else if (name === "email_send") summary["email"]!.push(name);
    else if (name === "discord_webhook") summary["discord"]!.push(name);
    else if (name === "pdf_extract") summary["pdf"]!.push(name);
    else if (name.startsWith("file_")) summary["files"]!.push(name);
    else if (name === "code_run") summary["sandbox"]!.push(name);
    else if (name === "sql_query") summary["sql"]!.push(name);
    else if (name === "text_translate") summary["translate"]!.push(name);
    else if (name === "diff_generate" || name === "stripe_query") summary["diff_stripe"]!.push(name);
    else if (name.startsWith("github_") || name.startsWith("git_")) summary["github"]!.push(name);
  }
  return summary;
}

/**
 * Execute a named tool with the given arguments and context.
 * Returns { result, isError } — always resolves, never throws.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ result: string; isError: boolean }> {
  const tools = buildAllTools(ctx);
  const tool = tools.find((t) => t.definition.function.name === name);

  if (!tool) {
    const available = tools.map((t) => t.definition.function.name).join(", ");
    return {
      result: `Tool "${name}" not found. Available: ${available}`,
      isError: true,
    };
  }

  try {
    const result = await tool.execute(args, ctx);
    return { result, isError: false };
  } catch (err) {
    return {
      result: `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}
