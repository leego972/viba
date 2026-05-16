import { describe, it, expect, afterEach } from "vitest";
import { validateCircuitBreakerEnv } from "./adapterRetry";

// Save and restore env vars around each test so they don't bleed into other test files.
const VARS = ["CIRCUIT_OPEN_THRESHOLD", "CIRCUIT_TIMEOUT_MS"] as const;

type SavedEnv = Record<(typeof VARS)[number], string | undefined>;

function saveEnv(): SavedEnv {
  return Object.fromEntries(VARS.map((k) => [k, process.env[k]])) as SavedEnv;
}

function restoreEnv(saved: SavedEnv): void {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

describe("validateCircuitBreakerEnv", () => {
  let saved: SavedEnv;

  afterEach(() => {
    restoreEnv(saved);
  });

  // ── CIRCUIT_OPEN_THRESHOLD ──────────────────────────────────────────────────

  it("accepts a valid CIRCUIT_OPEN_THRESHOLD", () => {
    saved = saveEnv();
    process.env.CIRCUIT_OPEN_THRESHOLD = "3";
    delete process.env.CIRCUIT_TIMEOUT_MS;
    expect(() => validateCircuitBreakerEnv()).not.toThrow();
  });

  it("accepts CIRCUIT_OPEN_THRESHOLD when it is not set (uses default)", () => {
    saved = saveEnv();
    delete process.env.CIRCUIT_OPEN_THRESHOLD;
    delete process.env.CIRCUIT_TIMEOUT_MS;
    expect(() => validateCircuitBreakerEnv()).not.toThrow();
  });

  it("accepts CIRCUIT_OPEN_THRESHOLD when it is an empty string (uses default)", () => {
    saved = saveEnv();
    process.env.CIRCUIT_OPEN_THRESHOLD = "";
    delete process.env.CIRCUIT_TIMEOUT_MS;
    expect(() => validateCircuitBreakerEnv()).not.toThrow();
  });

  it("throws a clear error when CIRCUIT_OPEN_THRESHOLD is not a number", () => {
    saved = saveEnv();
    process.env.CIRCUIT_OPEN_THRESHOLD = "abc";
    delete process.env.CIRCUIT_TIMEOUT_MS;
    expect(() => validateCircuitBreakerEnv()).toThrow(
      /Invalid CIRCUIT_OPEN_THRESHOLD.*"abc".*positive integer/
    );
  });

  it("throws a clear error when CIRCUIT_OPEN_THRESHOLD is zero", () => {
    saved = saveEnv();
    process.env.CIRCUIT_OPEN_THRESHOLD = "0";
    delete process.env.CIRCUIT_TIMEOUT_MS;
    expect(() => validateCircuitBreakerEnv()).toThrow(
      /Invalid CIRCUIT_OPEN_THRESHOLD.*"0".*positive integer/
    );
  });

  it("throws a clear error when CIRCUIT_OPEN_THRESHOLD is negative", () => {
    saved = saveEnv();
    process.env.CIRCUIT_OPEN_THRESHOLD = "-1";
    delete process.env.CIRCUIT_TIMEOUT_MS;
    expect(() => validateCircuitBreakerEnv()).toThrow(
      /Invalid CIRCUIT_OPEN_THRESHOLD.*"-1".*positive integer/
    );
  });

  // ── CIRCUIT_TIMEOUT_MS ──────────────────────────────────────────────────────

  it("accepts a valid CIRCUIT_TIMEOUT_MS", () => {
    saved = saveEnv();
    delete process.env.CIRCUIT_OPEN_THRESHOLD;
    process.env.CIRCUIT_TIMEOUT_MS = "60000";
    expect(() => validateCircuitBreakerEnv()).not.toThrow();
  });

  it("accepts CIRCUIT_TIMEOUT_MS when it is not set (uses default)", () => {
    saved = saveEnv();
    delete process.env.CIRCUIT_OPEN_THRESHOLD;
    delete process.env.CIRCUIT_TIMEOUT_MS;
    expect(() => validateCircuitBreakerEnv()).not.toThrow();
  });

  it("accepts CIRCUIT_TIMEOUT_MS when it is an empty string (uses default)", () => {
    saved = saveEnv();
    delete process.env.CIRCUIT_OPEN_THRESHOLD;
    process.env.CIRCUIT_TIMEOUT_MS = "";
    expect(() => validateCircuitBreakerEnv()).not.toThrow();
  });

  it("throws a clear error when CIRCUIT_TIMEOUT_MS is not a number", () => {
    saved = saveEnv();
    delete process.env.CIRCUIT_OPEN_THRESHOLD;
    process.env.CIRCUIT_TIMEOUT_MS = "five-minutes";
    expect(() => validateCircuitBreakerEnv()).toThrow(
      /Invalid CIRCUIT_TIMEOUT_MS.*"five-minutes".*positive integer/
    );
  });

  it("throws a clear error when CIRCUIT_TIMEOUT_MS is zero", () => {
    saved = saveEnv();
    delete process.env.CIRCUIT_OPEN_THRESHOLD;
    process.env.CIRCUIT_TIMEOUT_MS = "0";
    expect(() => validateCircuitBreakerEnv()).toThrow(
      /Invalid CIRCUIT_TIMEOUT_MS.*"0".*positive integer/
    );
  });

  it("throws a clear error when CIRCUIT_TIMEOUT_MS is negative", () => {
    saved = saveEnv();
    delete process.env.CIRCUIT_OPEN_THRESHOLD;
    process.env.CIRCUIT_TIMEOUT_MS = "-300000";
    expect(() => validateCircuitBreakerEnv()).toThrow(
      /Invalid CIRCUIT_TIMEOUT_MS.*"-300000".*positive integer/
    );
  });

  // ── Both variables ──────────────────────────────────────────────────────────

  it("accepts both variables when both are valid", () => {
    saved = saveEnv();
    process.env.CIRCUIT_OPEN_THRESHOLD = "10";
    process.env.CIRCUIT_TIMEOUT_MS = "120000";
    expect(() => validateCircuitBreakerEnv()).not.toThrow();
  });

  it("throws on the first invalid variable even when the second is valid", () => {
    saved = saveEnv();
    process.env.CIRCUIT_OPEN_THRESHOLD = "bad";
    process.env.CIRCUIT_TIMEOUT_MS = "60000";
    expect(() => validateCircuitBreakerEnv()).toThrow(/CIRCUIT_OPEN_THRESHOLD/);
  });
});
