import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";

// Simulates a settingsTable that already has OPENAI_API_KEY and MISTRAL_ENABLED=false
// rows in it, the way the Settings page (routes/settings.ts) actually writes keys —
// directly to settingsTable, never to the vault.
const SEEDED_ROWS: Array<{ key: string; value: string }> = [
  { key: "OPENAI_API_KEY", value: "sk-from-settings-page" },
  { key: "MISTRAL_API_KEY", value: "mistral-from-settings-page" },
  { key: "MISTRAL_ENABLED", value: "false" },
];

vi.mock("@workspace/db", () => {
  function makeFromResult(rows: unknown[]) {
    const obj: Record<string, unknown> = {
      where: vi.fn((cond: { queryChunks?: unknown[] }) => {
        // drizzle's eq() builder — pull the compared value out of the query chunks
        // well enough to filter our fake row set by key.
        const chunkStr = JSON.stringify(cond);
        const match = SEEDED_ROWS.filter((r) => chunkStr.includes(r.key));
        return Promise.resolve(match);
      }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return obj;
  }
  return {
    db: {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult(SEEDED_ROWS)) }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    },
    settingsTable: { key: "key", value: "value" },
  };
});

vi.mock("../lib/vibaVault", () => ({
  saveVibaCredential: vi.fn().mockResolvedValue(undefined),
  resolveVibaCredential: vi.fn().mockResolvedValue({ value: null, source: "missing", missing: [] }),
  logVibaEvent: vi.fn().mockResolvedValue(undefined),
  listVibaCredentials: vi.fn().mockResolvedValue([]),
  deleteVibaCredential: vi.fn().mockResolvedValue({ deleted: false }),
}));

async function makeApp() {
  const { default: providersRouter } = await import("./providers");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as Record<string, unknown>).session = { userId: 1 };
    next();
  });
  app.use(providersRouter);
  return app;
}

describe("GET /providers — reflects keys saved via the Settings page", () => {
  it("shows a provider as configured when its key only exists in settingsTable (not the vault)", async () => {
    const app = await makeApp();
    const res = await request(app).get("/providers");
    expect(res.status).toBe(200);
    const openai = res.body.providers.find((p: { id: string }) => p.id === "openai");
    expect(openai.hasKey).toBe(true);
    expect(openai.status).not.toBe("not_configured");
  });

  it("still respects an explicit disable even when a settingsTable key is present", async () => {
    const app = await makeApp();
    const res = await request(app).get("/providers");
    const mistral = res.body.providers.find((p: { id: string }) => p.id === "mistral");
    expect(mistral.hasKey).toBe(true);
    expect(mistral.enabled).toBe(false);
    expect(mistral.status).toBe("disabled");
  });
});
