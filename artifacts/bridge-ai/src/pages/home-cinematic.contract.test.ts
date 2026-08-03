import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const readSibling = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
const page = readSibling("./home-cinematic.tsx");
const conciseCss = readSibling("./home-cinematic-repo.css");
const motionCss = readSibling("./home-cinematic-live.css");

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

  it("keeps the real Adobe execution brain as the dominant visual", () => {
    expect(page).toContain('import AdobeExecutionBrain from "@/components/AdobeExecutionBrain"');
    expect(page).toContain('<AdobeExecutionBrain phase="idle" className="viba-network" />');
    expect(page).not.toContain("LANDING PAGE DEMO");
    expect(page).not.toContain("const DEMO_INCIDENT");
    expect(page).not.toContain("Choose a failure scenario.");
    expect(page).not.toContain("selectIncident");
  });

  it("preserves the promised compact four-stage explanation", () => {
    for (const label of ["Inspect", "Test", "Prioritise", "Decide"]) {
      expect(page).toContain(`<span>${label}</span>`);
    }
  });

  it("puts the visual first on mobile and prevents horizontal page overflow", () => {
    expect(conciseCss).toContain(".viba-concise-hero .viba-hero-stage{order:-1");
    expect(conciseCss).toContain(".viba-concise-home main{overflow:hidden}");
  });

  it("retains reduced-motion handling in the imported landing-page styles", () => {
    expect(motionCss).toContain("@media(prefers-reduced-motion:reduce)");
  });
});
