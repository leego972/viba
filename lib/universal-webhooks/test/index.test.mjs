import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryWebhookStore,
  UniversalWebhookService,
  calculateBackoffSeconds,
  signPayload,
  verifySignature,
} from "../dist/index.js";

test("signatures verify, expire, and support previous-secret rotation", async () => {
  const body = JSON.stringify({ event: "invoice.paid" });
  const timestamp = 1_700_000_000;
  const signature = await signPayload("0123456789abcdef", timestamp, body);
  assert.equal(await verifySignature({ secret: "0123456789abcdef", timestamp, body, signature, now: timestamp }), true);
  assert.equal(await verifySignature({ secret: "new-secret-123456", previousSecret: "0123456789abcdef", timestamp, body, signature, now: timestamp }), true);
  assert.equal(await verifySignature({ secret: "0123456789abcdef", timestamp, body, signature, now: timestamp + 301 }), false);
});

test("delivery retries, dead-letters, replays, and succeeds", async () => {
  let id = 0;
  const clock = new Date("2026-01-01T00:00:00.000Z");
  const store = new MemoryWebhookStore();
  const service = new UniversalWebhookService(store, () => `id-${++id}`, () => clock, 3);
  const endpoint = await service.registerEndpoint({
    url: "https://example.com/hooks",
    secret: "0123456789abcdef",
    subscribedEvents: ["invoice.paid"],
    active: true,
  });
  const delivery = await service.queue(endpoint.id, {
    id: "evt-1",
    type: "invoice.paid",
    occurredAt: clock.toISOString(),
    version: "1",
    data: { amount: 5000 },
  });
  assert.ok(delivery);
  const first = await service.recordAttempt(delivery.id, { statusCode: 500 });
  assert.equal(first.status, "retry");
  assert.equal(first.nextAttemptAt, "2026-01-01T00:00:30.000Z");
  await service.recordAttempt(delivery.id, { error: "timeout" });
  const third = await service.recordAttempt(delivery.id, { statusCode: 503 });
  assert.equal(third.status, "dead_letter");
  const replayed = await service.replay(delivery.id);
  assert.equal(replayed.status, "pending");
  assert.equal(replayed.attempts.length, 0);
  const success = await service.recordAttempt(delivery.id, { statusCode: 204 });
  assert.equal(success.status, "succeeded");
});

test("inbound events are authenticated and idempotent", async () => {
  const store = new MemoryWebhookStore();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const service = new UniversalWebhookService(store, () => "id", () => now);
  const timestamp = Math.floor(now.getTime() / 1000);
  const body = "{\"ok\":true}";
  const signature = await signPayload("0123456789abcdef", timestamp, body);
  const input = { eventId: "provider-event-1", body, timestamp, signature, secret: "0123456789abcdef" };
  assert.equal(await service.acceptInbound(input), "accepted");
  assert.equal(await service.acceptInbound(input), "duplicate");
  assert.equal(await service.acceptInbound({ ...input, signature: "bad" }), "invalid");
});

test("backoff is exponential and capped", () => {
  assert.equal(calculateBackoffSeconds(1), 30);
  assert.equal(calculateBackoffSeconds(4), 240);
  assert.equal(calculateBackoffSeconds(20), 3600);
});
