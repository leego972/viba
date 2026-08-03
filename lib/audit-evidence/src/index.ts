import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActorType = "user" | "service" | "system" | "api_client" | "automation";

export type EvidenceAttachment = {
  id: string;
  label: string;
  /** Opaque, safe reference to externally stored evidence (object storage key, URN, etc). Never raw content or secrets. */
  storageRef: string;
  contentType?: string;
  /** Optional integrity hash of the referenced content, hex-encoded sha256. */
  sha256?: string;
};

export type RequestContext = {
  requestId?: string;
  correlationId?: string;
  ipAddress?: string;
};

export type AuditEventInput = {
  organizationId: string;
  actorType: ActorType;
  actorId: string;
  category: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  attachments?: EvidenceAttachment[];
  context?: RequestContext;
  occurredAt?: Date;
};

export type AuditEvent = {
  id: string;
  organizationId: string;
  sequence: number;
  actorType: ActorType;
  actorId: string;
  category: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  attachments: EvidenceAttachment[];
  context: RequestContext;
  occurredAt: string;
  prevHash: string;
  hash: string;
};

export type AuditEventFilter = {
  organizationId: string;
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  dateFrom?: Date;
  dateTo?: Date;
};

export type AuditEventPage = {
  events: AuditEvent[];
  nextCursor: string | null;
};

export type ChainVerificationResult = {
  organizationId: string;
  valid: boolean;
  verifiedCount: number;
  brokenAtSequence: number | null;
  brokenEventId: string | null;
  headHash: string | null;
};

export type EvidenceBundle = {
  organizationId: string;
  generatedAt: string;
  eventCount: number;
  events: AuditEvent[];
  chain: {
    genesisHash: string;
    headHash: string | null;
    verified: boolean;
  };
};

export type RedactionConfig = {
  /** Dot-delimited paths within an event's metadata object to redact on read/export, e.g. "billing.cardNumber". */
  redactedMetadataPaths?: string[];
};

const GENESIS_HASH = "GENESIS";
const REDACTED_VALUE = "[REDACTED]";
const FORBIDDEN_FIELD_PATTERN =
  /(password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|credential)/i;

export class TenantAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantAccessError";
  }
}

export class SecretFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretFieldError";
  }
}

export class ImmutableEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImmutableEventError";
  }
}

// ---------------------------------------------------------------------------
// Store contract — intentionally append-only. There is no update or delete
// method on this interface: event mutation and deletion are not representable
// through this API by design.
// ---------------------------------------------------------------------------

export interface AuditEvidenceStore {
  /** Returns the next monotonic sequence number and current head hash for a tenant. */
  getChainHead(organizationId: string): Promise<{ nextSequence: number; headHash: string }>;
  /** Appends a fully-formed, already-hashed event. Implementations must not allow overwriting an existing id. */
  appendEvent(event: AuditEvent): Promise<void>;
  /** Returns events for a tenant, oldest-first by sequence, matching the filter, after the given sequence cursor. */
  queryEvents(filter: AuditEventFilter, afterSequence: number, limit: number): Promise<AuditEvent[]>;
  /** Fetches a single event by id regardless of tenant, used to detect and reject cross-tenant access. */
  getEventById(id: string): Promise<AuditEvent | undefined>;
  /** Returns the full, ordered event history for a tenant for chain verification. */
  listForVerification(organizationId: string): Promise<AuditEvent[]>;
}

// ---------------------------------------------------------------------------
// Canonicalization + hashing
// ---------------------------------------------------------------------------

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortKeys(v);
    return out;
  }
  return value;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function assertNoSecretFields(value: unknown, path = ""): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretFields(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_FIELD_PATTERN.test(key)) {
        throw new SecretFieldError(
          `field "${path ? `${path}.${key}` : key}" looks like a secret and cannot be recorded in audit metadata`,
        );
      }
      assertNoSecretFields(v, path ? `${path}.${key}` : key);
    }
  }
}

function assertSafeAttachment(attachment: EvidenceAttachment): void {
  if (!attachment.id || !attachment.label || !attachment.storageRef) {
    throw new SecretFieldError("evidence attachments require id, label and storageRef");
  }
  if (attachment.storageRef.startsWith("data:")) {
    throw new SecretFieldError("evidence attachments must reference external storage, not embed inline data");
  }
  if (FORBIDDEN_FIELD_PATTERN.test(attachment.storageRef)) {
    throw new SecretFieldError("evidence attachment reference must not contain secret-like values");
  }
  if (attachment.sha256 && !/^[a-f0-9]{64}$/i.test(attachment.sha256)) {
    throw new SecretFieldError("evidence attachment sha256 must be a 64 character hex digest");
  }
}

