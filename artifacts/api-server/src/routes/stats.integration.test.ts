import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { db, sessionsTable, auditLogsTable, settingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const TEST_GOAL = "__test_spike_alert_integration__";

let testSessionId: number;

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

async function deleteSettings(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db.delete(settingsTable).where(inArray(settingsTable.key, keys));
}

beforeEach(async () => {
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

  await deleteSettings(["FALLBACK_ALERT_THRESHOLD", "FALLBACK_ALERT_ENABLED"]);
});

afterEach(async () => {
  await db.delete(auditLogsTable).where(eq(auditLogsTable.sessionId, testSessionId));
  await db.delete(sessionsTable).where(eq(sessionsTable.id, testSessionId));
  await deleteSettings(["FALLBACK_ALERT_THRESHOLD", "FALLBACK_ALERT_ENABLED"]);
});

describe("GET /api/stats — fallback spike alert (integration)", () => {
  it("returns empty recentSpikeProviders when no fallbacks exist", async () => {
    const res = await request(app).get("/api/stats").expect(200);
    expect(Array.isArray(res.body.recentSpikeProviders)).toBe(true);
    expect(res.body.recentSpikeProviders).toEqual([]);
  });

  it("returns empty recentSpikeProviders when fallback count is below the threshold", async () => {
    for (let i = 0; i < 4; i++) {
      await insertFallback("openai", minsAgo(10 + i));
    }
    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.recentSpikeProviders).not.toContain("openai");
  });

  it("flags a provider when fallback count meets the default threshold (5) within the hour", async () => {
    for (let i = 0; i < 5; i++) {
      await insertFallback("openai", minsAgo(10 + i));
    }
    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.recentSpikeProviders).toContain("openai");
  });

  it("only flags providers that exceed the threshold, not those below it", async () => {
    for (let i = 0; i < 6; i++) await insertFallback("openai", minsAgo(5));
    for (let i = 0; i < 3; i++) await insertFallback("anthropic", minsAgo(5));

    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.recentSpikeProviders).toContain("openai");
    expect(res.body.recentSpikeProviders).not.toContain("anthropic");
  });

  it("respects alertEnabled=false — returns no spike providers even when threshold is exceeded", async () => {
    await setSettings({ FALLBACK_ALERT_ENABLED: "false" });
    for (let i = 0; i < 10; i++) await insertFallback("openai", minsAgo(5));

    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.alertEnabled).toBe(false);
    expect(res.body.recentSpikeProviders).toEqual([]);
  });

  it("re-enables spike detection when FALLBACK_ALERT_ENABLED is 'true'", async () => {
    await setSettings({ FALLBACK_ALERT_ENABLED: "true" });
    for (let i = 0; i < 5; i++) await insertFallback("openai", minsAgo(5));

    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.alertEnabled).toBe(true);
    expect(res.body.recentSpikeProviders).toContain("openai");
  });

  it("uses a custom threshold from settings", async () => {
    await setSettings({ FALLBACK_ALERT_THRESHOLD: "3" });
    for (let i = 0; i < 3; i++) await insertFallback("anthropic", minsAgo(10));

    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.recentSpikeThreshold).toBe(3);
    expect(res.body.recentSpikeProviders).toContain("anthropic");
  });

  it("does not alert when count is below a raised custom threshold", async () => {
    await setSettings({ FALLBACK_ALERT_THRESHOLD: "10" });
    for (let i = 0; i < 9; i++) await insertFallback("openai", minsAgo(5));

    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.recentSpikeThreshold).toBe(10);
    expect(res.body.recentSpikeProviders).not.toContain("openai");
  });

  it("window boundary — events older than 1 hour are NOT counted toward the spike", async () => {
    for (let i = 0; i < 5; i++) {
      await insertFallback("openai", minsAgo(62 + i));
    }

    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.recentSpikeProviders).not.toContain("openai");
  });

  it("window boundary — events exactly within the hour ARE counted", async () => {
    for (let i = 0; i < 5; i++) {
      await insertFallback("openai", minsAgo(55 + i));
    }

    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.recentSpikeProviders).toContain("openai");
  });

  it("window boundary — mixing in-window and out-of-window events uses only in-window count", async () => {
    for (let i = 0; i < 4; i++) await insertFallback("openai", minsAgo(62));
    for (let i = 0; i < 3; i++) await insertFallback("openai", minsAgo(30));

    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.recentSpikeProviders).not.toContain("openai");
  });

  it("window boundary — crossing threshold only with in-window events fires the alert", async () => {
    for (let i = 0; i < 3; i++) await insertFallback("openai", minsAgo(62));
    for (let i = 0; i < 5; i++) await insertFallback("openai", minsAgo(30));

    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.recentSpikeProviders).toContain("openai");
  });

  it("reports the threshold in recentSpikeThreshold in the response", async () => {
    const res = await request(app).get("/api/stats").expect(200);
    expect(typeof res.body.recentSpikeThreshold).toBe("number");
    expect(res.body.recentSpikeThreshold).toBe(5);
  });
});

describe("GET /api/stats — spike threshold change takes effect in real time", () => {
  it("reflects a threshold lowered via the settings API on the next stats call", async () => {
    await request(app)
      .post("/api/settings")
      .send({ settings: [{ key: "FALLBACK_ALERT_THRESHOLD", value: "3" }] })
      .expect(200);

    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.recentSpikeThreshold).toBe(3);
  });

  it("reflects a threshold raised via the settings API on the next stats call", async () => {
    await request(app)
      .post("/api/settings")
      .send({ settings: [{ key: "FALLBACK_ALERT_THRESHOLD", value: "12" }] })
      .expect(200);

    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.recentSpikeThreshold).toBe(12);
  });

  it("triggers a spike alert for providers that exceed the newly lowered threshold", async () => {
    for (let i = 0; i < 3; i++) await insertFallback("openai", minsAgo(10 + i));

    await request(app)
      .post("/api/settings")
      .send({ settings: [{ key: "FALLBACK_ALERT_THRESHOLD", value: "3" }] })
      .expect(200);

    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.recentSpikeThreshold).toBe(3);
    expect(res.body.recentSpikeProviders).toContain("openai");
  });

  it("suppresses a spike alert when the threshold is raised above the current fallback count", async () => {
    for (let i = 0; i < 5; i++) await insertFallback("openai", minsAgo(10 + i));

    await request(app)
      .post("/api/settings")
      .send({ settings: [{ key: "FALLBACK_ALERT_THRESHOLD", value: "10" }] })
      .expect(200);

    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.recentSpikeThreshold).toBe(10);
    expect(res.body.recentSpikeProviders).not.toContain("openai");
  });

  it("updates the threshold twice and stats reflects the final value", async () => {
    await request(app)
      .post("/api/settings")
      .send({ settings: [{ key: "FALLBACK_ALERT_THRESHOLD", value: "2" }] })
      .expect(200);

    await request(app)
      .post("/api/settings")
      .send({ settings: [{ key: "FALLBACK_ALERT_THRESHOLD", value: "8" }] })
      .expect(200);

    const res = await request(app).get("/api/stats").expect(200);
    expect(res.body.recentSpikeThreshold).toBe(8);
  });
});
