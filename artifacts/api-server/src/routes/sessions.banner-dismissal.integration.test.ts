import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { db, sessionsTable, bannerDismissalsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const TEST_GOAL = "__test_banner_dismissal_integration__";

let testSessionId: number;

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
});

afterEach(async () => {
  await db.delete(bannerDismissalsTable).where(eq(bannerDismissalsTable.sessionId, testSessionId));
  await db.delete(sessionsTable).where(eq(sessionsTable.id, testSessionId));
});

describe("GET /api/sessions/:id/banner-dismissal", () => {
  it("returns dismissedAt as null when no dismissal has been recorded", async () => {
    const res = await request(app)
      .get(`/api/sessions/${testSessionId}/banner-dismissal`)
      .expect(200);

    expect(res.body.sessionId).toBe(testSessionId);
    expect(res.body.dismissedAt).toBeNull();
  });

  it("returns the stored dismissedAt timestamp after a dismissal is recorded", async () => {
    const ts = "2026-01-15T12:00:00.000Z";
    await request(app)
      .put(`/api/sessions/${testSessionId}/banner-dismissal`)
      .send({ dismissedAt: ts })
      .expect(200);

    const res = await request(app)
      .get(`/api/sessions/${testSessionId}/banner-dismissal`)
      .expect(200);

    expect(res.body.sessionId).toBe(testSessionId);
    expect(res.body.dismissedAt).not.toBeNull();
    expect(new Date(res.body.dismissedAt).toISOString()).toBe(ts);
  });

  it("returns 404 when the session does not exist", async () => {
    const res = await request(app)
      .get("/api/sessions/999999999/banner-dismissal")
      .expect(404);

    expect(res.body.error).toBeDefined();
  });

  it("returns 400 for a non-numeric session id", async () => {
    const res = await request(app)
      .get("/api/sessions/not-a-number/banner-dismissal")
      .expect(400);

    expect(res.body.error).toBeDefined();
  });
});

describe("PUT /api/sessions/:id/banner-dismissal", () => {
  it("records a dismissal with a server-generated timestamp when no body is provided", async () => {
    const before = new Date();
    const res = await request(app)
      .put(`/api/sessions/${testSessionId}/banner-dismissal`)
      .expect(200);
    const after = new Date();

    expect(res.body.sessionId).toBe(testSessionId);
    const recorded = new Date(res.body.dismissedAt);
    expect(recorded.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(recorded.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("records a dismissal with the provided ISO 8601 timestamp", async () => {
    const ts = "2026-03-10T08:30:00.000Z";
    const res = await request(app)
      .put(`/api/sessions/${testSessionId}/banner-dismissal`)
      .send({ dismissedAt: ts })
      .expect(200);

    expect(res.body.sessionId).toBe(testSessionId);
    expect(new Date(res.body.dismissedAt).toISOString()).toBe(ts);
  });

  it("upserts correctly — a second PUT overwrites the stored timestamp", async () => {
    const first = "2026-01-01T00:00:00.000Z";
    const second = "2026-06-01T00:00:00.000Z";

    await request(app)
      .put(`/api/sessions/${testSessionId}/banner-dismissal`)
      .send({ dismissedAt: first })
      .expect(200);

    await request(app)
      .put(`/api/sessions/${testSessionId}/banner-dismissal`)
      .send({ dismissedAt: second })
      .expect(200);

    const res = await request(app)
      .get(`/api/sessions/${testSessionId}/banner-dismissal`)
      .expect(200);

    expect(new Date(res.body.dismissedAt).toISOString()).toBe(second);
  });

  it("only one row is stored per session after multiple calls", async () => {
    await request(app)
      .put(`/api/sessions/${testSessionId}/banner-dismissal`)
      .send({ dismissedAt: "2026-01-01T00:00:00.000Z" })
      .expect(200);

    await request(app)
      .put(`/api/sessions/${testSessionId}/banner-dismissal`)
      .send({ dismissedAt: "2026-02-01T00:00:00.000Z" })
      .expect(200);

    const rows = await db
      .select()
      .from(bannerDismissalsTable)
      .where(eq(bannerDismissalsTable.sessionId, testSessionId));

    expect(rows).toHaveLength(1);
  });

  it("returns 404 when the session does not exist", async () => {
    const res = await request(app)
      .put("/api/sessions/999999999/banner-dismissal")
      .expect(404);

    expect(res.body.error).toBeDefined();
  });

  it("returns 400 when dismissedAt is not a valid ISO 8601 string", async () => {
    const res = await request(app)
      .put(`/api/sessions/${testSessionId}/banner-dismissal`)
      .send({ dismissedAt: "not-a-date" })
      .expect(400);

    expect(res.body.error).toBeDefined();
  });

  it("returns 400 for a non-numeric session id", async () => {
    const res = await request(app)
      .put("/api/sessions/not-a-number/banner-dismissal")
      .expect(400);

    expect(res.body.error).toBeDefined();
  });
});

describe("DELETE /api/sessions/:id/banner-dismissal", () => {
  it("deletes an existing dismissal and GET returns null afterwards", async () => {
    await request(app)
      .put(`/api/sessions/${testSessionId}/banner-dismissal`)
      .send({ dismissedAt: "2026-04-01T10:00:00.000Z" })
      .expect(200);

    const delRes = await request(app)
      .delete(`/api/sessions/${testSessionId}/banner-dismissal`)
      .expect(200);

    expect(delRes.body.sessionId).toBe(testSessionId);
    expect(delRes.body.dismissedAt).toBeNull();

    const getRes = await request(app)
      .get(`/api/sessions/${testSessionId}/banner-dismissal`)
      .expect(200);

    expect(getRes.body.dismissedAt).toBeNull();
  });

  it("is idempotent — deleting when no dismissal exists still returns 200 with null", async () => {
    const res = await request(app)
      .delete(`/api/sessions/${testSessionId}/banner-dismissal`)
      .expect(200);

    expect(res.body.sessionId).toBe(testSessionId);
    expect(res.body.dismissedAt).toBeNull();
  });

  it("returns 404 when the session does not exist", async () => {
    const res = await request(app)
      .delete("/api/sessions/999999999/banner-dismissal")
      .expect(404);

    expect(res.body.error).toBeDefined();
  });

  it("returns 400 for a non-numeric session id", async () => {
    const res = await request(app)
      .delete("/api/sessions/not-a-number/banner-dismissal")
      .expect(400);

    expect(res.body.error).toBeDefined();
  });
});
