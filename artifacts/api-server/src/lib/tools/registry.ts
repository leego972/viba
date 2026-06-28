/**
 * VIBA Unified Tool Registry
 *
 * Every tool VIBA owns lives here. Any agent (Groq, Claude, GPT-4o, Manus, etc.)
 * calls these tools through this registry — no agent needs its own toolset.
 *
 * Tools available:
 *   Web tools       — web_fetch, npm_search, npm_package_info (always on)
 *   GitHub tools    — read/write repo files (when githubToken provided)
 *   Browser tools   — navigate, screenshot, click, type, extract (VIBA Chromium)
 *   Vision tools    — analyze_image, compare_frames, check_person, check_background (Groq free)
 *   Continuity tools — run_check, score_report (Groq free vision)
 *   Site operator   — site_login, site_api_call, site_fill_and_submit (vault + Chromium)
 */

import { getGitHubTools, type GitHubContext } from "./github";
import { getWebTools } from "./web";
import { getBrowserTools } from "./browser";
import { getVisionTools } from "./vision";
import { getContinuityTools } from "./continuity";
import { getSiteOperatorTools } from "./siteOperator";

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

  // ── Web tools — always available ─────────────────────────────────────────
  for (const t of getWebTools()) {
    tools.push({ definition: t.definition, execute: (args) => t.execute(args) });
  }

  // ── Browser tools — VIBA Chromium, always available ──────────────────────
  for (const t of getBrowserTools()) {
    tools.push({ definition: t.definition, execute: (args) => t.execute(args) });
  }

  // ── Vision tools — Groq free vision model, always available ──────────────
  for (const t of getVisionTools()) {
    tools.push({ definition: t.definition, execute: (args) => t.execute(args) });
  }

  // ── Continuity tools — Groq free, always available ───────────────────────
  for (const t of getContinuityTools()) {
    tools.push({ definition: t.definition, execute: (args) => t.execute(args) });
  }

  // ── Site operator tools — vault + Chromium, always available ─────────────
  for (const t of getSiteOperatorTools()) {
    tools.push({
      definition: t.definition,
      execute: (args) => t.execute(args, ctx.userId),
    });
  }

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
    web: [],
    browser: [],
    vision: [],
    continuity: [],
    site_operator: [],
    github: [],
  };
  for (const t of tools) {
    const name = t.definition.function.name;
    if (name.startsWith("web_") || name.startsWith("npm_")) summary["web"]!.push(name);
    else if (name.startsWith("browser_")) summary["browser"]!.push(name);
    else if (name.startsWith("vision_")) summary["vision"]!.push(name);
    else if (name.startsWith("continuity_")) summary["continuity"]!.push(name);
    else if (name.startsWith("site_")) summary["site_operator"]!.push(name);
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
