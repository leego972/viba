import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(process.cwd(), "src");
const APP_PATH = path.join(SRC_ROOT, "App.tsx");
const NAVBAR_PATH = path.join(SRC_ROOT, "components", "layout", "Navbar.tsx");
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

function jsxTagName(name: ts.JsxTagNameExpression): string {
  return name.getText().replace(/\s+/g, "");
}

function hasAttribute(attributes: ts.JsxAttributes, names: string[]): boolean {
  return attributes.properties.some(
    (property) => ts.isJsxAttribute(property) && names.includes(property.name.text),
  );
}

function hasActionableAncestor(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      const name = jsxTagName(current.openingElement.tagName);
      if (name === "Link" || name === "form" || name.endsWith("Trigger")) return true;
    }
    current = current.parent;
  }
  return false;
}

function buttonType(attributes: ts.JsxAttributes): string | null {
  for (const property of attributes.properties) {
    if (!ts.isJsxAttribute(property) || property.name.text !== "type") continue;
    if (property.initializer && ts.isStringLiteral(property.initializer)) return property.initializer.text;
  }
  return null;
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

  it("contains no inert native buttons in operational pages and components", () => {
    const files = listTsxFiles(SRC_ROOT).filter((filePath) =>
      !filePath.includes(`${path.sep}components${path.sep}ui${path.sep}`),
    );
    const violations: string[] = [];

    for (const filePath of files) {
      const sourceText = read(filePath);
      const sourceFile = ts.createSourceFile(
        filePath,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );

      const inspect = (node: ts.Node) => {
        if (ts.isJsxElement(node) && jsxTagName(node.openingElement.tagName) === "button") {
          const attributes = node.openingElement.attributes;
          const type = buttonType(attributes);
          const actionable =
            hasAttribute(attributes, ["onClick", "onMouseDown", "onPointerDown", "formAction"]) ||
            type === "submit" ||
            type === "reset" ||
            hasActionableAncestor(node);
          if (!actionable) {
            const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            violations.push(`${path.relative(SRC_ROOT, filePath)}:${position.line + 1}`);
          }
        }
        ts.forEachChild(node, inspect);
      };
      inspect(sourceFile);
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

  it("keeps every static navigation destination connected to an application route", () => {
    const appSource = read(APP_PATH);
    const navbarSource = read(NAVBAR_PATH);
    const appRoutes = new Set(
      [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]),
    );
    const navRoutes = new Set([
      ...[...navbarSource.matchAll(/href:\s*"([^"]+)"/g)].map((match) => match[1]),
      ...[...navbarSource.matchAll(/<Link\s+href="([^"]+)"/g)].map((match) => match[1]),
    ]);

    const missing = [...navRoutes].filter((route) => !appRoutes.has(route));
    expect(missing).toEqual([]);
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
