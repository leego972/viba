import { describe, it, expect, beforeEach } from "vitest";
import {
  computeUndismissedProviders,
  computeShowSpikeAlert,
  readDismissedSpikeProviders,
  writeDismissedSpikeProviders,
  getSpikeKeysToPrune,
  pruneStaleSpikeDismissalKeys,
  SPIKE_STORAGE_PREFIX,
  MAX_SPIKE_STORAGE_KEYS,
} from "./spikeAlertLogic";

describe("computeUndismissedProviders", () => {
  it("returns all providers when none have been dismissed", () => {
    expect(computeUndismissedProviders(["openai", "anthropic"], [])).toEqual([
      "openai",
      "anthropic",
    ]);
  });

  it("returns an empty array when all providers have been dismissed", () => {
    expect(
      computeUndismissedProviders(["openai", "anthropic"], ["openai", "anthropic"]),
    ).toEqual([]);
  });

  it("returns only the providers that have not been dismissed", () => {
    expect(
      computeUndismissedProviders(["openai", "anthropic", "cohere"], ["openai"]),
    ).toEqual(["anthropic", "cohere"]);
  });

  it("returns an empty array when there are no spiking providers", () => {
    expect(computeUndismissedProviders([], ["openai"])).toEqual([]);
  });

  it("returns an empty array when both lists are empty", () => {
    expect(computeUndismissedProviders([], [])).toEqual([]);
  });

  it("is not affected by dismissed providers that are not currently spiking", () => {
    expect(
      computeUndismissedProviders(["cohere"], ["openai", "anthropic"]),
    ).toEqual(["cohere"]);
  });
});

describe("computeShowSpikeAlert — visibility", () => {
  it("returns true when a provider is spiking and nothing has been dismissed", () => {
    expect(computeShowSpikeAlert(true, ["openai"], [])).toBe(true);
  });

  it("returns false when alertEnabled is false, even if providers are spiking", () => {
    expect(computeShowSpikeAlert(false, ["openai"], [])).toBe(false);
  });

  it("returns false when there are no spiking providers", () => {
    expect(computeShowSpikeAlert(true, [], [])).toBe(false);
  });

  it("returns false when all spiking providers have been dismissed", () => {
    expect(computeShowSpikeAlert(true, ["openai"], ["openai"])).toBe(false);
  });

  it("returns false when alertEnabled is false even after dismissal", () => {
    expect(computeShowSpikeAlert(false, ["openai"], ["openai"])).toBe(false);
  });
});

describe("computeShowSpikeAlert — re-appear after new provider arrives", () => {
  it("returns true when a new provider is added that was not in the dismissed set", () => {
    const dismissedAfterFirst = ["openai"];
    const updatedSpikeProviders = ["openai", "anthropic"];
    expect(computeShowSpikeAlert(true, updatedSpikeProviders, dismissedAfterFirst)).toBe(true);
  });

  it("returns false when a new provider appears but alertEnabled is false", () => {
    const dismissed = ["openai"];
    const updated = ["openai", "anthropic"];
    expect(computeShowSpikeAlert(false, updated, dismissed)).toBe(false);
  });

  it("only shows undismissed providers in the undismissed list after new arrival", () => {
    const dismissed = ["openai"];
    const updated = ["openai", "anthropic", "cohere"];
    const undismissed = computeUndismissedProviders(updated, dismissed);
    expect(undismissed).toEqual(["anthropic", "cohere"]);
  });

  it("returns false once the newly-added provider is also dismissed", () => {
    const fullyDismissed = ["openai", "anthropic"];
    expect(computeShowSpikeAlert(true, ["openai", "anthropic"], fullyDismissed)).toBe(false);
  });
});

