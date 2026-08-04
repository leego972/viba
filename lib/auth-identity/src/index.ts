import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type Clock = () => Date;

export type SessionRecord = {
  id: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  deviceId?: string;
  ipHash?: string;
  userAgentHash?: string;
};

export type SessionPolicy = {
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
};

export type OAuthState = {
  nonce: string;
  returnPath: string;
  issuedAt: number;
};

export class AuthValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthValidationError";
  }
}

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthValidationError("invalid email address");
  return email;
}

export function validatePassword(password: string, minimumLength = 12): void {
  if (password.length < minimumLength) throw new AuthValidationError(`password must contain at least ${minimumLength} characters`);
  if (password.length > 1024) throw new AuthValidationError("password is too long");
}

export function safeReturnPath(value: string | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const parsed = new URL(value, "https://local.invalid");
    return parsed.origin === "https://local.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
  } catch { return fallback; }
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b); const max = Math.max(left.length, right.length, 1);
  const paddedLeft = Buffer.alloc(max); const paddedRight = Buffer.alloc(max);
  left.copy(paddedLeft); right.copy(paddedRight);
  return timingSafeEqual(paddedLeft, paddedRight) && left.length === right.length;
}

export function hashOpaqueValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createOAuthState(returnPath: string | undefined, now: Clock = () => new Date()): OAuthState {
  return { nonce: randomBytes(32).toString("base64url"), returnPath: safeReturnPath(returnPath, "/"), issuedAt: now().getTime() };
}

export function encodeOAuthState(state: OAuthState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeOAuthState(encoded: string): OAuthState {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<OAuthState>;
    if (typeof parsed.nonce !== "string" || typeof parsed.returnPath !== "string" || typeof parsed.issuedAt !== "number") throw new Error("invalid shape");
    return { nonce: parsed.nonce, returnPath: safeReturnPath(parsed.returnPath, "/"), issuedAt: parsed.issuedAt };
  } catch { throw new AuthValidationError("invalid OAuth state"); }
}

export function verifyOAuthState(params: { encodedState: string; expectedNonce: string; maxAgeMs: number; now?: Clock }): OAuthState {
  const state = decodeOAuthState(params.encodedState); const now = (params.now ?? (() => new Date()))().getTime();
  if (!constantTimeEqual(state.nonce, params.expectedNonce)) throw new AuthValidationError("OAuth state nonce mismatch");
  if (state.issuedAt > now || now - state.issuedAt > params.maxAgeMs) throw new AuthValidationError("OAuth state expired");
  return state;
}

export function createSession(params: { userId: string; policy: SessionPolicy; now?: Clock; deviceId?: string; ip?: string; userAgent?: string }): SessionRecord {
  const now = (params.now ?? (() => new Date()))();
  if (params.policy.idleTimeoutMs <= 0 || params.policy.absoluteTimeoutMs <= 0) throw new AuthValidationError("session timeouts must be positive");
  if (params.policy.idleTimeoutMs > params.policy.absoluteTimeoutMs) throw new AuthValidationError("idle timeout cannot exceed absolute timeout");
  const session: SessionRecord = { id: randomBytes(32).toString("base64url"), userId: params.userId, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + params.policy.idleTimeoutMs), absoluteExpiresAt: new Date(now.getTime() + params.policy.absoluteTimeoutMs), revokedAt: null };
  if (params.deviceId !== undefined) session.deviceId = params.deviceId;
  if (params.ip !== undefined) session.ipHash = hashOpaqueValue(params.ip);
  if (params.userAgent !== undefined) session.userAgentHash = hashOpaqueValue(params.userAgent);
  return session;
}

export function isSessionActive(session: SessionRecord, now: Clock = () => new Date()): boolean {
  const at = now().getTime(); return session.revokedAt === null && at < session.expiresAt.getTime() && at < session.absoluteExpiresAt.getTime();
}

export function touchSession(session: SessionRecord, policy: SessionPolicy, now: Clock = () => new Date()): SessionRecord {
  if (!isSessionActive(session, now)) throw new AuthValidationError("session is not active");
  const at = now(); const nextIdle = Math.min(at.getTime() + policy.idleTimeoutMs, session.absoluteExpiresAt.getTime());
  return { ...session, lastSeenAt: at, expiresAt: new Date(nextIdle) };
}

export function revokeSession(session: SessionRecord, now: Clock = () => new Date()): SessionRecord {
  return session.revokedAt ? session : { ...session, revokedAt: now() };
}

export function genericCredentialFailure(): { code: "INVALID_CREDENTIALS"; message: string } {
  return { code: "INVALID_CREDENTIALS", message: "Invalid email or password." };
}