function encodeCursor(sequence: number): string {
  return Buffer.from(String(sequence), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const decoded = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!Number.isInteger(decoded) || decoded < 0) throw new Error("invalid pagination cursor");
  return decoded;
}

function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc !== null && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function setAtPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = cursor[key];
    if (next === null || typeof next !== "object") return;
    cursor = next as Record<string, unknown>;
  }
  const lastKey = parts[parts.length - 1]!;
  if (Object.prototype.hasOwnProperty.call(cursor, lastKey)) cursor[lastKey] = value;
}

function redactEvent(event: AuditEvent, paths: string[]): AuditEvent {
  if (paths.length === 0) return event;
  const clone: AuditEvent = JSON.parse(JSON.stringify(event));
  for (const path of paths) {
    if (getAtPath(clone.metadata, path) !== undefined) setAtPath(clone.metadata, path, REDACTED_VALUE);
  }
  return clone;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 500;

export class AuditEvidenceService {
  constructor(
    private readonly store: AuditEvidenceStore,
    private readonly ids: () => string,
    private readonly redaction: RedactionConfig = {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recordEvent(input: AuditEventInput): Promise<AuditEvent> {
    if (!input.organizationId) throw new TenantAccessError("organizationId is required to record an event");
    if (!input.actorId) throw new Error("actorId is required");
    if (!input.category) throw new Error("category is required");
    if (!input.action) throw new Error("action is required");
    if (!input.targetType || !input.targetId) throw new Error("targetType and targetId are required");

    const metadata = input.metadata ?? {};
    assertNoSecretFields(metadata, "metadata");
    if (input.before) assertNoSecretFields(input.before, "before");
    if (input.after) assertNoSecretFields(input.after, "after");
    const attachments = input.attachments ?? [];
    attachments.forEach(assertSafeAttachment);

    const { nextSequence, headHash } = await this.store.getChainHead(input.organizationId);

    const unhashed = {
      id: this.ids(),
      organizationId: input.organizationId,
      sequence: nextSequence,
      actorType: input.actorType,
      actorId: input.actorId,
      category: input.category,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata,
      before: input.before ?? null,
      after: input.after ?? null,
      attachments,
      context: {
        requestId: input.context?.requestId,
        correlationId: input.context?.correlationId,
        ipAddress: input.context?.ipAddress,
      },
      occurredAt: (input.occurredAt ?? this.now()).toISOString(),
      prevHash: headHash,
    };

    const hash = sha256Hex(canonicalize(unhashed));
    const event: AuditEvent = Object.freeze({ ...unhashed, hash }) as AuditEvent;

    await this.store.appendEvent(event);
    return event;
  }

  async listEvents(
    filter: AuditEventFilter,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<AuditEventPage> {
    if (!filter.organizationId) throw new TenantAccessError("organizationId is required to list events");
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
    const afterSequence = decodeCursor(options.cursor);

    const rawEvents = await this.store.queryEvents(filter, afterSequence, limit + 1);
    const hasMore = rawEvents.length > limit;
    const page = rawEvents.slice(0, limit);
    const events = page.map((event) => redactEvent(event, this.redaction.redactedMetadataPaths ?? []));
    const nextCursor = hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]!.sequence) : null;
    return { events, nextCursor };
  }

  /** Fetches a single event by id, rejecting the request outright if it belongs to a different tenant. */
  async getEvent(organizationId: string, id: string): Promise<AuditEvent | undefined> {
    if (!organizationId) throw new TenantAccessError("organizationId is required");
    const event = await this.store.getEventById(id);
    if (!event) return undefined;
    if (event.organizationId !== organizationId) {
      throw new TenantAccessError("event does not belong to the requesting tenant");
    }
    return redactEvent(event, this.redaction.redactedMetadataPaths ?? []);
  }

  async verifyChain(organizationId: string): Promise<ChainVerificationResult> {
    if (!organizationId) throw new TenantAccessError("organizationId is required to verify a chain");
    const events = await this.store.listForVerification(organizationId);

    let expectedPrevHash = GENESIS_HASH;
    let verifiedCount = 0;
    for (const event of events) {
      if (event.organizationId !== organizationId) {
        return {
          organizationId,
          valid: false,
          verifiedCount,
          brokenAtSequence: event.sequence,
          brokenEventId: event.id,
          headHash: null,
        };
      }
      if (event.prevHash !== expectedPrevHash) {
        return {
          organizationId,
          valid: false,
          verifiedCount,
          brokenAtSequence: event.sequence,
          brokenEventId: event.id,
          headHash: null,
        };
      }
      const { hash, ...rest } = event;
      const recomputed = sha256Hex(canonicalize(rest));
      if (recomputed !== hash) {
        return {
          organizationId,
          valid: false,
          verifiedCount,
          brokenAtSequence: event.sequence,
          brokenEventId: event.id,
          headHash: null,
        };
      }
      expectedPrevHash = hash;
      verifiedCount += 1;
    }

    return {
      organizationId,
      valid: true,
      verifiedCount,
      brokenAtSequence: null,
      brokenEventId: null,
      headHash: verifiedCount > 0 ? expectedPrevHash : GENESIS_HASH,
    };
  }

  async exportEvidenceBundle(filter: AuditEventFilter): Promise<EvidenceBundle> {
    if (!filter.organizationId) throw new TenantAccessError("organizationId is required to export a bundle");
    const verification = await this.verifyChain(filter.organizationId);

    const events: AuditEvent[] = [];
    let cursor: string | null = null;
    for (;;) {
      const options: { cursor?: string; limit: number } = { limit: MAX_PAGE_LIMIT };
      if (cursor) options.cursor = cursor;
      const page = await this.listEvents(filter, options);
      events.push(...page.events);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    return {
      organizationId: filter.organizationId,
      generatedAt: this.now().toISOString(),
      eventCount: events.length,
      events,
      chain: {
        genesisHash: GENESIS_HASH,
        headHash: verification.headHash,
        verified: verification.valid,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// In-memory reference store (used by tests; a PostgreSQL-backed implementation
// should follow migrations/001_audit_evidence.sql and preserve every guarantee
// below — in particular, it must never expose UPDATE or DELETE on audit_events).
// ---------------------------------------------------------------------------

export class MemoryAuditEvidenceStore implements AuditEvidenceStore {
  private readonly eventsById = new Map<string, AuditEvent>();
  private readonly eventsByOrg = new Map<string, AuditEvent[]>();

  async getChainHead(organizationId: string): Promise<{ nextSequence: number; headHash: string }> {
    const events = this.eventsByOrg.get(organizationId) ?? [];
    const last = events[events.length - 1];
    return { nextSequence: events.length + 1, headHash: last ? last.hash : GENESIS_HASH };
  }

  async appendEvent(event: AuditEvent): Promise<void> {
    if (this.eventsById.has(event.id)) {
      throw new ImmutableEventError(`event ${event.id} already exists and cannot be overwritten`);
    }
    this.eventsById.set(event.id, event);
    const list = this.eventsByOrg.get(event.organizationId) ?? [];
    list.push(event);
    this.eventsByOrg.set(event.organizationId, list);
  }

  async queryEvents(filter: AuditEventFilter, afterSequence: number, limit: number): Promise<AuditEvent[]> {
    const events = this.eventsByOrg.get(filter.organizationId) ?? [];
    const from = filter.dateFrom?.getTime();
    const to = filter.dateTo?.getTime();
    return events
      .filter((event) => event.sequence > afterSequence)
      .filter((event) => !filter.actorId || event.actorId === filter.actorId)
      .filter((event) => !filter.action || event.action === filter.action)
      .filter((event) => !filter.targetType || event.targetType === filter.targetType)
      .filter((event) => !filter.targetId || event.targetId === filter.targetId)
      .filter((event) => from === undefined || new Date(event.occurredAt).getTime() >= from)
      .filter((event) => to === undefined || new Date(event.occurredAt).getTime() <= to)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit);
  }

  async getEventById(id: string): Promise<AuditEvent | undefined> {
    return this.eventsById.get(id);
  }

  async listForVerification(organizationId: string): Promise<AuditEvent[]> {
    return [...(this.eventsByOrg.get(organizationId) ?? [])].sort((a, b) => a.sequence - b.sequence);
  }
}
