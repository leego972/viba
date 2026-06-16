import { setAuthTokenGetter } from "@workspace/api-client-react";

const STORAGE_KEY = "viba_access_token";

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // sessionStorage unavailable (e.g. some private-browsing restrictions)
  }
}

export function clearStoredToken(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Call once at app startup.
 * Registers the stored access token as the bearer on every API request
 * made through customFetch (generated hooks + direct calls).
 */
export function initAuth(): void {
  setAuthTokenGetter(getStoredToken);
}
