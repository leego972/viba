import assert from "node:assert/strict";
import test from "node:test";
import {
  AuditEvidenceService,
  MemoryAuditEvidenceStore,
  SecretFieldError,
  TenantAccessError,
  canonicalize,
} from "../dist/index.js";

function setup(redaction = {}) {
  let id = 0;
  const store = new MemoryAuditEvidenceStore();
  const service = new AuditEvidenceService(store, () => `evt-${++id}`, redaction, () => new Date("2026-01-01T00:00:00.000Z"));
  return { store, service };
}

test("records events with deterministic ordering and a valid hash chain", async () => {
  const { service } = setup();
  await service.recordEvent({
    organizationId: "org-1",
    actorType: "user",
    actorId: "user-1",
    category: "billing",
    action: "invoice.created",
    targetType: "invoice",
    targetId: "inv-1",
  });
  await service.recordEvent({
    organizationId: "org-1",
    actorType: "user",
    actorId: "user-1",
    category: "billing",
    action: "invoice.paid",
    targetType: "invoice",
    targetId: "inv-1",
  });
  const page = await service.listEvents({ organizationId: "org-1" });
  assert.equal(page.events.length, 2);
  assert.equal(page.events[0].sequence, 1);
  assert.equal(page.events[1].sequence, 2);
  assert.equal(page.events[1].prevHash, page.events[0].hash);

  const verification = await service.verifyChain("org-1");
  assert.equal(verification.valid, true);
  assert.equal(verification.verifiedCount, 2);
});

test("detects tampering during hash-chain verification", async () => {
  const { service, store } = setup();
  const event = await service.recordEvent({
    organizationId: "org-1",
    actorType: "system",
    actorId: "svc-1",
    category: "security",
    action: "role.granted",
    targetType: "role",
    targetId: "role-1",
    metadata: { grantedRole: "admin" },
  });

  // Simulate tampering by mutating a clone and re-inserting through the raw map.
  const tampered = { ...event, action: "role.revoked" };
  store["eventsById"].set(event.id, tampered);
  store["eventsByOrg"].set("org-1", [tampered]);

  const verification = await service.verifyChain("org-1");
  assert.equal(verification.valid, false);
  assert.equal(verification.brokenEventId, event.id);
});

test("stored events are frozen and cannot be mutated in place", async () => {
  const { service } = setup();
  const event = await service.recordEvent({
    organizationId: "org-1",
    actorType: "user",
    actorId: "user-1",
    category: "settings",
    action: "settings.updated",
    targetType: "settings",
    targetId: "settings-1",
  });
  assert.throws(() => {
    "use strict";
    event.action = "settings.deleted";
  }, TypeError);
});

test("rejects secrets in metadata and unsafe evidence attachment references", async () => {
  const { service } = setup();
  await assert.rejects(
    service.recordEvent({
      organizationId: "org-1",
      actorType: "user",
      actorId: "user-1",
      category: "auth",
      action: "login",
      targetType: "session",
      targetId: "sess-1",
      metadata: { apiKey: "sk-live-123" },
    }),
    SecretFieldError,
  );

  await assert.rejects(
    service.recordEvent({
      organizationId: "org-1",
      actorType: "user",
      actorId: "user-1",
      category: "auth",
      action: "login",
      targetType: "session",
      targetId: "sess-1",
      attachments: [{ id: "att-1", label: "screenshot", storageRef: "data:image/png;base64,AAAA" }],
    }),
    SecretFieldError,
  );
});

test("enforces deny-by-default tenant scoping and rejects cross-tenant access", async () => {
  const { service } = setup();
  const eventOrgA = await service.recordEvent({
    organizationId: "org-a",
    actorType: "user",
    actorId: "user-1",
    category: "billing",
    action: "invoice.created",
    targetType: "invoice",
    targetId: "inv-1",
  });
  await service.recordEvent({
    organizationId: "org-b",
    actorType: "user",
    actorId: "user-2",
    category: "billing",
    action: "invoice.created",
    targetType: "invoice",
    targetId: "inv-2",
  });

  const pageA = await service.listEvents({ organizationId: "org-a" });
  assert.equal(pageA.events.length, 1);
  assert.equal(pageA.events[0].organizationId, "org-a");

  await assert.rejects(service.getEvent("org-b", eventOrgA.id), TenantAccessError);
  await assert.rejects(service.listEvents({ organizationId: "" }), TenantAccessError);
});

test("paginates deterministically with a cursor and respects filters", async () => {
  const { service } = setup();
  for (let i = 0; i < 5; i++) {
    await service.recordEvent({
      organizationId: "org-1",
      actorType: "user",
      actorId: "user-1",
      category: "billing",
      action: i % 2 === 0 ? "invoice.created" : "invoice.paid",
      targetType: "invoice",
      targetId: `inv-${i}`,
    });
  }
  const firstPage = await service.listEvents({ organizationId: "org-1" }, { limit: 2 });
  assert.equal(firstPage.events.length, 2);
  assert.ok(firstPage.nextCursor);

  const secondPage = await service.listEvents({ organizationId: "org-1" }, { limit: 2, cursor: firstPage.nextCursor });
  assert.equal(secondPage.events.length, 2);
  assert.notEqual(secondPage.events[0].id, firstPage.events[0].id);

  const filtered = await service.listEvents({ organizationId: "org-1", action: "invoice.paid" });
  assert.ok(filtered.events.every((event) => event.action === "invoice.paid"));
});

test("redacts configured metadata paths on read without altering the stored hash", async () => {
  const { service } = setup({ redactedMetadataPaths: ["customer.ssn"] });
  const event = await service.recordEvent({
    organizationId: "org-1",
    actorType: "user",
    actorId: "user-1",
    category: "kyc",
    action: "identity.verified",
    targetType: "customer",
    targetId: "cust-1",
    metadata: { customer: { ssn: "123-45-6789", name: "Alex" } },
  });
  assert.equal(event.metadata.customer.ssn, "123-45-6789");

  const page = await service.listEvents({ organizationId: "org-1" });
  assert.equal(page.events[0].metadata.customer.ssn, "[REDACTED]");
  assert.equal(page.events[0].metadata.customer.name, "Alex");

  const verification = await service.verifyChain("org-1");
  assert.equal(verification.valid, true);
});

test("exports a full evidence bundle with chain verification metadata", async () => {
  const { service } = setup();
  await service.recordEvent({
    organizationId: "org-1",
    actorType: "user",
    actorId: "user-1",
    category: "billing",
    action: "invoice.created",
    targetType: "invoice",
    targetId: "inv-1",
    before: null,
    after: { status: "created" },
    context: { requestId: "req-1", correlationId: "corr-1", ipAddress: "203.0.113.5" },
  });
  const bundle = await service.exportEvidenceBundle({ organizationId: "org-1" });
  assert.equal(bundle.eventCount, 1);
  assert.equal(bundle.chain.verified, true);
  assert.ok(bundle.chain.headHash);
  const parsed = JSON.parse(JSON.stringify(bundle));
  assert.equal(parsed.organizationId, "org-1");
});

test("canonicalization is deterministic regardless of key order", () => {
  const a = canonicalize({ b: 1, a: { d: 2, c: 3 } });
  const b = canonicalize({ a: { c: 3, d: 2 }, b: 1 });
  assert.equal(a, b);
});

test("empty tenants verify as a valid, empty genesis chain", async () => {
  const { service } = setup();
  const verification = await service.verifyChain("org-empty");
  assert.equal(verification.valid, true);
  assert.equal(verification.verifiedCount, 0);
  assert.equal(verification.headHash, "GENESIS");
});
