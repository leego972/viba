export const SIMULATED_PREFIX = "⚠️ [Simulated";
export const BANNER_STORAGE_PREFIX = "bridge_fallback_banner_";
export const MAX_BANNER_STORAGE_KEYS = 20;

/**
 * Pure function — determines if the simulation fallback banner should be shown.
 *
 * The banner is shown when:
 * - There are fallback messages AND
 * - The user has not dismissed it yet, OR a newer simulated message arrived
 *   after the last dismissal timestamp (#46).
 */
export function computeShowFallbackBanner(
  hasFallbackMessages: boolean,
  dismissedAt: string | null,
  latestFallbackTimestamp: string | null,
): boolean {
  if (!hasFallbackMessages) return false;
  if (dismissedAt === null) return true;
  return latestFallbackTimestamp !== null && latestFallbackTimestamp > dismissedAt;
}

/**
 * Pure function — returns the keys that should be removed to keep storage
 * under the given limit (#47). Removes the lexicographically oldest keys.
 */
export function getKeysToPrune(keys: string[], limit: number): string[] {
  if (keys.length <= limit) return [];
  const sorted = [...keys].sort();
  return sorted.slice(0, keys.length - limit);
}

/**
 * Side-effectful — prunes stale banner dismissal keys from localStorage
 * so entries don't accumulate indefinitely across many sessions (#47).
 */
export function pruneStaleLocalStorageKeys(limit = MAX_BANNER_STORAGE_KEYS): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(BANNER_STORAGE_PREFIX)) keys.push(k);
    }
    const toRemove = getKeysToPrune(keys, limit);
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignore — localStorage may be unavailable (SSR, private mode, quota exceeded)
  }
}

/**
 * Reads and validates the stored dismissal timestamp for a given session.
 * Legacy count-based values (plain integers) are treated as "not dismissed".
 */
export function readDismissedAt(sessionId: number): string | null {
  try {
    const stored = localStorage.getItem(`${BANNER_STORAGE_PREFIX}${sessionId}`);
    if (stored !== null && isNaN(Date.parse(stored))) return null;
    return stored;
  } catch {
    return null;
  }
}

/**
 * Persists the current ISO timestamp as the dismissal time for this session.
 */
export function writeDismissedAt(sessionId: number, isoTimestamp: string): void {
  try {
    localStorage.setItem(`${BANNER_STORAGE_PREFIX}${sessionId}`, isoTimestamp);
  } catch {
    // Ignore
  }
}
