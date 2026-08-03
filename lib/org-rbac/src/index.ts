export type MembershipStatus = "active" | "suspended" | "removed";

export type Organization = {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
};

export type Role = {
  id: string;
  organizationId: string;
  name: string;
  permissions: string[];
  system: boolean;
};

export type Membership = {
  id: string;
  organizationId: string;
  userId: string;
  roleIds: string[];
  status: MembershipStatus;
  createdAt: string;
};

export type Invitation = {
  id: string;
  organizationId: string;
  email: string;
  roleIds: string[];
  tokenHash: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
};

export type AuditEvent = {
  id: string;
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
};

export interface OrgRbacStore {
  getOrganization(id: string): Promise<Organization | undefined>;
  saveOrganization(organization: Organization): Promise<void>;
  getRole(id: string): Promise<Role | undefined>;
  listRoles(organizationId: string): Promise<Role[]>;
  saveRole(role: Role): Promise<void>;
  getMembership(organizationId: string, userId: string): Promise<Membership | undefined>;
  saveMembership(membership: Membership): Promise<void>;
  getInvitationByHash(tokenHash: string): Promise<Invitation | undefined>;
  saveInvitation(invitation: Invitation): Promise<void>;
  appendAudit(event: AuditEvent): Promise<void>;
  listAudit(organizationId: string): Promise<AuditEvent[]>;
}

export class OrgRbacService {
  constructor(
    private readonly store: OrgRbacStore,
    private readonly ids: () => string,
    private readonly hashToken: (token: string) => Promise<string>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createOrganization(input: { name: string; ownerUserId: string }): Promise<Organization> {
    const organization: Organization = {
      id: this.ids(),
      name: input.name.trim(),
      ownerUserId: input.ownerUserId,
      createdAt: this.now().toISOString(),
    };
    if (!organization.name) throw new Error("organization name is required");
    await this.store.saveOrganization(organization);

    const ownerRole: Role = {
      id: this.ids(),
      organizationId: organization.id,
      name: "owner",
      permissions: ["*"],
      system: true,
    };
    await this.store.saveRole(ownerRole);
    await this.store.saveMembership({
      id: this.ids(),
      organizationId: organization.id,
      userId: input.ownerUserId,
      roleIds: [ownerRole.id],
      status: "active",
      createdAt: this.now().toISOString(),
    });
    await this.audit(organization.id, input.ownerUserId, "organization.created", "organization", organization.id);
    return organization;
  }

  async createRole(input: { organizationId: string; actorUserId: string; name: string; permissions: string[] }): Promise<Role> {
    await this.requirePermission(input.organizationId, input.actorUserId, "roles.manage");
    const role: Role = {
      id: this.ids(),
      organizationId: input.organizationId,
      name: input.name.trim(),
      permissions: [...new Set(input.permissions)].sort(),
      system: false,
    };
    if (!role.name) throw new Error("role name is required");
    await this.store.saveRole(role);
    await this.audit(input.organizationId, input.actorUserId, "role.created", "role", role.id);
    return role;
  }

  async invite(input: {
    organizationId: string;
    actorUserId: string;
    email: string;
    roleIds: string[];
    token: string;
    expiresAt: Date;
  }): Promise<Invitation> {
    await this.requirePermission(input.organizationId, input.actorUserId, "members.invite");
    await this.validateRoles(input.organizationId, input.roleIds);
    if (input.expiresAt.getTime() <= this.now().getTime()) throw new Error("invitation expiry must be in the future");
    const invitation: Invitation = {
      id: this.ids(),
      organizationId: input.organizationId,
      email: input.email.trim().toLowerCase(),
      roleIds: [...new Set(input.roleIds)],
      tokenHash: await this.hashToken(input.token),
      expiresAt: input.expiresAt.toISOString(),
    };
    await this.store.saveInvitation(invitation);
    await this.audit(input.organizationId, input.actorUserId, "invitation.created", "invitation", invitation.id);
    return invitation;
  }

  async acceptInvitation(input: { token: string; userId: string }): Promise<Membership> {
    const tokenHash = await this.hashToken(input.token);
    const invitation = await this.store.getInvitationByHash(tokenHash);
    if (!invitation) throw new Error("invitation not found");
    if (invitation.revokedAt) throw new Error("invitation revoked");
    if (invitation.acceptedAt) throw new Error("invitation already accepted");
    if (new Date(invitation.expiresAt).getTime() <= this.now().getTime()) throw new Error("invitation expired");
    const membership: Membership = {
      id: this.ids(),
      organizationId: invitation.organizationId,
      userId: input.userId,
      roleIds: invitation.roleIds,
      status: "active",
      createdAt: this.now().toISOString(),
    };
    invitation.acceptedAt = this.now().toISOString();
    await this.store.saveInvitation(invitation);
    await this.store.saveMembership(membership);
    await this.audit(invitation.organizationId, input.userId, "invitation.accepted", "membership", membership.id);
    return membership;
  }

  async setMembershipStatus(input: {
    organizationId: string;
    actorUserId: string;
    userId: string;
    status: Exclude<MembershipStatus, "active"> | "active";
  }): Promise<Membership> {
    await this.requirePermission(input.organizationId, input.actorUserId, "members.manage");
    const organization = await this.requireOrganization(input.organizationId);
    if (input.userId === organization.ownerUserId && input.status !== "active") throw new Error("owner membership cannot be disabled");
    const membership = await this.requireMembership(input.organizationId, input.userId);
    membership.status = input.status;
    await this.store.saveMembership(membership);
    await this.audit(input.organizationId, input.actorUserId, `membership.${input.status}`, "membership", membership.id);
    return membership;
  }

  async assignRoles(input: { organizationId: string; actorUserId: string; userId: string; roleIds: string[] }): Promise<Membership> {
    await this.requirePermission(input.organizationId, input.actorUserId, "members.manage");
    await this.validateRoles(input.organizationId, input.roleIds);
    const organization = await this.requireOrganization(input.organizationId);
    if (input.userId === organization.ownerUserId) throw new Error("owner roles are managed through ownership transfer");
    const membership = await this.requireMembership(input.organizationId, input.userId);
    membership.roleIds = [...new Set(input.roleIds)];
    await this.store.saveMembership(membership);
    await this.audit(input.organizationId, input.actorUserId, "membership.roles_updated", "membership", membership.id);
    return membership;
  }

  async transferOwnership(input: { organizationId: string; actorUserId: string; newOwnerUserId: string }): Promise<Organization> {
    const organization = await this.requireOrganization(input.organizationId);
    if (organization.ownerUserId !== input.actorUserId) throw new Error("only the current owner can transfer ownership");
    const nextOwner = await this.requireMembership(input.organizationId, input.newOwnerUserId);
    if (nextOwner.status !== "active") throw new Error("new owner must be an active member");
    const roles = await this.store.listRoles(input.organizationId);
    const ownerRole = roles.find((role) => role.system && role.name === "owner");
    if (!ownerRole) throw new Error("owner role missing");
    const currentOwner = await this.requireMembership(input.organizationId, input.actorUserId);
    currentOwner.roleIds = currentOwner.roleIds.filter((roleId) => roleId !== ownerRole.id);
    nextOwner.roleIds = [...new Set([...nextOwner.roleIds, ownerRole.id])];
    organization.ownerUserId = input.newOwnerUserId;
    await this.store.saveMembership(currentOwner);
    await this.store.saveMembership(nextOwner);
    await this.store.saveOrganization(organization);
    await this.audit(input.organizationId, input.actorUserId, "organization.ownership_transferred", "user", input.newOwnerUserId);
    return organization;
  }

  async hasPermission(organizationId: string, userId: string, permission: string): Promise<boolean> {
    const membership = await this.store.getMembership(organizationId, userId);
    if (!membership || membership.status !== "active") return false;
    for (const roleId of membership.roleIds) {
      const role = await this.store.getRole(roleId);
      if (!role || role.organizationId !== organizationId) continue;
      if (role.permissions.includes("*") || role.permissions.includes(permission)) return true;
    }
    return false;
  }

  async requirePermission(organizationId: string, userId: string, permission: string): Promise<void> {
    if (!(await this.hasPermission(organizationId, userId, permission))) throw new Error("permission denied");
  }

  private async validateRoles(organizationId: string, roleIds: string[]): Promise<void> {
    if (roleIds.length === 0) throw new Error("at least one role is required");
    for (const roleId of roleIds) {
      const role = await this.store.getRole(roleId);
      if (!role || role.organizationId !== organizationId) throw new Error("role does not belong to organization");
      if (role.system && role.name === "owner") throw new Error("owner role cannot be assigned directly");
    }
  }

  private async requireOrganization(id: string): Promise<Organization> {
    const organization = await this.store.getOrganization(id);
    if (!organization) throw new Error("organization not found");
    return organization;
  }

  private async requireMembership(organizationId: string, userId: string): Promise<Membership> {
    const membership = await this.store.getMembership(organizationId, userId);
    if (!membership) throw new Error("membership not found");
    return membership;
  }

  private async audit(organizationId: string, actorUserId: string, action: string, targetType: string, targetId: string): Promise<void> {
    await this.store.appendAudit({
      id: this.ids(),
      organizationId,
      actorUserId,
      action,
      targetType,
      targetId,
      occurredAt: this.now().toISOString(),
    });
  }
}

export class MemoryOrgRbacStore implements OrgRbacStore {
  private readonly organizations = new Map<string, Organization>();
  private readonly roles = new Map<string, Role>();
  private readonly memberships = new Map<string, Membership>();
  private readonly invitations = new Map<string, Invitation>();
  private readonly auditEvents: AuditEvent[] = [];

