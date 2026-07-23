import { describe, expect, it } from "vitest";
import { buildOrchestrationLayout } from "./orchestrationLayout";

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("buildOrchestrationLayout", () => {
  const cases = [
    { width: 320, height: 560, mobile: true },
    { width: 390, height: 620, mobile: true },
    { width: 768, height: 560, mobile: false },
    { width: 1200, height: 620, mobile: false },
  ];

  for (const viewport of cases) {
    for (const count of [1, 2, 4, 6, 8, 10, 12]) {
      it(`keeps ${count} agents inside ${viewport.width}px viewport`, () => {
        const layout = buildOrchestrationLayout({
          ...viewport,
          count,
          detailsOpen: false,
        });

        expect(layout.points).toHaveLength(count);
        for (const point of layout.points) {
          expect(point.x).toBeGreaterThanOrEqual(42);
          expect(point.x).toBeLessThanOrEqual(viewport.width - 42);
          expect(point.y).toBeGreaterThanOrEqual(64);
          expect(point.y).toBeLessThanOrEqual(viewport.height - 70);
        }
      });
    }
  }

  it("uses a second ring when a single ring would become crowded", () => {
    const layout = buildOrchestrationLayout({
      width: 390,
      height: 620,
      count: 12,
      mobile: true,
      detailsOpen: false,
    });
    expect(new Set(layout.points.map((point) => point.ring)).size).toBe(2);
  });

  it("reserves vertical room for the selected-agent details panel", () => {
    const closed = buildOrchestrationLayout({
      width: 768,
      height: 620,
      count: 8,
      mobile: false,
      detailsOpen: false,
    });
    const open = buildOrchestrationLayout({
      width: 768,
      height: 620,
      count: 8,
      mobile: false,
      detailsOpen: true,
    });
    expect(open.centerY).toBeLessThan(closed.centerY);
  });

  it("maintains practical separation for the common eight-agent desktop view", () => {
    const layout = buildOrchestrationLayout({
      width: 1000,
      height: 620,
      count: 8,
      mobile: false,
      detailsOpen: false,
    });
    const pairDistances = layout.points.flatMap((point, index) =>
      layout.points.slice(index + 1).map((other) => distance(point, other)),
    );
    expect(Math.min(...pairDistances)).toBeGreaterThan(96);
  });
});
