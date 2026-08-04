import { describe, expect, it } from "vitest";
import { formatEngineeringMemoryBrief } from "./engineeringMemoryIntegration";

describe("formatEngineeringMemoryBrief", () => {
  it("orders ADRs before patterns and lessons and respects the limit", () => {
    const brief = formatEngineeringMemoryBrief({
      decisions: [
        { title: "Use shared reservations", decision: "Enforce path ownership" },
        { title: "Keep contracts versioned", decision: "Create immutable revisions" },
      ],
      patterns: [{ title: "Repository boundary", decision: "Use governed wrappers" }],
      lessons: [{ title: "Stalled execution", decision: "Reassign after timeout" }],
    }, 3);

    expect(brief).toContain("[ENGINEERING MEMORY]");
    expect(brief).toContain("ADR: Use shared reservations");
    expect(brief).toContain("ADR: Keep contracts versioned");
    expect(brief).toContain("PATTERN: Repository boundary");
    expect(brief).not.toContain("LESSON: Stalled execution");
  });

  it("returns an empty string when no relevant records exist", () => {
    expect(formatEngineeringMemoryBrief({ decisions: [], patterns: [], lessons: [] })).toBe("");
  });

  it("normalizes whitespace and bounds individual entries", () => {
    const brief = formatEngineeringMemoryBrief({
      decisions: [{ title: "A   spaced\n title", decision: "x".repeat(400) }],
      patterns: [],
      lessons: [],
    });

    expect(brief).toContain("ADR: A spaced title");
    expect(brief.length).toBeLessThan(400);
    expect(brief).toContain("…");
  });
});
