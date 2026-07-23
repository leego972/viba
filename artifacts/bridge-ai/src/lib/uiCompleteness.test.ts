import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(process.cwd(), "src");
const APP_PATH = path.join(SRC_ROOT, "App.tsx");
const COMPLETION_PAGE_PATH = path.join(SRC_ROOT, "pages", "market-completion.tsx");
const ORCHESTRATION_PATH = path.join(SRC_ROOT, "components", "orchestration", "OrchestrationCanvas.tsx");

function listTsxFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTsxFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [fullPath] : [];
  });
}

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

describe("VIBA UI completeness contract", () => {
  it("contains no user-facing coming-soon or dead-click patterns in operational UI", () => {
    const excluded = new Set([
      path.join(SRC_ROOT, "pages", "privacy.tsx"),
      path.join(SRC_ROOT, "pages", "terms.tsx"),
    ]);
    const operationalFiles = listTsxFiles(SRC_ROOT).filter((filePath) => !excluded.has(filePath));
    const violations: string[] = [];
    const forbidden = [
      /coming\s+soon/i,
      /under\s+construction/i,
      /feature\s+not\s+implemented/i,
      /href\s*=\s*["']#["']/i,
      /onClick\s*=\s*\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/i,
      /onClick\s*=\s*\{\s*undefined\s*\}/i,
    ];

    for (const filePath of operationalFiles) {
      const source = read(filePath);
      for (const pattern of forbidden) {
        if (pattern.test(source)) {
          violations.push(`${path.relative(SRC_ROOT, filePath)} matched ${pattern}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("maps every shared completion route to a real route description and widget", () => {
    const appSource = read(APP_PATH);
    const completionSource = read(COMPLETION_PAGE_PATH);
    const completionRoutes = [...appSource.matchAll(/<Route\s+path="([^"]+)"\s+component=\{CompletionPage\}/g)]
      .map((match) => match[1]);

    expect(completionRoutes.length).toBeGreaterThan(0);
    for (const route of completionRoutes) {
      expect(completionSource).toContain(`"${route}":`);
      expect(completionSource).toContain(`ROUTE_WIDGETS["${route}"] =`);
    }
  });

  it("keeps the collaboration viewer truthful, motion-safe and event-driven", () => {
    const source = read(ORCHESTRATION_PATH);
    expect(source).toContain("vm.isDemo ? [] : vm.agents");
    expect(source).toContain("useReducedMotion");
    expect(source).toContain("visibilitychange");
    expect(source).toContain("latestEvent");
    expect(source).toContain("activeAgents");
    expect(source).not.toContain("Math.random");
    expect(source).not.toContain("fake");
  });
});
