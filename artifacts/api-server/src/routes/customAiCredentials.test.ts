import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import customAiRouter from "./customAiCredentials";

vi.mock("../lib/vibaVault", () => ({
  saveVibaCredential: vi.fn().mockResolvedValue(undefined),
  listVibaCredentials: vi.fn().mockResolvedValue([]),
  logVibaEvent: vi.fn().mockResolvedValue(undefined),
}));

function makeApp(sessionUserId = 1) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as Record<string, unknown>).session = { userId: sessionUserId };
    next();
  });
  app.use(customAiRouter);
  return app;
}

describe("POST /custom-ai/save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires name", async () => {
    const res = await request(makeApp()).post("/custom-ai/save").send({ value: "sk-test" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });

  it("requires value", async () => {
    const res = await request(makeApp()).post("/custom-ai/save").send({ name: "Mistral" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/value/);
  });

  it("saves to vault (saveVibaCredential called with api_key kind)", async () => {
    const { saveVibaCredential } = await import("../lib/vibaVault");
    const res = await request(makeApp()).post("/custom-ai/save").send({ name: "Mistral", value: "sk-mistral-key" });
    expect(res.status).toBe(200);
    expect(saveVibaCredential).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "api_key", value: "sk-mistral-key" }),
    );
  });

  it("does NOT return the raw key in the response", async () => {
    const res = await request(makeApp()).post("/custom-ai/save").send({ name: "Mistral", value: "sk-mistral-key" });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("sk-mistral-key");
  });

  it("accepts arbitrary AI provider names", async () => {
    const { saveVibaCredential } = await import("../lib/vibaVault");
    await request(makeApp()).post("/custom-ai/save").send({ name: "Together AI", value: "tog-key" });
    await request(makeApp()).post("/custom-ai/save").send({ name: "DeepSeek", value: "ds-key" });
    await request(makeApp()).post("/custom-ai/save").send({ name: "My Company Internal LLM", value: "internal-key" });
    expect(saveVibaCredential).toHaveBeenCalledTimes(3);
  });

  it("saves endpoint to vault when provided", async () => {
    const { saveVibaCredential } = await import("../lib/vibaVault");
    await request(makeApp()).post("/custom-ai/save").send({
      name: "Self-hosted Llama",
      value: "no-key",
      endpoint: "http://localhost:8080/v1",
    });
    expect(saveVibaCredential).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "endpoint", value: "http://localhost:8080/v1" }),
    );
  });

  it("saves model to vault when provided", async () => {
    const { saveVibaCredential } = await import("../lib/vibaVault");
    await request(makeApp()).post("/custom-ai/save").send({
      name: "Mistral",
      value: "sk-key",
      model: "mistral-large-latest",
    });
    expect(saveVibaCredential).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "model", value: "mistral-large-latest" }),
    );
  });
});

describe("GET /custom-ai/list", () => {
  it("never returns raw keys (only metadata)", async () => {
    const { listVibaCredentials } = await import("../lib/vibaVault");
    (listVibaCredentials as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        provider: "custom_ai__mistral",
        kind: "api_key",
        label: "default",
        status: "saved",
        scope: "all",
        last_used_at: null,
        last_validated_at: null,
        expires_at: null,
        updated_at: new Date().toISOString(),
      },
    ]);
    const res = await request(makeApp()).get("/custom-ai/list");
    expect(res.status).toBe(200);
    expect(res.body.customAiProviders).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain("encrypted_value");
    expect(JSON.stringify(res.body)).not.toContain("iv");
    expect(JSON.stringify(res.body)).not.toContain("auth_tag");
  });
});
