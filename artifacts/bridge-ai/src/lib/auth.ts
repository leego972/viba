import { setAuthTokenGetter } from "@workspace/api-client-react";

const STORAGE_KEY = "viba_access_token";
const SUBSCRIPTION_KEY = "viba_subscription_token";
const BYPASS_KEY = "viba_bypass_valid";

// ─── Password-mode token (ACCESS_TOKEN env var) ──────────────────────────────

export function getStoredToken(): string | null {
  try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
}
export function setStoredToken(token: string): void {
  try { sessionStorage.setItem(STORAGE_KEY, token); } catch {}
}
export function clearStoredToken(): void {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
}

// ─── Subscription token (Stripe mode — persists across sessions) ─────────────

export function getSubscriptionToken(): string | null {
  try { return localStorage.getItem(SUBSCRIPTION_KEY); } catch { return null; }
}
export function setSubscriptionToken(token: string): void {
  try { localStorage.setItem(SUBSCRIPTION_KEY, token); } catch {}
}
export function clearSubscriptionToken(): void {
  try { localStorage.removeItem(SUBSCRIPTION_KEY); } catch {}
}

// ─── Archibald Titan bypass flag (session-scoped) ────────────────────────────

export function isBypassValid(): boolean {
  try { return sessionStorage.getItem(BYPASS_KEY) === "1"; } catch { return false; }
}
export function setBypassValid(): void {
  try { sessionStorage.setItem(BYPASS_KEY, "1"); } catch {}
}

// ─── App startup ─────────────────────────────────────────────────────────────

/** Call once at app startup to register the stored token as the API bearer. */
export function initAuth(): void {
  setAuthTokenGetter(getStoredToken);
}
