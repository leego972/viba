const SUBSCRIPTION_KEY = "viba_subscription_token";
const BYPASS_KEY = "viba_bypass_valid";

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
