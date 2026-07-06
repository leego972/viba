import fs from "fs";
import path from "path";
import type { FrameworkDetectionResult, FrameworkKind, PackageManager } from "./deploy.types";

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(dir: string): PackageJson | null {
  try {
    const raw = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    return JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }
}

function fileExists(dir: string, ...parts: string[]): boolean {
  return fs.existsSync(path.join(dir, ...parts));
}

export function detectPackageManager(dir: string): PackageManager {
  if (fileExists(dir, "bun.lockb")) return "bun";
  if (fileExists(dir, "pnpm-lock.yaml")) return "pnpm";
  if (fileExists(dir, "yarn.lock")) return "yarn";
  return "npm";
}

export function detectLockfile(dir: string): string | null {
  const lockfiles = ["bun.lockb", "pnpm-lock.yaml", "yarn.lock", "package-lock.json"];
  for (const f of lockfiles) {
    if (fileExists(dir, f)) return f;
  }
  return null;
}

export function detectFramework(dir: string, pkg: PackageJson): FrameworkKind {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps["next"]) return "nextjs";
  if (deps["nuxt"] || deps["nuxt3"]) return "nuxt";
  if (deps["@remix-run/react"] || deps["@remix-run/node"]) return "remix";
  if (deps["astro"]) return "astro";
  if (deps["@sveltejs/kit"]) return "sveltekit";
  if (deps["@nestjs/core"]) return "nestjs";
  if (deps["fastify"]) return "fastify";
  if (deps["express"]) return "express";
  if (deps["vite"] || deps["@vitejs/plugin-react"]) return "vite";
  if (!fileExists(dir, "package.json")) return "static";
  return "unknown";
}

function getInstallCmd(pm: PackageManager): string {
  switch (pm) {
    case "bun": return "bun install";
    case "pnpm": return "pnpm install --frozen-lockfile";
    case "yarn": return "yarn install --frozen-lockfile";
    default: return "npm ci";
  }
}

function getRunPrefix(pm: PackageManager): string {
  switch (pm) {
    case "bun": return "bun run";
    case "pnpm": return "pnpm run";
    case "yarn": return "yarn";
    default: return "npm run";
  }
}

export function inferBuildStart(
  framework: FrameworkKind,
  pkg: PackageJson,
  pm: PackageManager,
): { build: string; start: string; port: number } {
  const run = getRunPrefix(pm);
  const scripts = pkg.scripts ?? {};

  if (scripts["build"] && scripts["start"]) {
    return { build: `${run} build`, start: `${run} start`, port: 3000 };
  }

  switch (framework) {
    case "nextjs":
      return { build: `${run} build`, start: `${run} start`, port: 3000 };
    case "nuxt":
      return { build: `${run} build`, start: `${run} preview`, port: 3000 };
    case "remix":
      return { build: `${run} build`, start: `${run} start`, port: 3000 };
    case "astro":
      return { build: `${run} build`, start: `${run} preview`, port: 4321 };
    case "sveltekit":
      return { build: `${run} build`, start: "node build/index.js", port: 3000 };
    case "nestjs":
      return { build: `${run} build`, start: "node dist/main.js", port: 3000 };
    case "fastify":
    case "express":
      return { build: scripts["build"] ? `${run} build` : "echo 'no build'", start: scripts["start"] ? `${run} start` : "node index.js", port: 3000 };
    case "vite":
      return { build: `${run} build`, start: `npx serve dist`, port: 4173 };
    case "static":
      return { build: "echo 'static site'", start: "npx serve .", port: 80 };
    default:
      return { build: `${run} build`, start: `${run} start`, port: 3000 };
  }
}

export function detectProject(dir: string): FrameworkDetectionResult {
  const pm = detectPackageManager(dir);
  const pkg = readPackageJson(dir) ?? {};
  const framework = detectFramework(dir, pkg);
  const lockfile = detectLockfile(dir);
  const { build, start, port } = inferBuildStart(framework, pkg, pm);
  const hasDockerfile = fileExists(dir, "Dockerfile") || fileExists(dir, "dockerfile");

  return {
    framework,
    packageManager: pm,
    buildCommand: build,
    startCommand: start,
    installCommand: getInstallCmd(pm),
    port,
    hasDockerfile,
    detectedLockfile: lockfile,
  };
}
