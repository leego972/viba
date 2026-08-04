import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceManifest } from "./architectureGraphStore";

interface PackageJsonShape {
  name?: unknown;
  private?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
}

function dependencyMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

async function findPackageJsonFiles(root: string, maxDepth: number): Promise<string[]> {
  const found: string[] = [];

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
      found.push(path.join(directory, "package.json"));
      return;
    }

    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
      .map((entry) => walk(path.join(directory, entry.name), depth + 1)));
  }

  await walk(root, 0);
  return found;
}

export async function discoverWorkspaceManifests(input?: {
  repositoryRoot?: string;
  roots?: string[];
  maxDepth?: number;
}): Promise<WorkspaceManifest[]> {
  const repositoryRoot = path.resolve(input?.repositoryRoot ?? process.cwd());
  const roots = input?.roots ?? ["artifacts", "lib", "scripts"];
  const maxDepth = input?.maxDepth ?? 3;
  const manifestFiles = (await Promise.all(
    roots.map((root) => findPackageJsonFiles(path.join(repositoryRoot, root), maxDepth)),
  )).flat();

  const manifests: WorkspaceManifest[] = [];
  for (const manifestFile of manifestFiles) {
    let parsed: PackageJsonShape;
    try {
      parsed = JSON.parse(await readFile(manifestFile, "utf8")) as PackageJsonShape;
    } catch {
      continue;
    }
    if (typeof parsed.name !== "string" || parsed.name.trim().length === 0) continue;
    manifests.push({
      name: parsed.name,
      path: path.relative(repositoryRoot, path.dirname(manifestFile)).replace(/\\/g, "/"),
      private: parsed.private === true,
      dependencies: dependencyMap(parsed.dependencies),
      devDependencies: dependencyMap(parsed.devDependencies),
      peerDependencies: dependencyMap(parsed.peerDependencies),
    });
  }

  return manifests.sort((left, right) => left.path.localeCompare(right.path));
}
