import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// This test exists specifically to prove the app.ts mount-order fix:
// apiKeysRouter / taskIntakeApiAuthRouter / taskIntakeStatusRouter /
// taskIntakeRouter must be reachable via a bare `Authorization: Bearer
// viba_live_<key>` header with NO session cookie at all. Before the fix,
// the app-level `requireSession` middleware ran first (mounted ahead of
// these routers) and rejected any request without req.session.userId —
// meaning a stateless caller like an MCP server could never reach the
// API-key check that was built for exactly that purpose.
//
// The mock below intentionally does NOT stub a "FROM users" query (the
// one requireSession's email-verification check would run). If that
// query fires, pool.query rejects with "unexpected query" and the test
// fails loudly — that's the signal that requireSession is (wrongly)
// back in the request path ahead of the API-key check.

import { createHash } from "node:crypto";

const queries: string[] = [];
const VALID_TEST_KEY = "viba_live_testkeyfortestingonly000000000000";
const VALID_TEST_KEY_HASH = createHash("sha256").update(VALID_TEST_KEY, "utf8").digest("hex");

vi.mock("@workspace/db", () => ({
  pool: {
    on: vi.fn(),
    end: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push(sql);
      const s = sql.replace(/\s+/g, " ").trim();

      if (s.startsWith("CREATE TABLE") || s.startsWith("CREATE INDEX")) {
        return { rows: [] };
      }
      // connect-pg-simple session persistence, triggered whenever
      // req.session is touched (e.g. the API-key bridge setting
      // req.session.userId). Not the thing under test -- just needs to
      // not hang or throw.
      if (s.toLowerCase().includes("user_sessions")) {
        return { rows: [], rowCount: 0 };
      }
      if (s.includes("FROM viba_api_keys") && s.includes("key_hash")) {
        const providedHash = params[0];
        if (providedHash === VALID_TEST_KEY_HASH) {
          return { rows: [{ id: 1, user_id: 42, scopes: ["task-intake"], revoked_at: null }] };
        }
        return { rows: [] };
      }
      if (s.startsWith("UPDATE viba_api_keys")) {
        return { rows: [] };
      }
      if (s.includes("FROM viba_tasks") && s.includes("status")) {
        return {
          rows: [
            {
              id: params[0],
              status: "running",
              risk_level: "low",
              needs_user_approval: false,
              safe_build_required: false,
              safe_build_passed: null,
              approved_at: null,
              cancelled_at: null,
              created_at: new Date("2026-08-01T00:00:00Z"),
              updated_at: new Date("2026-08-01T00:00:00Z"),
            },
          ],
        };
      }

      // Permissive fallback for connect-pg-simple's own session-store
      // bookkeeping (table-existence checks, session upsert/touch, etc.)
      // -- not what this test is about. The specific behavior this test
      // proves (requireSession's own "FROM users" check never running
      // for this path) is asserted explicitly below via the `queries`
      // array, not by making this mock throw on every other query shape.
      return { rows: [], rowCount: 0 };
    }),
  },
  db: {},
}));

beforeEach(() => {
  queries.length = 0;
  vi.resetModules();
});

describe("Bearer API-key auth reaches task-intake without a session (app.ts mount-order fix)", () => {
  it("GET /api/task-intake/:taskId/status succeeds with only a Bearer key, no session cookie", async () => {
    const { default: app } = await import("../app");

    const res = await request(app)
      .get("/api/task-intake/7/status")
      .set("Authorization", `Bearer ${VALID_TEST_KEY}`)
      .set("Connection", "close");

    expect(res.status).toBe(200);
    expect(res.body.task_id).toBe(7);
    expect(res.body.status).toBe("running");

    // Confirms requireSession's own query never ran for this request.
    expect(queries.some((q) => q.includes("FROM users"))).toBe(false);
  }, 20000);

  it("GET /api/task-intake/:taskId/status still rejects a request with no auth at all", async () => {
    const { default: app } = await import("../app");

    const res = await request(app).get("/api/task-intake/7/status");

    expect(res.status).toBe(401);
  });

  it("GET /api/task-intake/:taskId/status rejects an invalid Bearer key", async () => {
    const { default: app } = await import("../app");

    const res = await request(app)
      .get("/api/task-intake/7/status")
      .set("Authorization", "Bearer viba_live_thisdoesnotexistanywhereok0000000");

    // key lookup returns no rows (not seeded above for this raw value),
    // so apiKeyAuth.ts should reject with 401 invalid_api_key
    expect(res.status).toBe(401);
  });
});
