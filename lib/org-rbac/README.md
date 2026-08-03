# Viba Organization and RBAC

Reusable multi-tenant organization, membership, invitation, role and permission engine.

## Guarantees

- authorization is deny-by-default;
- roles are scoped to one organization;
- membership lookups always include the organization identifier;
- owner role assignment is restricted to ownership transfer;
- suspended and removed members have no permissions;
- invitation tokens are stored by caller-provided hash only;
- audit events are append-only through the store interface.

## Integration

Implement `OrgRbacStore` with PostgreSQL using `migrations/001_org_rbac.sql`. Supply a cryptographic token-hashing function, a collision-resistant ID generator and an injectable clock.

```ts
const service = new OrgRbacService(store, createId, hashToken);
const organization = await service.createOrganization({
  name: "Example",
  ownerUserId: "user_123",
});

await service.requirePermission(organization.id, "user_123", "members.invite");
```

Applications should define a stable permission namespace such as `billing.manage`, `members.invite`, and `reports.read`.
