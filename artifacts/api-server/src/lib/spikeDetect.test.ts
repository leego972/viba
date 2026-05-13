import { describe, it, expect } from "vitest";
import { detectSpikeProviders } from "./spikeDetect";

describe("detectSpikeProviders", () => {
  it("returns empty array when no providers exceed threshold", () => {
    const counts = [
      { provider: "openai", count: 2 },
      { provider: "anthropic", count: 1 },
    ];
    expect(detectSpikeProviders(counts, 5)).toEqual([]);
  });

  it("returns providers that meet or exceed the threshold", () => {
    const counts = [
      { provider: "openai", count: 6 },
      { provider: "anthropic", count: 5 },
      { provider: "google", count: 2 },
    ];
    const result = detectSpikeProviders(counts, 5);
    expect(result).toContain("openai");
    expect(result).toContain("anthropic");
    expect(result).not.toContain("google");
  });

  it("returns all providers when all exceed threshold", () => {
    const counts = [
      { provider: "openai", count: 10 },
      { provider: "perplexity", count: 7 },
    ];
    expect(detectSpikeProviders(counts, 5)).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(detectSpikeProviders([], 5)).toEqual([]);
  });

  it("handles threshold of 1", () => {
    const counts = [
      { provider: "openai", count: 1 },
      { provider: "anthropic", count: 0 },
    ];
    const result = detectSpikeProviders(counts, 1);
    expect(result).toEqual(["openai"]);
  });

  it("ignores providers with zero count", () => {
    const counts = [{ provider: "manus", count: 0 }];
    expect(detectSpikeProviders(counts, 1)).toEqual([]);
  });
});
