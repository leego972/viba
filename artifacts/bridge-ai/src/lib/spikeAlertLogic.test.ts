import { describe, it, expect, beforeEach } from "vitest";
import {
  computeUndismissedProviders,
  computeShowSpikeAlert,
  readDismissedSpikeProviders,
  writeDismissedSpikeProviders,
  SPIKE_STORAGE_PREFIX,
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

describe("readDismissedSpikeProviders / writeDismissedSpikeProviders", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns an empty array when nothing has been stored", () => {
    expect(readDismissedSpikeProviders(1)).toEqual([]);
  });

  it("returns the stored providers after writing them", () => {
    writeDismissedSpikeProviders(42, ["openai", "anthropic"]);
    expect(readDismissedSpikeProviders(42)).toEqual(["openai", "anthropic"]);
  });

  it("stores under the correct sessionStorage key", () => {
    writeDismissedSpikeProviders(7, ["cohere"]);
    const raw = sessionStorage.getItem(`${SPIKE_STORAGE_PREFIX}7`);
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
});
