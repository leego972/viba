/**
 * sync-github.ts
 *
 * Syncs workspace changes from the last git commit to the leego972/bridge-ai
 * GitHub repository using the GitHub Git Trees API via Replit's connector proxy.
 *
 * Runs automatically as part of the post-merge setup script.
 * Uses the GitHub integration (conn_github_01KPYJ4GV6ST0QVNPFD2DDNTZ5) which
 * has `repo` scope — no additional secrets required.
 */

import { ReplitConnectors } from "@replit/connectors-sdk";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const connectors = new ReplitConnectors();

const OWNER = "leego972";
const REPO = "bridge-ai";
const BRANCH = "main";

async function githubApi(path: string, options: RequestInit = {}): Promise<unknown> {
  const response = await connectors.proxy("github", path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub API ${options.method ?? "GET"} ${path} → ${response.status}: ${text}`,
    );
  }

  return response.json();
}

function exec(cmd: string, cwd?: string): string {
  return execSync(cmd, { encoding: "utf8", cwd }).trim();
}

// Resolve git root so file paths from `git diff` work regardless of cwd.
const GIT_ROOT = exec("git rev-parse --show-toplevel");

async function main() {
  console.log("[sync-github] Starting sync to leego972/bridge-ai...");

  // --- 1. Get GitHub's current HEAD ---
  let ghRef: { object: { sha: string } };
  try {
    ghRef = (await githubApi(
      `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`,
    )) as typeof ghRef;
  } catch (err) {
    console.error("[sync-github] Could not read GitHub ref:", (err as Error).message);
    process.exit(1);
  }

  const ghHeadSha = ghRef.object.sha;
  console.log(`[sync-github] GitHub HEAD: ${ghHeadSha}`);

  // --- 2. Get files changed in the last local commit ---
  let rawDiff: string;
  try {
    // Works for any commit after the first; falls back for an initial commit.
    rawDiff = exec("git diff --name-status HEAD~1..HEAD 2>/dev/null || git show --name-status --format='' HEAD");
  } catch {
    console.log("[sync-github] No previous commit to diff — nothing to sync.");
    return;
  }

  type Change = { status: string; file: string };
  const changes: Change[] = rawDiff
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split("\t");
      return { status: status ?? "", file: file ?? "" };
    })
    .filter((c) => c.file);

  if (changes.length === 0) {
    console.log("[sync-github] No file changes in last commit — nothing to sync.");
    return;
  }

  console.log(`[sync-github] ${changes.length} file(s) changed.`);

  // --- 3. Build tree items ---
  const treeItems: Array<{
    path: string;
    mode: string;
    type: string;
    sha: string | null;
  }> = [];

  for (const { status, file } of changes) {
    if (status.startsWith("D")) {
      // Deleted — set sha to null to remove from tree
      treeItems.push({ path: file, mode: "100644", type: "blob", sha: null });
      console.log(`[sync-github]   - deleted: ${file}`);
    } else if (existsSync(join(GIT_ROOT, file))) {
      const content = readFileSync(join(GIT_ROOT, file));
      const blob = (await githubApi(`/repos/${OWNER}/${REPO}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({
          content: content.toString("base64"),
          encoding: "base64",
        }),
      })) as { sha: string };

      treeItems.push({ path: file, mode: "100644", type: "blob", sha: blob.sha });
      console.log(`[sync-github]   + ${status.startsWith("A") ? "added" : "modified"}: ${file}`);
    }
  }

  if (treeItems.length === 0) {
    console.log("[sync-github] No actionable file changes — skipping tree creation.");
    return;
  }

  // --- 4. Get the base tree SHA from GitHub HEAD commit ---
  const ghCommit = (await githubApi(
    `/repos/${OWNER}/${REPO}/git/commits/${ghHeadSha}`,
  )) as { tree: { sha: string } };

  // --- 5. Create new tree on top of GitHub's current tree ---
  const newTree = (await githubApi(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: ghCommit.tree.sha, tree: treeItems }),
  })) as { sha: string };

  // --- 6. Build commit message ---
  const localMessage = exec("git log -1 --format='%s'");
  const localSha = exec("git rev-parse --short HEAD");
  const commitMessage = `[Replit sync ${localSha}] ${localMessage}`;

  // --- 7. Create the commit ---
  const newCommit = (await githubApi(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: commitMessage,
      tree: newTree.sha,
      parents: [ghHeadSha],
    }),
  })) as { sha: string };

  // --- 8. Advance the branch ref ---
  await githubApi(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  });

  console.log(
    `[sync-github] Done. GitHub ${BRANCH} → ${newCommit.sha.slice(0, 7)} (${treeItems.length} file(s))`,
  );
}

main().catch((err) => {
  console.error("[sync-github] Sync failed:", (err as Error).message);
  // Exit 0 so a sync failure does not break the entire post-merge setup.
  // The error is logged above and visible in the post-merge output.
  process.exit(0);
});
