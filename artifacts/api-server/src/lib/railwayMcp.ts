import { logger } from "./logger";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Lightweight HTTP client for Railway's MCP server.
 * Endpoint: https://railway.com/mcp
 * Auth: Bearer RAILWAY_TOKEN
 * Protocol: MCP JSON-RPC 2.0 over streamable HTTP (RFC 2024-11-05)
 *
 * Tools are cached after the first listTools() call.
 * One shared client per RAILWAY_TOKEN; see getRailwayMcpClient().
 */
export class RailwayMcpClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private sessionId: string | null = null;
  private toolsCache: McpTool[] | null = null;
  private initialized = false;
  private reqId = 1;

  constructor(token: string, baseUrl = "https://railway.com/mcp") {
    this.token = token;
    this.baseUrl = baseUrl;
  }

  private nextId(): number {
    return this.reqId++;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.token}`,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    return headers;
  }

  /** Parse MCP streamable HTTP response — handles both JSON and SSE. */
  private async parseResponse(res: Response): Promise<JsonRpcResponse | null> {
    const sessionHeader = res.headers.get("mcp-session-id");
    if (sessionHeader) this.sessionId = sessionHeader;

    const ct = res.headers.get("content-type") ?? "";
    const text = await res.text();

    if (ct.includes("text/event-stream")) {
      for (const line of text.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            return JSON.parse(line.slice(6)) as JsonRpcResponse;
          } catch {
            // skip non-JSON data lines
          }
        }
      }
      return null;
    }

    if (!text.trim()) return null;
    return JSON.parse(text) as JsonRpcResponse;
  }

  private async post(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId();
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: this.buildHeaders(),
      body,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Railway MCP HTTP ${res.status}: ${errText}`);
    }

    const parsed = await this.parseResponse(res);

    if (!parsed) return null;

    if (parsed.error) {
      throw new Error(`Railway MCP error [${parsed.error.code}]: ${parsed.error.message}`);
    }

    return parsed.result;
  }

  /** Establish MCP session (called automatically before first tool use). */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.post("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "viba-railway-mcp", version: "1.0.0" },
    });
    this.initialized = true;
    logger.info({ sessionId: this.sessionId }, "Railway MCP session initialized");
  }

  /** List all tools exposed by the Railway MCP server (cached). */
  async listTools(): Promise<McpTool[]> {
    if (this.toolsCache) return this.toolsCache;
    if (!this.initialized) await this.initialize();

    const result = await this.post("tools/list") as { tools?: McpTool[] } | null;
    this.toolsCache = result?.tools ?? [];
    logger.info({ count: this.toolsCache.length }, "Railway MCP tools loaded");
    return this.toolsCache;
  }

  /** Execute a Railway MCP tool by name. */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    if (!this.initialized) await this.initialize();

    logger.info({ tool: name, args }, "Railway MCP tool call");

    try {
      const result = await this.post("tools/call", {
        name,
        arguments: args,
      }) as McpToolResult | null;

      const toolResult = result ?? { content: [{ type: "text", text: "No result returned." }] };
      logger.info({ tool: name, isError: toolResult.isError }, "Railway MCP tool call complete");
      return toolResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ tool: name, err: message }, "Railway MCP tool call failed");
      return {
        content: [{ type: "text", text: `Railway tool "${name}" failed: ${message}` }],
        isError: true,
      };
    }
  }

  /** Invalidate the cached tool list (e.g. after Railway schema changes). */
  clearCache(): void {
    this.toolsCache = null;
  }
}

// ── Singleton per token ───────────────────────────────────────────────────────
const clients = new Map<string, RailwayMcpClient>();

export function getRailwayMcpClient(token?: string): RailwayMcpClient | null {
  const t = token ?? process.env["RAILWAY_TOKEN"] ?? "";
  if (!t) return null;
  if (!clients.has(t)) clients.set(t, new RailwayMcpClient(t));
  return clients.get(t)!;
}

/** Convert MCP tool definitions to OpenAI-compatible function definitions. */
export function mcpToolsToOpenAiFunctions(tools: McpTool[]): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
}
