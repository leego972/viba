import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { db, sessionsTable, auditLogsTable, settingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/spikeNotify", () => ({
  sendSpikeNotifications: vi.fn().mockResolvedValue(undefined),
  sendTestWebhookNotification: vi.fn().mockResolvedValue(undefined),
}));

const TEST_GOAL = "__test_spike_email_forwarding__";
const SETTINGS_KEYS = [
  "NOTIFICATION_EMAIL",
  "NOTIFICATION_WEBHOOK_URL",
  "FALLBACK_ALERT_THRESHOLD",
  "FALLBACK_ALERT_ENABLED",
] as const;

let testSessionId: number;
let sendSpikeNotifications: ReturnType<typeof vi.fn>;

function minsAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

async function insertFallback(provider: string, createdAt: Date): Promise<void> {
  await db.insert(auditLogsTable).values({
    sessionId: testSessionId,
    eventType: "adapter_fallback",
    description: "test fallback",
    metadata: { provider },
    createdAt,
  });
}

async function setSettings(pairs: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(pairs)) {
    await db
      .insert(settingsTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value } });
  }
}

async function deleteSettings(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await db.delete(settingsTable).where(inArray(settingsTable.key, [...keys]));
}

beforeEach(async () => {
  const mod = await import("../lib/spikeNotify");
  sendSpikeNotifications = mod.sendSpikeNotifications as ReturnType<typeof vi.fn>;
  sendSpikeNotifications.mockClear();

  const [session] = await db
    .insert(sessionsTable)
    .values({
      goal: TEST_GOAL,
      status: "active",
      autonomyMode: "supervised",
      mode: "simulation",
    })
    .returning({ id: sessionsTable.id });
  testSessionId = session.id;

  await deleteSettings(SETTINGS_KEYS);
});

afterEach(async () => {
  await db.delete(auditLogsTable).where(eq(auditLogsTable.sessionId, testSessionId));
  await db.delete(sessionsTable).where(eq(sessionsTable.id, testSessionId));
  await deleteSettings(SETTINGS_KEYS);
});

describe("GET /api/stats — NOTIFICATION_EMAIL forwarding on spike (integration)", () => {
  it("calls sendSpikeNotifications with the configured email when a spike is detected", async () => {
    await setSettings({ NOTIFICATION_EMAIL: "ops@example.com" });
    for (let i = 0; i < 5; i++) {
      await insertFallback("openai", minsAgo(10 + i));
    }

    await request(app).get("/api/stats").expect(200);

    await vi.waitFor(() => {
      expect(sendSpikeNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ notificationEmail: "ops@example.com" })
      );
    });
  });

  it("calls sendSpikeNotifications with null notificationEmail when NOTIFICATION_EMAIL is not configured", async () => {
    for (let i = 0; i < 5; i++) {
      await insertFallback("openai", minsAgo(10 + i));
    }

    await request(app).get("/api/stats").expect(200);

    await vi.waitFor(() => {
      expect(sendSpikeNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ notificationEmail: null })
      );
    });
  });

  it("does not call sendSpikeNotifications when no spike is detected", async () => {
    await setSettings({ NOTIFICATION_EMAIL: "ops@example.com" });
    for (let i = 0; i < 4; i++) {
      await insertFallback("openai", minsAgo(10 + i));
    }

    await request(app).get("/api/stats").expect(200);

    await new Promise((r) => setTimeout(r, 50));
    expect(sendSpikeNotifications).not.toHaveBeenCalled();
  });

  it("forwards the exact email address from settings without modification", async () => {
    const email = "Team.Alerts+bridgeai@company.io";
    await setSettings({ NOTIFICATION_EMAIL: email });
    for (let i = 0; i < 5; i++) {
      await insertFallback("anthropic", minsAgo(5 + i));
    }

    await request(app).get("/api/stats").expect(200);

    await vi.waitFor(() => {
      expect(sendSpikeNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ notificationEmail: email })
      );
    });
  });

  it("forwards both email and webhookUrl when both channels are configured", async () => {
    await setSettings({
      NOTIFICATION_EMAIL: "alerts@example.com",
      NOTIFICATION_WEBHOOK_URL: "https://hooks.example.com/spike",
    });
    for (let i = 0; i < 5; i++) {
      await insertFallback("openai", minsAgo(5 + i));
    }

    await request(app).get("/api/stats").expect(200);

    await vi.waitFor(() => {
      expect(sendSpikeNotifications).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationEmail: "alerts@example.com",
          webhookUrl: "https://hooks.example.com/spike",
        })
      );
    });
  });

  it("passes the spiking provider details into sendSpikeNotifications", async () => {
    await setSettings({ NOTIFICATION_EMAIL: "ops@example.com" });
    for (let i = 0; i < 6; i++) {
      await insertFallback("openai", minsAgo(5 + i));
    }

    await request(app).get("/api/stats").expect(200);

    await vi.waitFor(() => {
      expect(sendSpikeNotifications).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationEmail: "ops@example.com",
          providers: expect.arrayContaining([
            expect.objectContaining({ provider: "openai" }),
          ]),
          threshold: expect.any(Number),
        })
      );
    });
  });
});