  async getOrganization(id: string): Promise<Organization | undefined> { return structuredClone(this.organizations.get(id)); }
  async saveOrganization(organization: Organization): Promise<void> { this.organizations.set(organization.id, structuredClone(organization)); }
  async getRole(id: string): Promise<Role | undefined> { return structuredClone(this.roles.get(id)); }
  async listRoles(organizationId: string): Promise<Role[]> { return [...this.roles.values()].filter((role) => role.organizationId === organizationId).map((role) => structuredClone(role)); }
  async saveRole(role: Role): Promise<void> { this.roles.set(role.id, structuredClone(role)); }
  async getMembership(organizationId: string, userId: string): Promise<Membership | undefined> { return structuredClone(this.memberships.get(`${organizationId}:${userId}`)); }
  async saveMembership(membership: Membership): Promise<void> { this.memberships.set(`${membership.organizationId}:${membership.userId}`, structuredClone(membership)); }
  async getInvitationByHash(tokenHash: string): Promise<Invitation | undefined> { return structuredClone(this.invitations.get(tokenHash)); }
  async saveInvitation(invitation: Invitation): Promise<void> { this.invitations.set(invitation.tokenHash, structuredClone(invitation)); }
  async appendAudit(event: AuditEvent): Promise<void> { this.auditEvents.push(structuredClone(event)); }
  async listAudit(organizationId: string): Promise<AuditEvent[]> { return this.auditEvents.filter((event) => event.organizationId === organizationId).map((event) => structuredClone(event)); }
}
