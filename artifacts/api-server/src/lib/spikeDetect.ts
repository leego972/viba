export interface ProviderCount {
  provider: string;
  count: number;
}

/**
 * Pure function — given a list of per-provider fallback counts and a threshold,
 * returns the providers that exceed or meet the threshold.
 */
export function detectSpikeProviders(
  counts: ProviderCount[],
  threshold: number
): string[] {
  return counts
    .filter((p) => p.count >= threshold)
    .map((p) => p.provider);
}
