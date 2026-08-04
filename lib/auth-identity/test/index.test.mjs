import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthValidationError,
  constantTimeEqual,
  createOAuthState,
  createSession,
  decodeOAuthState,
  encodeOAuthState,
  genericCredentialFailure,
  isSessionActive,
  normalizeEmail,
  revokeSession,
  safeReturnPath,
  touchSession,
  validatePassword,
  verifyOAuthState,
} from "../dist/index.js";

const at = (iso) => () => new Date(iso);

test("normalizes and validates email addresses", () => {
  assert.equal(normalizeEmail(" USER@Example.COM "), "user@example.com");
  assert.throws(() => normalizeEmail("not-an-email"), AuthValidationError);
});

test("enforces password length bounds", () => {
  assert.doesNotThrow(() => validatePassword("correct horse battery staple"));
  assert.throws(() => validatePassword("short"), AuthValidationError);
  assert.throws(() => validatePassword("x".repeat(1025)), AuthValidationError);
});

test("rejects open redirects", () => {
  assert.equal(safeReturnPath("/dashboard?tab=1"), "/dashboard?tab=1");
  assert.equal(safeReturnPath("https://evil.example"), "/");
  assert.equal(safeReturnPath("//evil.example"), "/");
  assert.equal(safeReturnPath("/\\evil.example"), "/");
});

test("creates and verifies bounded OAuth state", () => {
  const state = createOAuthState("/account", at("2026-08-03T00:00:00Z"));
  const encoded = encodeOAuthState(state);
  assert.deepEqual(decodeOAuthState(encoded), state);
  const verified = verifyOAuthState({ encodedState: encoded, expectedNonce: state.nonce, maxAgeMs: 300000, now: at("2026-08-03T00:04:00Z") });
  assert.equal(verified.returnPath, "/account");
  assert.throws(() => verifyOAuthState({ encodedState: encoded, expectedNonce: "wrong", maxAgeMs: 300000, now: at("2026-08-03T00:04:00Z") }));
  assert.throws(() => verifyOAuthState({ encodedState: encoded, expectedNonce: state.nonce, maxAgeMs: 1000, now: at("2026-08-03T00:04:00Z") }));
});

test("uses constant-time comparison semantics", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("a", "longer"), false);
});

test("creates, extends, expires and revokes sessions", () => {
  const policy = { idleTimeoutMs: 60000, absoluteTimeoutMs: 300000 };
  const session = createSession({ userId: "user-1", policy, now: at("2026-08-03T00:00:00Z"), ip: "203.0.113.1" });
  assert.equal(isSessionActive(session, at("2026-08-03T00:00:30Z")), true);
  const touched = touchSession(session, policy, at("2026-08-03T00:00:30Z"));
  assert.equal(touched.expiresAt.toISOString(), "2026-08-03T00:01:30.000Z");
  assert.equal(isSessionActive(touched, at("2026-08-03T00:05:00Z")), false);
  const revoked = revokeSession(touched, at("2026-08-03T00:01:00Z"));
  assert.equal(isSessionActive(revoked, at("2026-08-03T00:01:01Z")), false);
});

test("returns a non-enumerating login failure", () => {
  assert.deepEqual(genericCredentialFailure(), { code: "INVALID_CREDENTIALS", message: "Invalid email or password." });
});
