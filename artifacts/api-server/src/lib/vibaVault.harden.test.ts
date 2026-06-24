import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vibaVaultModule from "./vibaVault";

vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
}));

const { isSensitiveCredentialName, redactCredentialMetadata } = vibaVaultModule;

describe("isSensitiveCredentialName", () => {
  it("flags obvious secrets", () => {
    for (const name of ["api_key", "access_token", "password", "webhook_secret", "database_url", "smtp_pass", "refresh_token", "private_key"]) {
      expect(isSensitiveCredentialName(name)).toBe(true);
    }
  });

  it("does not flag safe metadata keys", () => {
    for (const name of ["model", "endpoint", "provider", "label", "status", "name", "kind", "created_at"]) {
      expect(isSensitiveCredentialName(name)).toBe(false);
    }
  });
});

describe("redactCredentialMetadata", () => {
  it("redacts known sensitive keys", () => {
    const result = redactCredentialMetadata({
      key: "sk-live-123",
      token: "ghp_abc",
      password: "hunter2",
      model: "gpt-4",
      label: "default",
    });
    expect(result["key"]).toBe("[REDACTED]");
    expect(result["token"]).toBe("[REDACTED]");
    expect(result["password"]).toBe("[REDACTED]");
    expect(result["model"]).toBe("gpt-4");
    expect(result["label"]).toBe("default");
  });

  it("handles null/undefined metadata safely", () => {
    expect(redactCredentialMetadata(null)).toEqual({});
    expect(redactCredentialMetadata(undefined)).toEqual({});
  });

  it("does not return raw values for webhook_secret", () => {
    const result = redactCredentialMetadata({ webhook_secret: "whsec_abcdef" });
    expect(result["webhook_secret"]).toBe("[REDACTED]");
  });
});

describe("resolveVibaCredentialForUse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["TEST_PROVIDER_KEY"];
  });

  it("returns env value when env var is set", async () => {
    process.env["TEST_PROVIDER_KEY"] = "env-value-123";
    const { pool } = await import("@workspace/db");
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await vibaVaultModule.resolveVibaCredentialForUse({
      userId: 1,
      provider: "test",
      kind: "api_key",
      envNames: ["TEST_PROVIDER_KEY"],
    });
    expect(result.source).toBe("env");
    expect(result.value).toBe("env-value-123");
    delete process.env["TEST_PROVIDER_KEY"];
  });

  it("blocks expired credential and returns missing", async () => {
    const { pool } = await import("@workspace/db");
    const expiredDate = new Date(Date.now() - 86400000).toISOString(); // yesterday
    (pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensureVibaVault — CREATE TABLE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensureVibaVault — CREATE TABLE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensureVibaVault — CREATE TABLE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensureVibaVault — ALTER
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensureVibaVault — ALTER
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensureVibaVault — ALTER
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensureVibaVault — ALTER
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensureVibaVault — indexes
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensureVibaVault — indexes
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensureVibaVault — indexes
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensureVibaVault — indexes
      .mockResolvedValueOnce({
        rows: [{ id: 1, encrypted_value: "enc", iv: "iv", auth_tag: "tag", scope: "all", expires_at: expiredDate, allowed_use_json: {} }],
        rowCount: 1,
      }); // SELECT from vault

    const result = await vibaVaultModule.resolveVibaCredentialForUse({
      userId: 1,
      provider: "test",
      kind: "api_key",
      envNames: ["MISSING_ENV"],
    });
    expect(result.source).toBe("missing");
    expect(result.value).toBeNull();
  });

  it("returns missing when credential not found in vault", async () => {
    const { pool } = await import("@workspace/db");
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await vibaVaultModule.resolveVibaCredentialForUse({
      userId: 1,
      provider: "nonexistent",
      kind: "api_key",
      envNames: ["NONEXISTENT_ENV_VAR_XYZ"],
    });
    expect(result.source).toBe("missing");
    expect(result.value).toBeNull();
  });
});
