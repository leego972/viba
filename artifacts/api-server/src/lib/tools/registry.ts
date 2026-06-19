/**
 * Unified tool registry for VIBA AI agents.
 *
 * Aggregates all available tools (GitHub, web/npm) and provides:
 *   - getToolDefinitions(ctx)  — OpenAI function schemas for the LLM
 *   - executeTool(name, args, ctx) — route and execute a named tool
 *
 * Tools are conditionally included based on what credentials are available:
 *   - GitHub tools: only when githubToken is provided
 *   - Web tools: always available (no auth required)
 *
 * Railway MCP tools are loaded separately by adapters (not via this registry)
 * because they use the MCP client protocol.
 */

import { getGitHubTools, type GitHubContext } from "./github";
import { getWebTools } from "./web";

export interface ToolContext {
  githubToken?: string;
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

  // Web tools — always available
  for (const t of getWebTools()) {
    tools.push({
      definition: t.definition,
      execute: (args) => t.execute(args),
    });
  }

  // GitHub tools — only when token is provided
  if (ctx.githubToken) {
    const ghCtx: GitHubContext = { token: ctx.githubToken };
    for (const t of getGitHubTools()) {
      tools.push({
        definition: t.definition,
        execute: (args) => t.execute(args, ghCtx),
      });
    }
  }

  return tools;
}

/**
 * Returns tool definitions (schemas) for all tools available in this context.
 * Pass to the LLM as the `tools` parameter.
 */
export function getToolDefinitions(ctx: ToolContext): RegistryTool["definition"][] {
  return buildAllTools(ctx).map((t) => t.definition);
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
    return {
      result: `Tool "${name}" is not available. Available registry tools: ${tools.map((t) => t.definition.function.name).join(", ")}`,
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
