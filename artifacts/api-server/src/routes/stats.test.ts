import { describe, it, expect } from "vitest";
import { resolveAlertSettings, computeRecentSpike } from "./stats";

describe("resolveAlertSettings", () => {
  it("uses the default threshold when the setting is absent", () => {
    const { alertThreshold } = resolveAlertSettings(new Map());
    expect(alertThreshold).toBe(5);
  });

  it("parses a custom numeric threshold from settings", () => {
    const map = new Map([["FALLBACK_ALERT_THRESHOLD", "10"]]);
    const { alertThreshold } = resolveAlertSettings(map);
    expect(alertThreshold).toBe(10);
  });

  it("clamps a threshold of '0' to 1 rather than silently using the default", () => {
    // parseInt("0") === 0, which is a valid parse; Math.max(1, 0) should clamp to 1
    const map = new Map([["FALLBACK_ALERT_THRESHOLD", "0"]]);
    const { alertThreshold } = resolveAlertSettings(map);
    expect(alertThreshold).toBe(1);
  });

  it("clamps a positive-but-low explicit threshold to at least 1", () => {
    // A value like "1" is a valid, truthy integer so Math.max(1, 1) = 1
    const map = new Map([["FALLBACK_ALERT_THRESHOLD", "1"]]);
    const { alertThreshold } = resolveAlertSettings(map);
    expect(alertThreshold).toBe(1);
  });

  it("falls back to the default threshold for non-numeric values", () => {
    const map = new Map([["FALLBACK_ALERT_THRESHOLD", "not-a-number"]]);
    const { alertThreshold } = resolveAlertSettings(map);
    expect(alertThreshold).toBe(5);
  });

  it("is enabled by default when the setting is absent", () => {
    const { alertEnabled } = resolveAlertSettings(new Map());
    expect(alertEnabled).toBe(true);
  });

  it("is enabled when FALLBACK_ALERT_ENABLED is 'true'", () => {
    const map = new Map([["FALLBACK_ALERT_ENABLED", "true"]]);
    const { alertEnabled } = resolveAlertSettings(map);
    expect(alertEnabled).toBe(true);
  });

  it("is disabled when FALLBACK_ALERT_ENABLED is 'false'", () => {
    const map = new Map([["FALLBACK_ALERT_ENABLED", "false"]]);
    const { alertEnabled } = resolveAlertSettings(map);
    expect(alertEnabled).toBe(false);
  });
});

describe("computeRecentSpike", () => {
  it("returns empty array when alert is disabled, even if threshold is exceeded", () => {
    const recentByProvider = [
      { provider: "openai", count: 20 },
      { provider: "anthropic", count: 15 },
    ];
    expect(computeRecentSpike(recentByProvider, false, 5)).toEqual([]);
  });

  it("returns empty array when no provider exceeds the threshold", () => {
    const recentByProvider = [
      { provider: "openai", count: 3 },
      { provider: "anthropic", count: 2 },
    ];
    expect(computeRecentSpike(recentByProvider, true, 5)).toEqual([]);
  });

  it("flags providers that meet or exceed the threshold", () => {
    const recentByProvider = [
      { provider: "openai", count: 8 },
      { provider: "anthropic", count: 5 },
      { provider: "google", count: 4 },
    ];
    const result = computeRecentSpike(recentByProvider, true, 5);
    expect(result).toContain("openai");
    expect(result).toContain("anthropic");
    expect(result).not.toContain("google");
  });

  it("respects a custom threshold from settings", () => {
    const recentByProvider = [
      { provider: "openai", count: 3 },
      { provider: "anthropic", count: 2 },
    ];
    const result = computeRecentSpike(recentByProvider, true, 3);
    expect(result).toContain("openai");
    expect(result).not.toContain("anthropic");
  });

  it("returns empty array when input is empty", () => {
    expect(computeRecentSpike([], true, 5)).toEqual([]);
  });

  it("window boundary — provider count drops below threshold when old events are excluded", () => {
    // Simulates the case where a provider had 6 total fallbacks but only 4 occurred
    // within the last hour (the DB query filters out events older than 1 hour).
    // recentByProvider reflects only the in-window rows returned by the DB.
    const recentByProvider = [
      { provider: "openai", count: 4 },
    ];
    expect(computeRecentSpike(recentByProvider, true, 5)).toEqual([]);
  });

  it("window boundary — provider triggers alert when enough events fall within the hour", () => {
    // Same provider but now the DB query shows 5 events within the last hour,
    // crossing the threshold exactly.
    const recentByProvider = [
      { provider: "openai", count: 5 },
    ];
    const result = computeRecentSpike(recentByProvider, true, 5);
    expect(result).toContain("openai");
  });

  it("alert disabled with custom threshold still returns empty", () => {
    const recentByProvider = [
      { provider: "openai", count: 100 },
    ];
    expect(computeRecentSpike(recentByProvider, false, 1)).toEqual([]);
  });
});
