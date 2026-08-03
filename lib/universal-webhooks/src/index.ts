export type WebhookEvent<T = unknown> = {
  id: string;
  type: string;
  occurredAt: string;
  version: string;
  data: T;
};

export type WebhookEndpoint = {
  id: string;
  url: string;
  secret: string;
  previousSecret?: string;
  subscribedEvents: string[];
  active: boolean;
};

export type DeliveryStatus = "pending" | "delivering" | "succeeded" | "retry" | "dead_letter";

export type DeliveryAttempt = {
  attempt: number;
  attemptedAt: string;
  statusCode?: number;
  error?: string;
};

export type WebhookDelivery = {
  id: string;
  endpointId: string;
  event: WebhookEvent;
  status: DeliveryStatus;
  attempts: DeliveryAttempt[];
  nextAttemptAt?: string;
};

export interface WebhookStore {
  getEndpoint(id: string): Promise<WebhookEndpoint | undefined>;
  saveEndpoint(endpoint: WebhookEndpoint): Promise<void>;
  getDelivery(id: string): Promise<WebhookDelivery | undefined>;
  saveDelivery(delivery: WebhookDelivery): Promise<void>;
  hasInboundEvent(eventId: string): Promise<boolean>;
  markInboundEvent(eventId: string, receivedAt: string): Promise<void>;
}

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

export function canonicalPayload(timestamp: number, body: string): string {
  return `${timestamp}.${body}`;
}

export async function signPayload(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(canonicalPayload(timestamp, body)));
  return bytesToHex(new Uint8Array(signature));
}

export async function verifySignature(input: {
  secret: string;
  previousSecret?: string;
  timestamp: number;
  body: string;
  signature: string;
  now?: number;
  toleranceSeconds?: number;
}): Promise<boolean> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(now - input.timestamp) > tolerance) return false;

  const current = await signPayload(input.secret, input.timestamp, input.body);
  if (constantTimeEqual(current, input.signature)) return true;
  if (!input.previousSecret) return false;
  const previous = await signPayload(input.previousSecret, input.timestamp, input.body);
  return constantTimeEqual(previous, input.signature);
}

export function calculateBackoffSeconds(attempt: number, baseSeconds = 30, maxSeconds = 3600): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("attempt must be a positive integer");
  return Math.min(baseSeconds * 2 ** (attempt - 1), maxSeconds);
}

export class UniversalWebhookService {
  constructor(
    private readonly store: WebhookStore,
    private readonly ids: () => string,
    private readonly now: () => Date = () => new Date(),
    private readonly maxAttempts = 6,
  ) {}

  async registerEndpoint(endpoint: Omit<WebhookEndpoint, "id"> & { id?: string }): Promise<WebhookEndpoint> {
    if (!endpoint.url.startsWith("https://")) throw new Error("webhook endpoint must use HTTPS");
    if (endpoint.secret.length < 16) throw new Error("webhook secret must contain at least 16 characters");
    const saved: WebhookEndpoint = { ...endpoint, id: endpoint.id ?? this.ids() };
    await this.store.saveEndpoint(saved);
    return saved;
  }

  async queue(endpointId: string, event: WebhookEvent): Promise<WebhookDelivery | undefined> {
    const endpoint = await this.store.getEndpoint(endpointId);
    if (!endpoint || !endpoint.active) return undefined;
    if (!endpoint.subscribedEvents.includes("*") && !endpoint.subscribedEvents.includes(event.type)) return undefined;
    const delivery: WebhookDelivery = {
      id: this.ids(),
      endpointId,
      event,
      status: "pending",
      attempts: [],
    };
    await this.store.saveDelivery(delivery);
    return delivery;
  }

  async recordAttempt(deliveryId: string, result: { statusCode?: number; error?: string }): Promise<WebhookDelivery> {
    const delivery = await this.store.getDelivery(deliveryId);
    if (!delivery) throw new Error("delivery not found");
    const attempt = delivery.attempts.length + 1;
    const succeeded = result.statusCode !== undefined && result.statusCode >= 200 && result.statusCode < 300;
    const attempts = [...delivery.attempts, {
      attempt,
      attemptedAt: this.now().toISOString(),
      ...(result.statusCode === undefined ? {} : { statusCode: result.statusCode }),
      ...(result.error === undefined ? {} : { error: result.error }),
    }];

    let updated: WebhookDelivery;
    if (succeeded) {
      updated = { ...delivery, status: "succeeded", attempts };
      delete updated.nextAttemptAt;
    } else if (attempt >= this.maxAttempts) {
      updated = { ...delivery, status: "dead_letter", attempts };
      delete updated.nextAttemptAt;
    } else {
      const retryAt = new Date(this.now().getTime() + calculateBackoffSeconds(attempt) * 1000).toISOString();
      updated = { ...delivery, status: "retry", attempts, nextAttemptAt: retryAt };
    }
    await this.store.saveDelivery(updated);
    return updated;
  }

  async replay(deliveryId: string): Promise<WebhookDelivery> {
    const delivery = await this.store.getDelivery(deliveryId);
    if (!delivery) throw new Error("delivery not found");
    if (delivery.status !== "dead_letter") throw new Error("only dead-letter deliveries can be replayed");
    const replayed: WebhookDelivery = { ...delivery, status: "pending", attempts: [] };
    delete replayed.nextAttemptAt;
    await this.store.saveDelivery(replayed);
    return replayed;
  }

  async acceptInbound(input: {
    eventId: string;
    body: string;
    timestamp: number;
    signature: string;
    secret: string;
    previousSecret?: string;
    toleranceSeconds?: number;
  }): Promise<"accepted" | "duplicate" | "invalid"> {
    const valid = await verifySignature({
      ...input,
      now: Math.floor(this.now().getTime() / 1000),
    });
    if (!valid) return "invalid";
    if (await this.store.hasInboundEvent(input.eventId)) return "duplicate";
    await this.store.markInboundEvent(input.eventId, this.now().toISOString());
    return "accepted";
  }
}

export class MemoryWebhookStore implements WebhookStore {
  private readonly endpoints = new Map<string, WebhookEndpoint>();
  private readonly deliveries = new Map<string, WebhookDelivery>();
  private readonly inboundEvents = new Map<string, string>();

  async getEndpoint(id: string): Promise<WebhookEndpoint | undefined> { return this.endpoints.get(id); }
  async saveEndpoint(endpoint: WebhookEndpoint): Promise<void> { this.endpoints.set(endpoint.id, structuredClone(endpoint)); }
  async getDelivery(id: string): Promise<WebhookDelivery | undefined> { return this.deliveries.get(id); }
  async saveDelivery(delivery: WebhookDelivery): Promise<void> { this.deliveries.set(delivery.id, structuredClone(delivery)); }
  async hasInboundEvent(eventId: string): Promise<boolean> { return this.inboundEvents.has(eventId); }
  async markInboundEvent(eventId: string, receivedAt: string): Promise<void> { this.inboundEvents.set(eventId, receivedAt); }
}
