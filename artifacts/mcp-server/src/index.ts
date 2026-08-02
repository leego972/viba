import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerVibaTools } from "./tools.js";
import { VibaClient } from "./vibaClient.js";

const VIBA_API_BASE_URL = process.env.VIBA_API_BASE_URL;
if (!VIBA_API_BASE_URL) {
  throw new Error(
    "VIBA_API_BASE_URL is not set. This must point at the real Viba api-server " +
      "(the one that owns /api/task-intake/*), e.g. https://your-viba-deployment.example.com",
  );
}

const PORT = Number(process.env.PORT ?? 8787);

function extractApiKey(req: express.Request): string | null {
  const header = req.get("authorization");
  const match = header?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

/**
 * Builds a fresh McpServer + StreamableHTTPServerTransport for a single
 * request. This server is intentionally stateless per-request: nothing is
 * cached or shared across callers. The caller's Viba API key (Bearer
 * token on this /mcp request) is the only thing that scopes tool calls to
 * their account — see vibaClient.ts and the requireSessionOrApiKey
 * middleware in the real api-server this proxies to.
 */
function buildServer(apiKey: string): McpServer {
  const server = new McpServer({ name: "viba", version: "0.1.0" });
  const client = new VibaClient({ apiKey, baseUrl: VIBA_API_BASE_URL! });
  registerVibaTools(server, client);
  return server;
}

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/mcp", async (req, res) => {
    const apiKey = extractApiKey(req);
    if (!apiKey) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Missing Authorization: Bearer <viba_live_...> header." },
        id: null,
      });
      return;
    }

    const server = buildServer(apiKey);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: err instanceof Error ? err.message : "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Streamable HTTP also uses GET/DELETE for SSE streams and session
  // teardown; in stateless mode there is no session to resume or delete,
  // so respond with the transport's own "not applicable" behavior.
  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "This server runs in stateless mode; GET /mcp (SSE resume) is not supported." },
      id: null,
    });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Viba MCP server listening on :${PORT} -> ${VIBA_API_BASE_URL}`);
  });
}
