import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../lib/vibaVault", () => ({
  listVibaCredentials: vi.fn(),
  listCredentialAccessLogs: vi.fn(),
  deleteVibaCredential: vi.fn(),
  logVibaEvent: vi.fn(),
  markVibaCredential: vi.fn(),
  resolveVibaCredential: vi.fn(),
  saveVibaCredential: vi.fn(),
}));

import {
  listVibaCredentials,
  listCredentialAccessLogs,
  deleteVibaCredential,
  logVibaEvent,
} from "../lib/vibaVault";
import credentialsRouter from "./credentials";

const SENSITIVE_FIELDS = ["encrypted_value", "iv", "auth_tag"];

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { session?: { userId?: number } }).session = { userId: 42 };
    next();
  });
  app.use(credentialsRouter);
  return app;
}

describe("GET /credentials/vault-list", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns credentials metadata with rawValueReturned: false", async () => {
    vi.mocked(listVibaCredentials).mockResolvedValue([
      {
        provider: "openai",
        kind: "api_key",
        label: "default",
        scope: "all",
        status: "valid",
        expires_at: null,
        last_used_at: "2026-06-01T00:00:00Z",
        last_validated_at: "2026-06-01T00:00:00Z",
        last_error: null,
        updated_at: "2026-06-01T00:00:00Z",
      },
    ]);

    const app = makeApp();
    const res = await request(app).get("/credentials/vault-list");
    expect(res.status).toBe(200);
    expect(res.body.rawValueReturned).toBe(false);
    expect(res.body.credentials).toHaveLength(1);
    expect(res.body.credentials[0].provider).toBe("openai");
    expect(res.body.credentials[0].configured).toBe(true);
  });

  it("never returns encrypted_value, iv, or auth_tag", async () => {
    vi.mocked(listVibaCredentials).mockResolvedValue([
      {
        provider: "anthropic",
        kind: "api_key",
        label: "default",
        scope: "all",
        status: "saved",
        encrypted_value: "SUPER_SECRET",
        iv: "INIT_VECTOR",
        auth_tag: "AUTH_TAG",
        expires_at: null,
        last_used_at: null,
        last_validated_at: null,
        last_error: null,
        updated_at: null,
      },
    ]);

    const app = makeApp();
    const res = await request(app).get("/credentials/vault-list");
    const body = JSON.stringify(res.body);
    for (const field of SENSITIVE_FIELDS) {
      expect(body).not.toContain(field);
      expect(res.body.credentials[0]).not.toHaveProperty(field);
    }
    expect(body).not.toContain("SUPER_SECRET");
    expect(body).not.toContain("INIT_VECTOR");
    expect(body).not.toContain("AUTH_TAG");
  });

  it("returns empty array when no credentials", async () => {
    vi.mocked(listVibaCredentials).mockResolvedValue([]);
    const res = await request(makeApp()).get("/credentials/vault-list");
    expect(res.status).toBe(200);
    expect(res.body.credentials).toEqual([]);
    expect(res.body.rawValueReturned).toBe(false);
  });
});

describe("GET /credentials/access-logs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns log entries with rawValuesReturned: false", async () => {
    vi.mocked(listCredentialAccessLogs).mockResolvedValue([
      { provider: "openai", kind: "api_key", label: "default", purpose: "agent_task", job_id: "abc", scope: "all", source: "vault", status: "granted", created_at: "2026-06-01T00:00:00Z", metadata: null },
    ]);

    const res = await request(makeApp()).get("/credentials/access-logs");
    expect(res.status).toBe(200);
    expect(res.body.rawValuesReturned).toBe(false);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].status).toBe("granted");
  });

  it("never includes raw values or sensitive fields in access logs", async () => {
    vi.mocked(listCredentialAccessLogs).mockResolvedValue([
      { provider: "gemini", kind: "api_key", label: "default", purpose: null, job_id: null, scope: null, source: "env", status: "granted", created_at: "2026-06-01T00:00:00Z", encrypted_value: "RAW_SECRET", metadata: null },
    ]);

    const res = await request(makeApp()).get("/credentials/access-logs");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("RAW_SECRET");
    for (const field of SENSITIVE_FIELDS) {
      expect(body).not.toContain(`"${field}"`);
    }
  });

  it("filters by provider query param", async () => {
    vi.mocked(listCredentialAccessLogs).mockResolvedValue([]);
    const res = await request(makeApp()).get("/credentials/access-logs?provider=groq");
    expect(res.status).toBe(200);
    expect(vi.mocked(listCredentialAccessLogs)).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "groq" }),
    );
  });
});

describe("DELETE /credentials", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes credential and returns ok", async () => {
    vi.mocked(deleteVibaCredential).mockResolvedValue({ deleted: true });
    vi.mocked(logVibaEvent).mockResolvedValue(undefined);

    const res = await request(makeApp())
      .delete("/credentials")
      .send({ provider: "openai", kind: "api_key", label: "default" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(vi.mocked(deleteVibaCredential)).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", kind: "api_key", label: "default", userId: 42 }),
    );
  });

  it("returns 404 when credential not found", async () => {
    vi.mocked(deleteVibaCredential).mockResolvedValue({ deleted: false });
    const res = await request(makeApp())
      .delete("/credentials")
      .send({ provider: "openai", kind: "api_key", label: "default" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 400 when provider missing", async () => {
    const res = await request(makeApp()).delete("/credentials").send({ kind: "api_key" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/provider/i);
  });

  it("does not reveal raw credential value in delete response", async () => {
    vi.mocked(deleteVibaCredential).mockResolvedValue({ deleted: true });
    vi.mocked(logVibaEvent).mockResolvedValue(undefined);

    const res = await request(makeApp())
      .delete("/credentials")
      .send({ provider: "anthropic", kind: "api_key", label: "default" });

    const body = JSON.stringify(res.body);
    for (const field of SENSITIVE_FIELDS) {
      expect(body).not.toContain(field);
    }
  });
});
