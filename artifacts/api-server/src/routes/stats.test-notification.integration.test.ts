import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { db, settingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: vi.fn().mockResolvedValue(["93.184.216.34"]),
    resolve6: vi.fn().mockResolvedValue(["2606:2800:220:1:248:1893:25c8:1946"]),
  },
}));

const NOTIFICATION_KEYS = ["NOTIFICATION_WEBHOOK_URL", "NOTIFICATION_EMAIL"] as const;

async function setSettings(pairs: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(pairs)) {
    await db
      .insert(settingsTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value } });
  }
}

async function clearNotificationSettings(): Promise<void> {
  await db
    .delete(settingsTable)
    .where(inArray(settingsTable.key, [...NOTIFICATION_KEYS]));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await clearNotificationSettings();
  vi.unstubAllGlobals();
});

describe("POST /api/stats/test-notification — no channel configured", () => {
  it("returns 400 when neither webhook URL nor email is set", async () => {
    const res = await request(app)
      .post("/api/stats/test-notification")
      .expect(400);

    expect(res.body.error).toMatch(/no notification channel configured/i);
  });

  it("includes a helpful message about configuring settings", async () => {
    const res = await request(app)
      .post("/api/stats/test-notification")
      .expect(400);

    expect(res.body.error).toMatch(/webhook url or email/i);
  });
});

describe("POST /api/stats/test-notification — unsafe webhook URL rejection", () => {
  it("returns 400 when the webhook URL targets localhost", async () => {
    await setSettings({ NOTIFICATION_WEBHOOK_URL: "http://localhost/hook" });

    const res = await request(app)
      .post("/api/stats/test-notification")
      .expect(400);

    expect(res.body.error).toMatch(/webhook delivery failed/i);
    expect(res.body.error).toMatch(/localhost/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the webhook URL targets a private 192.168.x.x address", async () => {
    await setSettings({ NOTIFICATION_WEBHOOK_URL: "http://192.168.1.100/hook" });

    const res = await request(app)
      .post("/api/stats/test-notification")
      .expect(400);

    expect(res.body.error).toMatch(/webhook delivery failed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the webhook URL targets a private 10.x.x.x address", async () => {
    await setSettings({ NOTIFICATION_WEBHOOK_URL: "http://10.0.0.1/hook" });

    const res = await request(app)
      .post("/api/stats/test-notification")
      .expect(400);

    expect(res.body.error).toMatch(/webhook delivery failed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the webhook URL targets a loopback IP (127.x)", async () => {
    await setSettings({ NOTIFICATION_WEBHOOK_URL: "http://127.0.0.1/hook" });

    const res = await request(app)
      .post("/api/stats/test-notification")
      .expect(400);

    expect(res.body.error).toMatch(/webhook delivery failed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/stats/test-notification — valid external webhook", () => {
  it("returns 200 with ok:true when the webhook responds successfully", async () => {
    await setSettings({ NOTIFICATION_WEBHOOK_URL: "https://hooks.example.com/test" });

    const res = await request(app)
      .post("/api/stats/test-notification")
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(typeof res.body.message).toBe("string");
  });

  it("calls the webhook URL with a POST request", async () => {
    await setSettings({ NOTIFICATION_WEBHOOK_URL: "https://hooks.example.com/test" });

    await request(app).post("/api/stats/test-notification").expect(200);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.example.com/test");
    expect(init.method).toBe("POST");
  });

  it("sends a test_notification event in the webhook body", async () => {
    await setSettings({ NOTIFICATION_WEBHOOK_URL: "https://hooks.example.com/test" });

    await request(app).post("/api/stats/test-notification").expect(200);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("test_notification");
    expect(typeof body.message).toBe("string");
    expect(typeof body.timestamp).toBe("string");
  });

  it("reports 'Webhook delivered' in the response message", async () => {
    await setSettings({ NOTIFICATION_WEBHOOK_URL: "https://hooks.example.com/test" });

    const res = await request(app).post("/api/stats/test-notification").expect(200);

    expect(res.body.message).toContain("Webhook delivered");
  });

  it("returns 400 when the external webhook responds with a non-OK status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await setSettings({ NOTIFICATION_WEBHOOK_URL: "https://hooks.example.com/test" });

    const res = await request(app)
      .post("/api/stats/test-notification")
      .expect(400);

    expect(res.body.error).toMatch(/webhook delivery failed/i);
    expect(res.body.error).toMatch(/503/);
  });
});

describe("POST /api/stats/test-notification — email-only channel", () => {
  it("returns 200 with ok:true when only email is configured", async () => {
    await setSettings({ NOTIFICATION_EMAIL: "alerts@example.com" });

    const res = await request(app)
      .post("/api/stats/test-notification")
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("includes the configured email address in the response message", async () => {
    await setSettings({ NOTIFICATION_EMAIL: "alerts@example.com" });

    const res = await request(app)
      .post("/api/stats/test-notification")
      .expect(200);

    expect(res.body.message).toContain("alerts@example.com");
  });
});
