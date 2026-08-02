import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

process.env.VIBA_API_BASE_URL = "https://viba.example.com";

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  vi.resetModules();
  const { createApp } = await import("./index");
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe("Viba MCP server (end-to-end over real HTTP)", () => {
  it("rejects a /mcp request with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/Authorization/);
  });

  it("GET /mcp returns 405 (stateless mode, no SSE resume)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, { headers: { Accept: "text/event-stream" } });
    expect(res.status).toBe(405);
  });

  it("GET /health returns ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("a real MCP client can connect, list tools, and call viba_get_mission_status end-to-end", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      // Everything hitting the real Viba API (not this test server) goes
      // through this mock, keyed on the URL + the Bearer token the tool
      // handler forwarded from the incoming MCP request.
      if (u === "https://viba.example.com/api/task-intake/7/status") {
        expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer viba_live_e2e_test_key");
        return new Response(
          JSON.stringify({
            task_id: 7,
            status: "awaiting_approval",
            risk_level: "medium",
            needs_user_approval: true,
            safe_build_required: true,
            safe_build_passed: true,
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    });
    // Only stub fetch for calls originating from the tool handler's own
    // outbound requests (VibaClient), not the test's own client<->server
    // traffic, which uses Node's real fetch against the local server.
    const realFetch = global.fetch;
    global.fetch = ((url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith("https://viba.example.com")) return fetchMock(url, init);
      return realFetch(url, init);
    }) as typeof fetch;

    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer viba_live_e2e_test_key" } },
    });
    const client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "viba_create_mission",
        "viba_get_mission_status",
        "viba_get_mission_plan",
        "viba_approve_mission",
        "viba_cancel_mission",
        "viba_get_evidence_report",
      ]),
    );

    const result = await client.callTool({
      name: "viba_get_mission_status",
      arguments: { task_id: 7 },
    });

    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed).toMatchObject({
      task_id: 7,
      status: "awaiting_approval",
      needs_user_approval: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    global.fetch = realFetch;
    await client.close();
  });

  it("surfaces a Viba API error (e.g. invalid key) as an MCP tool error, not a crash", async () => {
    const realFetch = global.fetch;
    global.fetch = ((url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith("https://viba.example.com")) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "invalid_api_key", message: "The API key is invalid or revoked." }), {
            status: 401,
          }),
        );
      }
      return realFetch(url, init);
    }) as typeof fetch;

    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer viba_live_some_bad_key" } },
    });
    const client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(transport);

    const result = await client.callTool({ name: "viba_get_mission_status", arguments: { task_id: 1 } });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("invalid_api_key");

    global.fetch = realFetch;
    await client.close();
  });
});
