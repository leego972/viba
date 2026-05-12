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
import { readFileSync, writeFileSync, existsSync, statSync, openSync, readSync, closeSync } from "fs";
import { join } from "path";

const connectors = new ReplitConnectors();

const OWNER = "leego972";
const REPO = "bridge-ai";
const BRANCH = "main";

/**
 * Binary files larger than this will be skipped with a warning instead of
 * being uploaded. Override via the SYNC_MAX_BINARY_BYTES env var.
 * Default: 10 MB.
 */
const MAX_BINARY_FILE_BYTES =
  parseInt(process.env["SYNC_MAX_BINARY_BYTES"] ?? "", 10) || 10 * 1024 * 1024;

/**
 * Returns true if the first bytes of a file look like binary content.
 * Uses the same heuristic as git: check for a NUL byte in the first 8 000 bytes.
 * Reads only a small chunk so it is safe to call on very large files.
 */
function isBinaryFile(absPath: string): boolean {
  const SAMPLE = 8000;
  const buf = Buffer.allocUnsafe(SAMPLE);
  const fd = openSync(absPath, "r");
  try {
    const bytesRead = readSync(fd, buf, 0, SAMPLE, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    closeSync(fd);
  }
}

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

function exec(cmd: string): string {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

// Resolve git root so file paths from `git diff` work regardless of cwd.
const GIT_ROOT = exec("git rev-parse --show-toplevel");

/**
 * Returns a map of tracked file path → git mode string (e.g. "100644", "100755", "120000").
 * Uses `git ls-files --stage` which lists mode, blob-SHA, stage-number, and filename.
 */
function getFileModes(): Map<string, string> {
  const modes = new Map<string, string>();
  const raw = exec("git ls-files --stage");
  for (const line of raw.split("\n").filter(Boolean)) {
    // Format: <mode> <object> <stage>\t<file>
    const tabIdx = line.indexOf("\t");
    if (tabIdx === -1) continue;
    const file = line.slice(tabIdx + 1);
    const mode = line.slice(0, 6);
    modes.set(file, mode);
  }
  return modes;
}

type TreeItem = {
  path: string;
  mode: string;
  type: string;
  sha: string | null;
};

async function buildTreeItems(fileModes: Map<string, string>): Promise<TreeItem[]> {
  // Use -M to detect renames; output format for renames is: R<score>\t<old>\t<new>
  let rawDiff: string;
  try {
    rawDiff = exec(
      "git diff --name-status -M HEAD~1..HEAD 2>/dev/null || git show --name-status --format='' -M HEAD",
    );
  } catch {
    console.log("[sync-github] No previous commit to diff — nothing to sync.");
    return [];
  }

  // Parse diff lines into a flat list of upserts/deletes.
  // Each entry is { op: "upsert" | "delete", file: string }
  type Op = { op: "upsert" | "delete"; file: string };
  const ops: Op[] = [];

  for (const line of rawDiff.split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    const status = parts[0] ?? "";

    if (status.startsWith("R")) {
      // Rename: R<score>\t<old-path>\t<new-path>
      const oldFile = parts[1] ?? "";
      const newFile = parts[2] ?? "";
      if (oldFile) ops.push({ op: "delete", file: oldFile });
      if (newFile) ops.push({ op: "upsert", file: newFile });
    } else if (status.startsWith("D")) {
      if (parts[1]) ops.push({ op: "delete", file: parts[1] });
    } else {
      // A, M, C (copy), T (type-change)
      if (parts[1]) ops.push({ op: "upsert", file: parts[1] });
    }
  }

  if (ops.length === 0) {
    console.log("[sync-github] No file changes in last commit — nothing to sync.");
    return [];
  }

  console.log(`[sync-github] ${ops.length} file operation(s) found.`);

  const treeItems: TreeItem[] = [];

  for (const { op, file } of ops) {
    if (op === "delete") {
      // sha: null removes the entry from the tree
      treeItems.push({ path: file, mode: "100644", type: "blob", sha: null });
      console.log(`[sync-github]   - deleted: ${file}`);
      continue;
    }

    const absPath = join(GIT_ROOT, file);
    if (!existsSync(absPath)) {
      console.warn(`[sync-github]   ! skipped (not found on disk): ${file}`);
      continue;
    }

    // Preserve git mode (executable bit, symlinks); fall back to 100644 for new files.
    const mode = fileModes.get(file) ?? "100644";
    const type = mode === "120000" ? "blob" : "blob"; // symlinks are still blobs

    // Skip binary files that exceed the size threshold to avoid silent failures.
    // isBinaryFile reads only the first 8 KB so this is cheap even for large files.
    const fileSize = statSync(absPath).size;
    if (fileSize > MAX_BINARY_FILE_BYTES && isBinaryFile(absPath)) {
      const limitMb = (MAX_BINARY_FILE_BYTES / (1024 * 1024)).toFixed(0);
      const sizeMb = (fileSize / (1024 * 1024)).toFixed(1);
      console.warn(
        `[sync-github]   ! skipped binary file exceeding ${limitMb} MB limit (${sizeMb} MB): ${file}`,
      );
      continue;
    }

    // Read once and reuse the buffer for the blob upload below.
    const content = readFileSync(absPath);
    const blob = (await githubApi(`/repos/${OWNER}/${REPO}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: content.toString("base64"), encoding: "base64" }),
    })) as { sha: string };

    treeItems.push({ path: file, mode, type, sha: blob.sha });
    const label = mode === "100755" ? "added (executable)" : "added/modified";
    console.log(`[sync-github]   + ${label}: ${file}`);
  }

  return treeItems;
}

async function main() {
  console.log("[sync-github] Starting sync to leego972/bridge-ai...");

  // --- 1. Get GitHub's current HEAD ---
  let ghRef: { object: { sha: string } };
  try {
    ghRef = (await githubApi(
      `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`,
    )) as typeof ghRef;
  } catch (err) {
    throw new Error(`Could not read GitHub ref: ${(err as Error).message}`);
  }

  const ghHeadSha = ghRef.object.sha;
  console.log(`[sync-github] GitHub HEAD: ${ghHeadSha}`);

  // --- 2. Build tree items from last commit diff ---
  const fileModes = getFileModes();
  const treeItems = await buildTreeItems(fileModes);

  if (treeItems.length === 0) {
    writeSyncStatus({ status: "success", commitSha: ghHeadSha.slice(0, 7), fileCount: 0 });
    return;
  }

  // --- 3. Get the base tree SHA from GitHub HEAD commit ---
  const ghCommit = (await githubApi(
    `/repos/${OWNER}/${REPO}/git/commits/${ghHeadSha}`,
  )) as { tree: { sha: string } };

  // --- 4. Create new tree on top of GitHub's current tree ---
  const newTree = (await githubApi(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: ghCommit.tree.sha, tree: treeItems }),
  })) as { sha: string };

  // --- 5. Build commit message ---
  const localMessage = exec("git log -1 --format='%s'");
  const localSha = exec("git rev-parse --short HEAD");
  const commitMessage = `[Replit sync ${localSha}] ${localMessage}`;

  // --- 6. Create the commit ---
  const newCommit = (await githubApi(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: commitMessage,
      tree: newTree.sha,
      parents: [ghHeadSha],
    }),
  })) as { sha: string };

  // --- 7. Advance the branch ref ---
  await githubApi(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  });

  const successSha = newCommit.sha.slice(0, 7);
  console.log(
    `[sync-github] Done. GitHub ${BRANCH} → ${successSha} (${treeItems.length} file(s))`,
  );

  writeSyncStatus({ status: "success", commitSha: successSha, fileCount: treeItems.length });
}

type SyncStatus =
  | { status: "success"; commitSha: string; fileCount: number }
  | { status: "failed"; error: string };

function writeSyncStatus(status: SyncStatus): void {
  const statusPath = join(GIT_ROOT, "sync-status.json");
  const payload = { ...status, timestamp: new Date().toISOString() };
  try {
    writeFileSync(statusPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  } catch (writeErr) {
    console.warn(`[sync-github] Could not write sync-status.json: ${(writeErr as Error).message}`);
  }
}

async function reportFailureAsGitHubIssue(errorMessage: string): Promise<void> {
  const localSha = (() => {
    try {
      return exec("git rev-parse --short HEAD");
    } catch {
      return "unknown";
    }
  })();

  const title = `[Replit sync] GitHub sync failed after merge (${localSha})`;
  const body = [
    `The automatic GitHub sync failed during post-merge setup.`,
    ``,
    `**Error:**`,
    "```",
    errorMessage,
    "```",
    ``,
    `**Commit:** \`${localSha}\``,
    `**Repo:** https://github.com/${OWNER}/${REPO}`,
    ``,
    `**To retry manually:**`,
    "```bash",
    `pnpm --filter @workspace/scripts run sync-github`,
    "```",
  ].join("\n");

  try {
    await githubApi(`/repos/${OWNER}/${REPO}/issues`, {
      method: "POST",
      body: JSON.stringify({ title, body, labels: ["sync-failure"] }),
    });
    console.error(`[sync-github] Filed GitHub issue: ${title}`);
  } catch (issueErr) {
    console.error(
      `[sync-github] Could not file GitHub issue: ${(issueErr as Error).message}`,
    );
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(async (err) => {
    // Print a prominent banner so sync failures are impossible to miss in post-merge logs,
    // while still exiting 0 so the overall post-merge setup remains non-blocking.
    const msg = (err as Error).message;
    console.error("");
    console.error("╔══════════════════════════════════════════════════════╗");
    console.error("║  GITHUB SYNC FAILED — repo may be out of date       ║");
    console.error("╚══════════════════════════════════════════════════════╝");
    console.error(`  Error: ${msg}`);
    console.error(`  Repo:  https://github.com/${OWNER}/${REPO}`);
    console.error(`  Fix:   run  pnpm --filter @workspace/scripts run sync-github`);
    console.error("");

    writeSyncStatus({ status: "failed", error: msg });

    await reportFailureAsGitHubIssue(msg);

    process.exit(0);
  });
