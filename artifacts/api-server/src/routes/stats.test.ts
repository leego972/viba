import { describe, it, expect } from "vitest";
import { resolveAlertSettings, computeRecentSpike, buildTestNotificationMessage, resolveNotificationChannels } from "./stats";

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

describe("resolveNotificationChannels", () => {
  it("returns null for both channels when the settings map is empty", () => {
    const { webhookUrl, notificationEmail } = resolveNotificationChannels(new Map());
    expect(webhookUrl).toBeNull();
    expect(notificationEmail).toBeNull();
  });

  it("extracts NOTIFICATION_EMAIL from the settings map", () => {
    const map = new Map([["NOTIFICATION_EMAIL", "alerts@example.com"]]);
    const { notificationEmail } = resolveNotificationChannels(map);
    expect(notificationEmail).toBe("alerts@example.com");
  });

  it("extracts NOTIFICATION_WEBHOOK_URL from the settings map", () => {
    const map = new Map([["NOTIFICATION_WEBHOOK_URL", "https://hooks.example.com/spike"]]);
    const { webhookUrl } = resolveNotificationChannels(map);
    expect(webhookUrl).toBe("https://hooks.example.com/spike");
  });

  it("extracts both channels when both are present in the settings map", () => {
    const map = new Map([
      ["NOTIFICATION_EMAIL", "ops@company.io"],
      ["NOTIFICATION_WEBHOOK_URL", "https://hooks.example.com/spike"],
    ]);
    const { webhookUrl, notificationEmail } = resolveNotificationChannels(map);
    expect(webhookUrl).toBe("https://hooks.example.com/spike");
    expect(notificationEmail).toBe("ops@company.io");
  });

  it("returns null for webhook when only email is configured", () => {
    const map = new Map([["NOTIFICATION_EMAIL", "alerts@example.com"]]);
    const { webhookUrl } = resolveNotificationChannels(map);
    expect(webhookUrl).toBeNull();
  });

  it("returns null for email when only webhook is configured", () => {
    const map = new Map([["NOTIFICATION_WEBHOOK_URL", "https://hooks.example.com/spike"]]);
    const { notificationEmail } = resolveNotificationChannels(map);
    expect(notificationEmail).toBeNull();
  });

  it("preserves the exact email string from settings without modification", () => {
    const email = "Team.Alerts+spike@company.io";
    const map = new Map([["NOTIFICATION_EMAIL", email]]);
    expect(resolveNotificationChannels(map).notificationEmail).toBe(email);
  });
});

describe("buildTestNotificationMessage", () => {
  it("reports webhook delivered when webhook was sent and no email", () => {
    expect(buildTestNotificationMessage(true, null, false)).toBe("Webhook delivered.");
  });

  it("reports email sent when email was successfully delivered", () => {
    expect(buildTestNotificationMessage(false, "alerts@example.com", true)).toBe(
      "test email sent to alerts@example.com."
    );
  });

  it("reports email not sent with reason when SMTP is not configured", () => {
    const msg = buildTestNotificationMessage(false, "alerts@example.com", false, "SMTP not configured");
    expect(msg).toContain("alerts@example.com");
    expect(msg).toContain("SMTP not configured");
    expect(msg).not.toContain("queued");
  });

  it("reports both channels when webhook delivered and email sent", () => {
    const msg = buildTestNotificationMessage(true, "alerts@example.com", true);
    expect(msg).toContain("Webhook delivered");
    expect(msg).toContain("test email sent to alerts@example.com");
  });

  it("reports both channels when webhook delivered and email not sent", () => {
    const msg = buildTestNotificationMessage(true, "alerts@example.com", false, "SMTP not configured");
    expect(msg).toContain("Webhook delivered");
    expect(msg).toContain("email not sent to alerts@example.com");
  });

  it("falls back to generic message when neither webhook nor email is active", () => {
    expect(buildTestNotificationMessage(false, null, false)).toBe("Test notification sent.");
  });

  it("uses the actual email address in the message", () => {
    const msg = buildTestNotificationMessage(false, "ops@company.io", false);
    expect(msg).toContain("ops@company.io");
  });
});
