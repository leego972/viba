import { describe, it, expect, beforeEach } from "vitest";
import {
  computeShowFallbackBanner,
  getKeysToPrune,
  readDismissedAt,
  pruneStaleLocalStorageKeys,
  BANNER_STORAGE_PREFIX,
  MAX_BANNER_STORAGE_KEYS,
} from "./bannerLogic";

describe("computeShowFallbackBanner", () => {
  it("returns false when there are no fallback messages", () => {
    expect(computeShowFallbackBanner(false, null, null)).toBe(false);
  });

  it("returns true when there are fallback messages and the banner was never dismissed", () => {
    expect(computeShowFallbackBanner(true, null, null)).toBe(true);
  });

  it("returns true when fallback messages exist and dismissedAt is null with a timestamp", () => {
    expect(computeShowFallbackBanner(true, null, "2025-01-01T10:00:00.000Z")).toBe(true);
  });

  it("returns false when dismissed and the latest fallback occurred before dismissal", () => {
    const dismissedAt = "2025-01-01T10:00:00.000Z";
    const latestFallback = "2025-01-01T09:59:59.999Z";
    expect(computeShowFallbackBanner(true, dismissedAt, latestFallback)).toBe(false);
  });

  it("returns false when dismissed and the latest fallback timestamp equals dismissal time", () => {
    const ts = "2025-01-01T10:00:00.000Z";
    expect(computeShowFallbackBanner(true, ts, ts)).toBe(false);
  });

  it("returns true when a newer simulated message arrives after dismissal (#46)", () => {
    const dismissedAt = "2025-01-01T10:00:00.000Z";
    const newFallback = "2025-01-01T10:00:00.001Z";
    expect(computeShowFallbackBanner(true, dismissedAt, newFallback)).toBe(true);
  });

  it("returns false when dismissed and latestFallbackTimestamp is null", () => {
    expect(computeShowFallbackBanner(true, "2025-01-01T10:00:00.000Z", null)).toBe(false);
  });

  it("returns false when hasFallbackMessages is false even if timestamps suggest new fallback", () => {
    const dismissedAt = "2025-01-01T10:00:00.000Z";
    const newFallback = "2025-01-01T11:00:00.000Z";
    expect(computeShowFallbackBanner(false, dismissedAt, newFallback)).toBe(false);
  });

  it("handles ISO timestamps with different precision correctly", () => {
    expect(
      computeShowFallbackBanner(
        true,
        "2025-06-01T08:30:00.000Z",
        "2025-06-01T08:30:01.000Z",
      )
    ).toBe(true);

    expect(
      computeShowFallbackBanner(
        true,
        "2025-06-01T08:30:01.000Z",
        "2025-06-01T08:30:00.000Z",
      )
    ).toBe(false);
  });
});

describe("getKeysToPrune (#47)", () => {
  it("returns empty array when under the limit", () => {
    expect(getKeysToPrune(["a", "b", "c"], 5)).toEqual([]);
  });

  it("returns empty array when exactly at the limit", () => {
    expect(getKeysToPrune(["a", "b"], 2)).toEqual([]);
  });

  it("returns empty array for empty keys", () => {
    expect(getKeysToPrune([], 20)).toEqual([]);
  });

  it("removes the single oldest key when one over limit", () => {
    const keys = [
      "bridge_fallback_banner_3",
      "bridge_fallback_banner_1",
      "bridge_fallback_banner_2",
    ];
    const toRemove = getKeysToPrune(keys, 2);
    expect(toRemove).toHaveLength(1);
    expect(toRemove[0]).toBe("bridge_fallback_banner_1");
  });

  it("removes multiple keys when significantly over limit", () => {
    const keys = ["k5", "k3", "k1", "k4", "k2"];
    const toRemove = getKeysToPrune(keys, 2, "k");
    expect(toRemove).toHaveLength(3);
    expect(toRemove).toEqual(["k1", "k2", "k3"]);
  });

  it("does not mutate the input array", () => {
    const keys = ["z", "a", "m"];
    const original = [...keys];
    getKeysToPrune(keys, 1);
    expect(keys).toEqual(original);
  });

  it("keeps the most recent (lexicographically largest) keys", () => {
    const keys = ["session_100", "session_200", "session_300", "session_400", "session_500"];
    const toRemove = getKeysToPrune(keys, 3);
    expect(toRemove).toEqual(["session_100", "session_200"]);
  });

  it("handles limit of 0 by removing all keys", () => {
    const keys = ["a", "b", "c"];
    const toRemove = getKeysToPrune(keys, 0);
    expect(toRemove).toHaveLength(3);
  });

  it("handles limit larger than key count", () => {
    expect(getKeysToPrune(["a", "b"], 100)).toEqual([]);
  });

  it("handles exactly MAX_BANNER_STORAGE_KEYS (20) keys at the limit", () => {
    const keys = Array.from({ length: 20 }, (_, i) => `k${String(i).padStart(3, "0")}`);
    expect(getKeysToPrune(keys, 20)).toEqual([]);
  });

  it("prunes to exactly the limit when 21 keys exist", () => {
    const keys = Array.from({ length: 21 }, (_, i) => `k${String(i).padStart(3, "0")}`);
    const toRemove = getKeysToPrune(keys, 20);
    expect(toRemove).toHaveLength(1);
    expect(toRemove[0]).toBe("k000");
  });
});

