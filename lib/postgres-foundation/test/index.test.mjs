import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeIdentifier,
  buildCursorPage,
  buildKeysetPredicate,
  decodeCursor,
  encodeCursor,
  normalizeLimit,
  softDeleteClause,
  withTransaction,
} from "../dist/index.js";

test("cursor round trip and pagination boundary", () => {
  const cursor = encodeCursor({ createdAt: "2026-01-01T00:00:00.000Z", id: "00000000-0000-0000-0000-000000000001" });
  assert.deepEqual(decodeCursor(cursor), { createdAt: "2026-01-01T00:00:00.000Z", id: "00000000-0000-0000-0000-000000000001" });
  const page = buildCursorPage([
    { createdAt: "2026-01-02T00:00:00Z", id: "a" },
    { createdAt: "2026-01-01T00:00:00Z", id: "b" },
  ], 1);
  assert.equal(page.items.length, 1);
  assert.ok(page.nextCursor);
});

test("rejects unsafe values", () => {
  assert.throws(() => decodeCursor("not valid"), /Invalid cursor/);
  assert.throws(() => normalizeLimit(201), /between/);
  assert.throws(() => assertSafeIdentifier("users;DROP TABLE users"), /Unsafe/);
  assert.equal(softDeleteClause("record"), "record.deleted_at IS NULL");
});

test("builds parameterized keyset predicate", () => {
  const result = buildKeysetPredicate({ createdAt: "2026-01-01T00:00:00Z", id: "00000000-0000-0000-0000-000000000001" }, 3);
  assert.match(result.sql, /\$3::timestamptz/);
  assert.match(result.sql, /\$4::uuid/);
  assert.equal(result.values.length, 2);
});

test("commits successful transactions and releases client", async () => {
  const statements = [];
  let released = false;
  const client = {
    async query(text) { statements.push(text); return { rows: [], rowCount: 0 }; },
    release() { released = true; },
  };
  const result = await withTransaction({ connect: async () => client, query: client.query }, async () => 42);
  assert.equal(result, 42);
  assert.deepEqual(statements, ["BEGIN", "COMMIT"]);
  assert.equal(released, true);
});

test("rolls back failed transactions", async () => {
  const statements = [];
  const client = {
    async query(text) { statements.push(text); return { rows: [], rowCount: 0 }; },
    release() {},
  };
  await assert.rejects(
    withTransaction({ connect: async () => client, query: client.query }, async () => { throw new Error("failure"); }),
    /failure/,
  );
  assert.deepEqual(statements, ["BEGIN", "ROLLBACK"]);
});
