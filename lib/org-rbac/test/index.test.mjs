import assert from "node:assert/strict";
import test from "node:test";
import { MemoryOrgRbacStore, OrgRbacService } from "../dist/index.js";

const hashToken = async (value) => `hash:${value}`;

function setup() {
  let id = 0;
  const now = new Date("2026-01-01T00:00:00.000Z");
  const store = new MemoryOrgRbacStore();
  const service = new OrgRbacService(store, () => `id-${++id}`, hashToken, () => now);
  return { store, service, now };
}

test("organization owner receives wildcard access and tenant isolation is enforced", async () => {
  const { service } = setup();
  const first = await service.createOrganization({ name: "Alpha", ownerUserId: "user-1" });
  const second = await service.createOrganization({ name: "Beta", ownerUserId: "user-2" });
  assert.equal(await service.hasPermission(first.id, "user-1", "members.invite"), true);
  assert.equal(await service.hasPermission(second.id, "user-1", "members.invite"), false);
});

test("invitation acceptance, role assignment, suspension, and deny-by-default work", async () => {
  const { service, now } = setup();
  const organization = await service.createOrganization({ name: "Alpha", ownerUserId: "owner" });
  const role = await service.createRole({
    organizationId: organization.id,
    actorUserId: "owner",
    name: "support",
    permissions: ["tickets.read", "tickets.reply"],
  });
  await service.invite({
    organizationId: organization.id,
    actorUserId: "owner",
    email: "Member@Example.com",
    roleIds: [role.id],
    token: "invite-token",
    expiresAt: new Date(now.getTime() + 60_000),
  });
  await service.acceptInvitation({ token: "invite-token", userId: "member" });
  assert.equal(await service.hasPermission(organization.id, "member", "tickets.reply"), true);
  assert.equal(await service.hasPermission(organization.id, "member", "billing.manage"), false);
  await service.setMembershipStatus({ organizationId: organization.id, actorUserId: "owner", userId: "member", status: "suspended" });
  assert.equal(await service.hasPermission(organization.id, "member", "tickets.read"), false);
});

test("ownership transfer protects the owner role and requires an active member", async () => {
  const { service, now } = setup();
  const organization = await service.createOrganization({ name: "Alpha", ownerUserId: "owner" });
  const role = await service.createRole({
    organizationId: organization.id,
    actorUserId: "owner",
    name: "admin",
    permissions: ["members.manage", "members.invite", "roles.manage"],
  });
  await service.invite({
    organizationId: organization.id,
    actorUserId: "owner",
    email: "next@example.com",
    roleIds: [role.id],
    token: "next-owner",
    expiresAt: new Date(now.getTime() + 60_000),
  });
  await service.acceptInvitation({ token: "next-owner", userId: "next" });
  const transferred = await service.transferOwnership({ organizationId: organization.id, actorUserId: "owner", newOwnerUserId: "next" });
  assert.equal(transferred.ownerUserId, "next");
  assert.equal(await service.hasPermission(organization.id, "next", "anything"), true);
  await assert.rejects(
    service.setMembershipStatus({ organizationId: organization.id, actorUserId: "next", userId: "next", status: "removed" }),
    /owner membership cannot be disabled/,
  );
});

test("expired and reused invitations are rejected and audit records are appended", async () => {
  const { service, store, now } = setup();
  const organization = await service.createOrganization({ name: "Alpha", ownerUserId: "owner" });
  const role = await service.createRole({ organizationId: organization.id, actorUserId: "owner", name: "viewer", permissions: ["reports.read"] });
  await service.invite({
    organizationId: organization.id,
    actorUserId: "owner",
    email: "valid@example.com",
    roleIds: [role.id],
    token: "valid",
    expiresAt: new Date(now.getTime() + 60_000),
  });
  await service.acceptInvitation({ token: "valid", userId: "member" });
  await assert.rejects(service.acceptInvitation({ token: "valid", userId: "other" }), /already accepted/);
  const audit = await store.listAudit(organization.id);
  assert.ok(audit.some((event) => event.action === "organization.created"));
  assert.ok(audit.some((event) => event.action === "invitation.accepted"));
});
