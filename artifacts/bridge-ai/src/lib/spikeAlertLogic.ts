export const SPIKE_STORAGE_PREFIX = "bridge_spike_dismissed_";
export const MAX_SPIKE_STORAGE_KEYS = 20;

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
 * localStorage. Returns an empty array if nothing is stored or storage
 * is unavailable.
 */
export function readDismissedSpikeProviders(sessionId: number): string[] {
  try {
    const raw = localStorage.getItem(`${SPIKE_STORAGE_PREFIX}${sessionId}`);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

/**
 * Persists the dismissed spike providers for a session to localStorage so
 * that dismissals survive page reloads. Silently ignores storage errors
 * (private mode, quota exceeded, etc.).
 */
export function writeDismissedSpikeProviders(sessionId: number, providers: string[]): void {
  try {
    localStorage.setItem(`${SPIKE_STORAGE_PREFIX}${sessionId}`, JSON.stringify(providers));
  } catch {
    // Ignore
  }
}

/**
 * Pure function — returns the localStorage keys that should be removed to
 * keep the total number of spike dismissal entries under the given limit.
 * Oldest session IDs (lowest numeric suffix) are removed first.
 */
export function getSpikeKeysToPrune(
  keys: string[],
  limit: number,
  prefix = SPIKE_STORAGE_PREFIX,
): string[] {
  if (keys.length <= limit) return [];
  const sorted = [...keys].sort((a, b) => {
    const idA = parseInt(a.slice(prefix.length), 10);
    const idB = parseInt(b.slice(prefix.length), 10);
    return idA - idB;
  });
  return sorted.slice(0, keys.length - limit);
}

/**
 * Side-effectful — prunes stale spike dismissal keys from localStorage
 * so entries don't accumulate indefinitely across many sessions.
 */
export function pruneStaleSpikeDismissalKeys(limit = MAX_SPIKE_STORAGE_KEYS): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(SPIKE_STORAGE_PREFIX)) keys.push(k);
    }
    const toRemove = getSpikeKeysToPrune(keys, limit);
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignore — localStorage may be unavailable (SSR, private mode, quota exceeded)
  }
}

// ── Cross-tab sync via BroadcastChannel ───────────────────────────────────────

export const SPIKE_BROADCAST_CHANNEL_NAME = "bridge_spike_dismissal";

export interface SpikeDismissalMessage {
  sessionId: number;
  providers: string[];
}

/**
 * Broadcasts a spike dismissal to all other open tabs on the same origin
 * so their alerts hide immediately without waiting for a reload.
 */
export function broadcastSpikeDismissal(sessionId: number, providers: string[]): void {
  try {
    const channel = new BroadcastChannel(SPIKE_BROADCAST_CHANNEL_NAME);
    const msg: SpikeDismissalMessage = { sessionId, providers };
    channel.postMessage(msg);
    channel.close();
  } catch {
    // BroadcastChannel unavailable in this environment (SSR, old browser)
  }
}

/**
 * Subscribes to spike dismissal messages from other tabs. Returns a cleanup
 * function that closes the channel — call it from a useEffect return.
 */
export function subscribeToSpikeDismissals(
  callback: (msg: SpikeDismissalMessage) => void,
): () => void {
  try {
    const channel = new BroadcastChannel(SPIKE_BROADCAST_CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent<SpikeDismissalMessage>) => {
      callback(event.data);
    };
    return () => channel.close();
  } catch {
    return () => {};
  }
}
