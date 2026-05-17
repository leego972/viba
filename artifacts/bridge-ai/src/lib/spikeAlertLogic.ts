export const SPIKE_STORAGE_PREFIX = "bridge_spike_dismissed_";

/**
 * Pure function — filters out providers that have already been dismissed,
 * returning only the providers that should still trigger the alert.
 */
export function computeUndismissedProviders(
  recentSpikeProviders: string[],
  dismissedSpikeProviders: string[],
): string[] {
  return recentSpikeProviders.filter((p) => !dismissedSpikeProviders.includes(p));
}

/**
 * Pure function — determines whether the spike alert should be shown.
 *
 * The alert is shown when:
 * - alertEnabled is true AND
 * - At least one provider in recentSpikeProviders has not been dismissed
 */
export function computeShowSpikeAlert(
  alertEnabled: boolean,
  recentSpikeProviders: string[],
  dismissedSpikeProviders: string[],
): boolean {
  if (!alertEnabled) return false;
  return computeUndismissedProviders(recentSpikeProviders, dismissedSpikeProviders).length > 0;
}

/**
 * Reads the list of dismissed spike providers for a given session from
 * sessionStorage. Returns an empty array if nothing is stored or storage
 * is unavailable.
 */
export function readDismissedSpikeProviders(sessionId: number): string[] {
  try {
    const raw = sessionStorage.getItem(`${SPIKE_STORAGE_PREFIX}${sessionId}`);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

/**
 * Persists the dismissed spike providers for a session to sessionStorage.
 * Silently ignores storage errors (private mode, quota exceeded, etc.).
 */
export function writeDismissedSpikeProviders(sessionId: number, providers: string[]): void {
  try {
    sessionStorage.setItem(`${SPIKE_STORAGE_PREFIX}${sessionId}`, JSON.stringify(providers));
  } catch {
    // Ignore
  }
}