describe("readDismissedAt — legacy integer value handling (#74)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null for a legacy single-digit integer value", () => {
    localStorage.setItem(`${BANNER_STORAGE_PREFIX}1`, "3");
    expect(readDismissedAt(1)).toBeNull();
  });

  it("returns null for a legacy multi-digit integer value", () => {
    localStorage.setItem(`${BANNER_STORAGE_PREFIX}2`, "42");
    expect(readDismissedAt(2)).toBeNull();
  });

  it("returns the ISO timestamp string for a valid dismissal", () => {
    const iso = new Date().toISOString();
    localStorage.setItem(`${BANNER_STORAGE_PREFIX}3`, iso);
    expect(readDismissedAt(3)).toBe(iso);
  });

  it("returns null when no key exists for the session", () => {
    expect(readDismissedAt(9999)).toBeNull();
  });

  it("returns null for a clearly non-date string", () => {
    localStorage.setItem(`${BANNER_STORAGE_PREFIX}4`, "not-a-date");
    expect(readDismissedAt(4)).toBeNull();
  });
});

describe("pruneStaleLocalStorageKeys — mixed legacy integer and ISO values (#74)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes the oldest keys by numeric ID when values are a mix of ISO and legacy integers", () => {
    const iso = new Date().toISOString();

    // IDs 1-12: valid ISO timestamps; IDs 13-25: legacy count-based integers
    for (let i = 1; i <= 12; i++) {
      localStorage.setItem(`${BANNER_STORAGE_PREFIX}${i}`, iso);
    }
    for (let i = 13; i <= 25; i++) {
      localStorage.setItem(`${BANNER_STORAGE_PREFIX}${i}`, "7");
    }

    pruneStaleLocalStorageKeys(MAX_BANNER_STORAGE_KEYS);

    const remaining: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(BANNER_STORAGE_PREFIX)) remaining.push(k);
    }

    expect(remaining).toHaveLength(MAX_BANNER_STORAGE_KEYS);

    // Oldest 5 (IDs 1-5, ISO-valued) must have been pruned
    for (let i = 1; i <= 5; i++) {
      expect(remaining).not.toContain(`${BANNER_STORAGE_PREFIX}${i}`);
    }

    // Remaining 20 (IDs 6-25, mix of ISO and integer values) must survive
    for (let i = 6; i <= 25; i++) {
      expect(remaining).toContain(`${BANNER_STORAGE_PREFIX}${i}`);
    }
  });

  it("legacy integer keys count toward the 20-key limit and are pruned by numeric ID", () => {
    // All 21 keys hold legacy integer values — pruning must still remove the smallest ID
    for (let i = 1; i <= 21; i++) {
      localStorage.setItem(`${BANNER_STORAGE_PREFIX}${i}`, "5");
    }

    pruneStaleLocalStorageKeys(MAX_BANNER_STORAGE_KEYS);

    const remaining: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(BANNER_STORAGE_PREFIX)) remaining.push(k);
    }

    expect(remaining).toHaveLength(MAX_BANNER_STORAGE_KEYS);
    expect(remaining).not.toContain(`${BANNER_STORAGE_PREFIX}1`);
    expect(remaining).toContain(`${BANNER_STORAGE_PREFIX}21`);
  });
});
