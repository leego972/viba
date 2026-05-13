import { describe, it, expect } from "vitest";
import { classifyModelRows } from "../routes/stats";

describe("classifyModelRows", () => {
  it("labels non-simulated rows as live", () => {
    const result = classifyModelRows([
      { model: "gpt-4o", provider: "openai", simulated: false, count: 10 },
    ]);
    expect(result).toEqual([{ model: "gpt-4o", provider: "openai", mode: "live", count: 10 }]);
  });

  it("labels simulated rows correctly", () => {
    const result = classifyModelRows([
      { model: "gpt-4o", provider: "openai", simulated: true, count: 3 },
    ]);
    expect(result).toEqual([{ model: "gpt-4o", provider: "openai", mode: "simulated", count: 3 }]);
  });

  it("handles a mix of live and simulated rows for the same model", () => {
    const result = classifyModelRows([
      { model: "claude-3-5-sonnet-20241022", provider: "anthropic", simulated: false, count: 8 },
      { model: "claude-3-5-sonnet-20241022", provider: "anthropic", simulated: true, count: 2 },
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.mode === "live")?.count).toBe(8);
    expect(result.find((r) => r.mode === "simulated")?.count).toBe(2);
  });

  it("filters out rows with null model", () => {
    const result = classifyModelRows([
      { model: null, provider: "openai", simulated: false, count: 5 },
      { model: "gpt-4o", provider: "openai", simulated: false, count: 2 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("gpt-4o");
  });

  it("filters out rows with null provider", () => {
    const result = classifyModelRows([
      { model: "gpt-4o", provider: null, simulated: false, count: 5 },
    ]);
    expect(result).toHaveLength(0);
  });

  it("handles multiple providers correctly", () => {
    const result = classifyModelRows([
      { model: "gpt-4o", provider: "openai", simulated: false, count: 7 },
      { model: "claude-3-5-sonnet-20241022", provider: "anthropic", simulated: false, count: 4 },
      { model: "gemini-pro", provider: "gemini", simulated: true, count: 1 },
    ]);
    expect(result).toHaveLength(3);
    const providers = result.map((r) => r.provider);
    expect(providers).toContain("openai");
    expect(providers).toContain("anthropic");
    expect(providers).toContain("gemini");
  });

  it("returns empty array for empty input", () => {
    expect(classifyModelRows([])).toEqual([]);
  });
});
