import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// Mock DB first — from() must be thenable (Drizzle supports await db.select().from() without .where())
vi.mock("@workspace/db", () => {
  function makeFromResult(rows: unknown[] = []) {
    const obj: Record<string, unknown> = {
      where: vi.fn().mockResolvedValue(rows),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
      catch: (reject: (e: unknown) => unknown) => Promise.resolve(rows).catch(reject),
      finally: (cb: () => void) => Promise.resolve(rows).finally(cb),
    };
    return obj;
  }
  return {
    db: {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([])) }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    },
    settingsTable: {},
  };
});

vi.mock("../lib/vibaVault", () => ({
  saveVibaCredential: vi.fn().mockResolvedValue(undefined),
  resolveVibaCredential: vi.fn().mockResolvedValue({ value: null, source: "missing", missing: [] }),
  logVibaEvent: vi.fn().mockResolvedValue(undefined),
}));

async function makeApp(sessionUserId = 1) {
  const { default: providersRouter } = await import("./providers");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as Record<string, unknown>).session = { userId: sessionUserId };
    next();
  });
  app.use(providersRouter);
  return app;
}

describe("PATCH /providers/:provider — key routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes API key to vault (saveVibaCredential) not settingsTable", async () => {
    const { saveVibaCredential } = await import("../lib/vibaVault");
    const { db } = await import("@workspace/db");
    const app = await makeApp();

    await request(app).patch("/providers/openai").send({ key: "sk-openai-test-key" });

    expect(saveVibaCredential).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", kind: "api_key", value: "sk-openai-test-key" }),
    );
    // settingsTable upsert should NOT be called with the raw key
    const insertCalls = (db.insert as ReturnType<typeof vi.fn>).mock.calls;
    const updateCalls = (db.update as ReturnType<typeof vi.fn>).mock.calls;
    const allCalls = [...insertCalls, ...updateCalls].flat();
    const rawKeyLeak = allCalls.some((c) => JSON.stringify(c).includes("sk-openai-test-key"));
    expect(rawKeyLeak).toBe(false);
  });

  it("does not write raw key to settingsTable for any provider", async () => {
    const { db } = await import("@workspace/db");
    const app = await makeApp();
    for (const provider of ["anthropic", "gemini", "groq"]) {
      await request(app).patch(`/providers/${provider}`).send({ key: `raw-key-${provider}` });
    }
    const insertCalls = (db.insert as ReturnType<typeof vi.fn>).mock.calls;
    const updateCalls = (db.update as ReturnType<typeof vi.fn>).mock.calls;
    const allCalls = [...insertCalls, ...updateCalls].flat();
    const rawKeyLeak = allCalls.some((c) => JSON.stringify(c).match(/raw-key-/));
    expect(rawKeyLeak).toBe(false);
  });

  it("GET /providers never returns raw key values", async () => {
    const app = await makeApp();
    const res = await request(app).get("/providers");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.providers)).toBe(true);
    for (const p of res.body.providers) {
      expect(p.key).toBeUndefined();
      expect(p.api_key).toBeUndefined();
    }
  });
});
