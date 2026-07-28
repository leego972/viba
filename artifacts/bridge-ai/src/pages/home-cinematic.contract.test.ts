import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pagePath = fileURLToPath(new URL("./home-cinematic.tsx", import.meta.url));
const cssPath = fileURLToPath(new URL("./home-cinematic-repo.css", import.meta.url));
const page = readFileSync(pagePath, "utf8");
const css = readFileSync(cssPath, "utf8");

describe("public landing page contract", () => {
  it("keeps the homepage concise instead of restoring the removed long-form sections", () => {
    expect(page).not.toContain("LiveOrchestrationPanel");
    expect(page).not.toContain("viba-signal-strip");
    expect(page).not.toContain("viba-story-grid");
    expect(page.match(/<section/g)?.length ?? 0).toBeLessThanOrEqual(4);
  });

  it("keeps the repository audit as the primary working action", () => {
    expect(page).toContain("/repository-audit?");
    expect(page).toContain("Audit repository");
    expect(page).toContain("viba_pending_repo_audit");
    expect(page).toContain("returnTo=");
  });

  it("keeps the animated orchestration network as the dominant visual", () => {
    expect(page).toContain("<BrainNetwork scene={scene.id} incident={incident} />");
    expect(page).toContain("Choose a failure scenario.");
    expect(page).toContain("onClick={() => selectIncident(index)}");
  });

  it("preserves the promised compact four-stage explanation", () => {
    for (const label of ["Inspect", "Test", "Prioritise", "Decide"]) {
      expect(page).toContain(`<span>${label}</span>`);
    }
  });

  it("puts the visual first on mobile and prevents horizontal page overflow", () => {
    expect(css).toContain(".viba-concise-hero .viba-hero-stage{order:-1");
    expect(css).toContain(".viba-concise-home main{overflow:hidden}");
  });

  it("supports reduced-motion users", () => {
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
  });
});
