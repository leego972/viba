import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const CLEARABLE_KEY = "NOTIFICATION_WEBHOOK_URL";
const NON_CLEARABLE_KEY = "FALLBACK_ALERT_THRESHOLD";

afterEach(async () => {
  await db.delete(settingsTable).where(eq(settingsTable.key, CLEARABLE_KEY));
  await db.delete(settingsTable).where(eq(settingsTable.key, NON_CLEARABLE_KEY));
});

describe("POST /api/settings — clearing a clearable key", () => {
  beforeEach(async () => {
    await db
      .insert(settingsTable)
      .values({ key: CLEARABLE_KEY, value: "https://example.com/webhook" });
  });

  it("deletes the row when an empty string is POSTed for a clearable key", async () => {
    await request(app)
      .post("/api/settings")
      .send({ settings: [{ key: CLEARABLE_KEY, value: "" }] })
      .expect(200);

    const rows = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, CLEARABLE_KEY));

    expect(rows).toHaveLength(0);
  });
});

describe("POST /api/settings — non-clearable key with empty value", () => {
  const ORIGINAL_VALUE = "10";

  beforeEach(async () => {
    await db
      .insert(settingsTable)
      .values({ key: NON_CLEARABLE_KEY, value: ORIGINAL_VALUE });
  });

  it("does not delete the row when an empty string is POSTed for a non-clearable key", async () => {
    await request(app)
      .post("/api/settings")
      .send({ settings: [{ key: NON_CLEARABLE_KEY, value: "" }] })
      .expect(200);

    const rows = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, NON_CLEARABLE_KEY));

    expect(rows).toHaveLength(1);
  });

  it("preserves the original value when an empty string is POSTed for a non-clearable key", async () => {
    await request(app)
      .post("/api/settings")
      .send({ settings: [{ key: NON_CLEARABLE_KEY, value: "" }] })
      .expect(200);

    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, NON_CLEARABLE_KEY));

    expect(row).toBeDefined();
    expect(row.value).toBe(ORIGINAL_VALUE);
  });
});

describe("GET /api/settings — date serialization", () => {
  beforeEach(async () => {
    await db
      .insert(settingsTable)
      .values({ key: NON_CLEARABLE_KEY, value: "5" });
  });

  it("returns 200 with valid JSON", async () => {
    await request(app).get("/api/settings").expect(200);
  });

  it("returns createdAt and updatedAt as ISO 8601 strings, not Date objects", async () => {
    const res = await request(app).get("/api/settings").expect(200);

    expect(Array.isArray(res.body)).toBe(true);

    const entry = (res.body as Array<{ key: string; createdAt: unknown; updatedAt: unknown }>).find(
      (s) => s.key === NON_CLEARABLE_KEY,
    );
    expect(entry).toBeDefined();

    expect(typeof entry!.createdAt).toBe("string");
    expect(typeof entry!.updatedAt).toBe("string");

    expect(() => new Date(entry!.createdAt as string)).not.toThrow();
    expect(new Date(entry!.createdAt as string).toISOString()).toBe(entry!.createdAt);
    expect(new Date(entry!.updatedAt as string).toISOString()).toBe(entry!.updatedAt);
  });
});