describe("readDismissedSpikeProviders / writeDismissedSpikeProviders — localStorage persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns an empty array when nothing has been stored", () => {
    expect(readDismissedSpikeProviders(1)).toEqual([]);
  });

  it("returns the stored providers after writing them", () => {
    writeDismissedSpikeProviders(42, ["openai", "anthropic"]);
    expect(readDismissedSpikeProviders(42)).toEqual(["openai", "anthropic"]);
  });

  it("stores under the correct localStorage key", () => {
    writeDismissedSpikeProviders(7, ["cohere"]);
    const raw = localStorage.getItem(`${SPIKE_STORAGE_PREFIX}7`);
    expect(raw).toBe(JSON.stringify(["cohere"]));
  });

  it("isolates data per session ID", () => {
    writeDismissedSpikeProviders(1, ["openai"]);
    writeDismissedSpikeProviders(2, ["anthropic"]);
    expect(readDismissedSpikeProviders(1)).toEqual(["openai"]);
    expect(readDismissedSpikeProviders(2)).toEqual(["anthropic"]);
  });

  it("returns an empty array when the stored value is an empty list", () => {
    writeDismissedSpikeProviders(5, []);
    expect(readDismissedSpikeProviders(5)).toEqual([]);
  });

  it("reflects the updated list after overwriting a previous dismissal", () => {
    writeDismissedSpikeProviders(10, ["openai"]);
    writeDismissedSpikeProviders(10, ["openai", "anthropic"]);
    expect(readDismissedSpikeProviders(10)).toEqual(["openai", "anthropic"]);
  });

  it("survives a simulated page reload (reads back from localStorage on fresh call)", () => {
    writeDismissedSpikeProviders(99, ["openai", "cohere"]);
    // Simulate reload: read in a fresh call without using any in-memory state
    const readBack = readDismissedSpikeProviders(99);
    expect(readBack).toEqual(["openai", "cohere"]);
  });

  it("re-triggers for a new provider that was not in the stored dismissal list", () => {
    writeDismissedSpikeProviders(20, ["openai"]);
    const dismissed = readDismissedSpikeProviders(20);
    // A new provider has appeared after the stored dismissal
    const updatedProviders = ["openai", "anthropic"];
    expect(computeShowSpikeAlert(true, updatedProviders, dismissed)).toBe(true);
  });

  it("does not re-trigger if the new provider list exactly matches the stored dismissal", () => {
    writeDismissedSpikeProviders(21, ["openai", "anthropic"]);
    const dismissed = readDismissedSpikeProviders(21);
    expect(computeShowSpikeAlert(true, ["openai", "anthropic"], dismissed)).toBe(false);
  });
});

describe("getSpikeKeysToPrune", () => {
  it("returns an empty array when within the limit", () => {
    const keys = [`${SPIKE_STORAGE_PREFIX}1`, `${SPIKE_STORAGE_PREFIX}2`];
    expect(getSpikeKeysToPrune(keys, 5)).toEqual([]);
  });

  it("returns the oldest keys when over the limit", () => {
    const keys = [1, 2, 3, 4, 5, 6].map((n) => `${SPIKE_STORAGE_PREFIX}${n}`);
    const toRemove = getSpikeKeysToPrune(keys, 4);
    expect(toRemove).toEqual([
      `${SPIKE_STORAGE_PREFIX}1`,
      `${SPIKE_STORAGE_PREFIX}2`,
    ]);
  });

  it("sorts numerically so high IDs are always kept over lower ones", () => {
    const keys = [10, 9, 100, 5].map((n) => `${SPIKE_STORAGE_PREFIX}${n}`);
    const toRemove = getSpikeKeysToPrune(keys, 2);
    expect(toRemove).toEqual([
      `${SPIKE_STORAGE_PREFIX}5`,
      `${SPIKE_STORAGE_PREFIX}9`,
    ]);
  });

  it("returns an empty array when the key list is exactly at the limit", () => {
    const keys = [1, 2, 3].map((n) => `${SPIKE_STORAGE_PREFIX}${n}`);
    expect(getSpikeKeysToPrune(keys, 3)).toEqual([]);
  });
});

describe("pruneStaleSpikeDismissalKeys", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes oldest keys when over the limit", () => {
    for (let i = 1; i <= MAX_SPIKE_STORAGE_KEYS + 3; i++) {
      writeDismissedSpikeProviders(i, ["openai"]);
    }
    pruneStaleSpikeDismissalKeys(MAX_SPIKE_STORAGE_KEYS);
    const remaining: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(SPIKE_STORAGE_PREFIX)) remaining.push(k);
    }
    expect(remaining.length).toBe(MAX_SPIKE_STORAGE_KEYS);
    expect(remaining).not.toContain(`${SPIKE_STORAGE_PREFIX}1`);
    expect(remaining).not.toContain(`${SPIKE_STORAGE_PREFIX}2`);
    expect(remaining).not.toContain(`${SPIKE_STORAGE_PREFIX}3`);
  });

  it("leaves storage untouched when within the limit", () => {
    writeDismissedSpikeProviders(1, ["openai"]);
    writeDismissedSpikeProviders(2, ["anthropic"]);
    pruneStaleSpikeDismissalKeys(MAX_SPIKE_STORAGE_KEYS);
    expect(readDismissedSpikeProviders(1)).toEqual(["openai"]);
    expect(readDismissedSpikeProviders(2)).toEqual(["anthropic"]);
  });
});
