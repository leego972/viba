import { describe, expect, it } from "vitest";
import { rankEngineeringMemory } from "./engineeringMemory";

const records = [
  {
    title: "Redis-backed rate limiting",
    decision: "Use Redis for shared counters",
    rationale: "Multiple API instances need consistent limits",
    affectedModules: ["api", "deployment"],
    affectedInterfaces: ["RateLimitPolicy"],
  },
  {
    title: "Local cache for editor previews",
    decision: "Use process memory",
    rationale: "Preview state is disposable and instance-local",
    affectedModules: ["editor"],
    affectedInterfaces: ["PreviewCache"],
  },
];

describe("engineering memory ranking", () => {
  it("prioritises exact interface and module matches", () => {
    const result = rankEngineeringMemory(records, {
      modules: ["api"],
      interfaces: ["RateLimitPolicy"],
    });
    expect(result[0]?.title).toBe("Redis-backed rate limiting");
  });

  it("retrieves decisions by rationale and decision text", () => {
    const result = rankEngineeringMemory(records, { text: "shared counters" });
    expect(result.map((record) => record.title)).toEqual(["Redis-backed rate limiting"]);
  });

  it("returns stable insertion order when no filters are supplied", () => {
    expect(rankEngineeringMemory(records, {})).toEqual(records);
  });

  it("honours result limits", () => {
    expect(rankEngineeringMemory(records, { limit: 1 })).toHaveLength(1);
  });
});
