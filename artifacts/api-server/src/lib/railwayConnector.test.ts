import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./railwayMcp", () => ({
  getRailwayMcpClient: () => null,
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// child_process promisify mock — CLI always unavailable in unit tests
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
    cb(new Error("command not found"));
  }),
}));

import { filterRailwayVariables, ALLOWED_VARS, redactKeys, applyRailwayVariablesViaApi } from "./railwayConnector";

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("filterRailwayVariables", () => {
  it("strips unapproved keys", () => {
    const result = filterRailwayVariables({
      DATABASE_URL: "postgres://...",
      ACCESS_TOKEN: "tok_123",
      MY_CUSTOM_KEY: "should-be-rejected",
      SOME_OTHER_SECRET: "also-rejected",
    });
    expect(result.acceptedKeys).toContain("DATABASE_URL");
    expect(result.acceptedKeys).toContain("ACCESS_TOKEN");
    expect(result.rejectedKeys).toContain("MY_CUSTOM_KEY");
    expect(result.rejectedKeys).toContain("SOME_OTHER_SECRET");
  });

  it("defaults replace=false and skipDeploys=true", () => {
    const result = filterRailwayVariables({ DATABASE_URL: "postgres://..." });
    expect(result.replace).toBe(false);
    expect(result.skipDeploys).toBe(true);
  });

  it("never returns raw values", () => {
    const result = filterRailwayVariables({ DATABASE_URL: "postgres://secret:pass@host/db" });
    expect(result.valuesReturned).toBe(false);
    expect(JSON.stringify(result)).not.toContain("postgres://secret:pass@host/db");
  });

  it("accepts all keys in ALLOWED_VARS", () => {
    const input = Object.fromEntries([...ALLOWED_VARS].map((k) => [k, "value"]));
    const result = filterRailwayVariables(input);
    expect(result.rejectedKeys).toHaveLength(0);
    expect(result.acceptedKeys).toHaveLength(ALLOWED_VARS.size);
  });
});

describe("redactKeys", () => {
  it("replaces all values with [REDACTED]", () => {
    const out = redactKeys({ A: "secret1", B: "secret2" });
    expect(out.A).toBe("[REDACTED]");
    expect(out.B).toBe("[REDACTED]");
  });
});

describe("applyRailwayVariablesViaApi — no token → browser fallback", () => {
  it("returns fallbackNeeded=true when no Railway token configured", async () => {
    vi.stubEnv("RAILWAY_TOKEN", "");
    const result = await applyRailwayVariablesViaApi({ DATABASE_URL: "postgres://host/db" });
    expect(result.ok).toBe(false);
    expect(result.fallbackNeeded).toBe(true);
    expect(result.valuesReturned).toBe(false);
  });

  it("apply always returns valuesReturned=false", async () => {
    vi.stubEnv("RAILWAY_TOKEN", "");
    const result = await applyRailwayVariablesViaApi({ DATABASE_URL: "postgres://host/db" });
    expect(result.valuesReturned).toBe(false);
  });

  it("apply defaults produce replace=false equivalent (no var mutation without explicit flag)", async () => {
    vi.stubEnv("RAILWAY_TOKEN", "");
    const result = await applyRailwayVariablesViaApi({ DATABASE_URL: "postgres://host/db" });
    // When it fails, appliedKeys is empty
    expect(result.appliedKeys).toEqual([]);
  });
});

describe("Railway connector dry-run strips unapproved keys", () => {
  it("filterRailwayVariables rejects non-allowlist keys from Railway connector apply", () => {
    const dangerous = { RAILWAY_TOKEN: "steal-me", MY_CUSTOM: "bad" };
    const result = filterRailwayVariables(dangerous);
    expect(result.rejectedKeys).toContain("RAILWAY_TOKEN");
    expect(result.rejectedKeys).toContain("MY_CUSTOM");
    expect(result.acceptedKeys).toHaveLength(0);
  });
});
