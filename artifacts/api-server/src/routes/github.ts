import { Router, type IRouter } from "express";
import { getVibaCredential } from "../lib/vibaVault";
import { ensureGithubStoredProject, mirrorGithubFileCommit } from "../lib/githubProjectMirror";

const router: IRouter = Router();

interface GithubApiRepo {
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
  owner?: { login?: string };
  name?: string;
}

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" && req.session.userId > 0 ? req.session.userId : null;
}

async function resolveGithubToken(uid: number): Promise<string | null> {
  return await getVibaCredential({ userId: uid, provider: "github", kind: "api_key", label: "default" });
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "VIBA-App/1.0",
    "Content-Type": "application/json",
  };
}

function ghError(status: number): number {
  if (status === 404) return 404;
  if (status === 409) return 409;
  if (status === 422) return 422;
  if (status >= 500) return 502;
  return 401;
}

function encodeRepoPath(value: string): string {
  return value.replace(/\\/g, "/").split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function validRepoPart(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(value);
}

async function context(req: { session?: { userId?: number } }, res: { status: (code: number) => { json: (body: unknown) => void } }): Promise<{ uid: number; token: string } | null> {
  const uid = userId(req);
  if (!uid) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  const token = await resolveGithubToken(uid);
  if (!token) {
    res.status(409).json({ error: "Connect your GitHub token in the encrypted VIBA Vault first." });
    return null;
  }
  return { uid, token };
}

router.get("/github/repo", async (req, res): Promise<void> => {
  const { owner, repo } = req.query as { owner?: string; repo?: string };
  if (!owner || !repo || !validRepoPart(owner) || !validRepoPart(repo)) {
    res.status(400).json({ error: "valid owner and repo are required" }); return;
  }
  const auth = await context(req, res); if (!auth) return;
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: ghHeaders(auth.token) });
  if (!response.ok) { res.status(ghError(response.status)).json({ error: `GitHub API error: ${response.status}` }); return; }
  const data = await response.json() as GithubApiRepo;
  res.json({ fullName: data.full_name, htmlUrl: data.html_url, defaultBranch: data.default_branch, private: data.private });
});

router.get("/github/repos", async (req, res): Promise<void> => {
  const auth = await context(req, res); if (!auth) return;
  const response = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator", { headers: ghHeaders(auth.token) });
  if (!response.ok) { res.status(ghError(response.status)).json({ error: `GitHub API error: ${response.status}` }); return; }
  const data = await response.json() as GithubApiRepo[];
  res.json(data.map((repo) => ({ fullName: repo.full_name, htmlUrl: repo.html_url, defaultBranch: repo.default_branch, private: repo.private })));
});

router.post("/github/repos", async (req, res): Promise<void> => {
  const auth = await context(req, res); if (!auth) return;
  const body = req.body as { name?: string; description?: string; private?: boolean; autoInit?: boolean; confirmed?: boolean };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!validRepoPart(name)) { res.status(400).json({ error: "A valid repository name is required" }); return; }
  if (body.confirmed !== true) { res.status(400).json({ error: "Repository creation requires confirmed=true" }); return; }

  const response = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: ghHeaders(auth.token),
    body: JSON.stringify({ name, description: body.description ?? "", private: body.private !== false, auto_init: body.autoInit !== false }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    res.status(ghError(response.status)).json({ error: `GitHub rejected repository creation (HTTP ${response.status})`, detail: detail.slice(0, 500) });
    return;
  }
  const data = await response.json() as GithubApiRepo;
  const [owner, repo] = data.full_name.split("/");
  const storedProject = owner && repo
    ? await ensureGithubStoredProject({ userId: auth.uid, owner, repo, description: body.description })
    : null;
  res.status(201).json({ fullName: data.full_name, htmlUrl: data.html_url, defaultBranch: data.default_branch, private: data.private, storedProject });
});

router.get("/github/file", async (req, res): Promise<void> => {
  const { owner, repo, path: filePath, ref } = req.query as Record<string, string | undefined>;
  if (!owner || !repo || !filePath || !validRepoPart(owner) || !validRepoPart(repo)) {
    res.status(400).json({ error: "valid owner, repo, and path are required" }); return;
  }
  const auth = await context(req, res); if (!auth) return;
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeRepoPath(filePath)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
  const response = await fetch(url, { headers: ghHeaders(auth.token) });
  if (!response.ok) { res.status(ghError(response.status)).json({ error: `GitHub API error: ${response.status}` }); return; }
  const data = await response.json() as { content?: string; encoding?: string; sha?: string; name?: string; size?: number };
  const content = data.encoding === "base64" && data.content ? Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8") : data.content ?? "";
  res.json({ path: filePath, content, sha: data.sha, size: data.size, name: data.name });
});

router.get("/github/tree", async (req, res): Promise<void> => {
  const { owner, repo, ref, path: treePath = "" } = req.query as Record<string, string | undefined>;
  if (!owner || !repo || !validRepoPart(owner) || !validRepoPart(repo)) {
    res.status(400).json({ error: "valid owner and repo are required" }); return;
  }
  const auth = await context(req, res); if (!auth) return;
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeRepoPath(treePath)}?ref=${encodeURIComponent(ref ?? "HEAD")}`;
  const response = await fetch(url, { headers: ghHeaders(auth.token) });
  if (!response.ok) { res.status(ghError(response.status)).json({ error: `GitHub API error: ${response.status}` }); return; }
  const data = await response.json() as Array<{ name: string; path: string; type: string; size: number; sha: string }>;
  res.json(Array.isArray(data) ? data.map((file) => ({ name: file.name, path: file.path, type: file.type, size: file.size, sha: file.sha })) : []);
});

router.post("/github/branch", async (req, res): Promise<void> => {
  const auth = await context(req, res); if (!auth) return;
  const body = req.body as { owner?: string; repo?: string; branch?: string; fromRef?: string };
  const { owner, repo, branch, fromRef = "HEAD" } = body;
  if (!owner || !repo || !branch || !validRepoPart(owner) || !validRepoPart(repo) || !/^[A-Za-z0-9._\/-]{1,200}$/.test(branch)) {
    res.status(400).json({ error: "valid owner, repo, and branch are required" }); return;
  }
  const refResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(fromRef)}`, { headers: ghHeaders(auth.token) });
  let sha = fromRef;
  if (refResponse.ok) {
    const refData = await refResponse.json() as { object?: { sha?: string } };
    sha = refData.object?.sha ?? "";
  }
  if (!sha) { res.status(400).json({ error: "Could not resolve fromRef" }); return; }
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`, {
    method: "POST", headers: ghHeaders(auth.token), body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (!response.ok) {
    const error = await response.json() as { message?: string };
    res.status(ghError(response.status)).json({ error: error.message ?? `GitHub API error: ${response.status}` }); return;
  }
  await ensureGithubStoredProject({ userId: auth.uid, owner, repo });
  res.json({ branch, sha, created: true });
});

router.put("/github/file", async (req, res): Promise<void> => {
  const auth = await context(req, res); if (!auth) return;
  const body = req.body as { owner?: string; repo?: string; path?: string; content?: string; message?: string; branch?: string; sha?: string };
  const { owner, repo, path: filePath, content, message, branch, sha } = body;
  if (!owner || !repo || !filePath || content === undefined || !message || !validRepoPart(owner) || !validRepoPart(repo)) {
    res.status(400).json({ error: "valid owner, repo, path, content, and message are required" }); return;
  }
  await ensureGithubStoredProject({ userId: auth.uid, owner, repo });
  const payload: Record<string, unknown> = { message: message.slice(0, 500), content: Buffer.from(content, "utf8").toString("base64") };
  if (branch) payload.branch = branch;
  if (sha) payload.sha = sha;
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeRepoPath(filePath)}`, {
    method: "PUT", headers: ghHeaders(auth.token), body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json() as { message?: string };
    res.status(ghError(response.status)).json({ error: error.message ?? `GitHub API error: ${response.status}` }); return;
  }
  const data = await response.json() as { commit?: { sha?: string }; content?: { sha?: string } };
  try {
    const stored = await mirrorGithubFileCommit({
      userId: auth.uid, owner, repo, filePath, content, message, branch, commitSha: data.commit?.sha,
    });
    res.json({ path: filePath, commitSha: data.commit?.sha, fileSha: data.content?.sha, stored });
  } catch (error) {
    req.log?.error?.({ error, owner, repo, filePath, commitSha: data.commit?.sha }, "GitHub commit succeeded but persistent project mirror failed");
    res.status(500).json({
      error: "GitHub commit succeeded, but VIBA could not persist its required project copy.",
      commitSha: data.commit?.sha,
      fileSha: data.content?.sha,
      storagePersisted: false,
    });
  }
});

router.post("/github/pr", async (req, res): Promise<void> => {
  const auth = await context(req, res); if (!auth) return;
  const body = req.body as { owner?: string; repo?: string; title?: string; body?: string; head?: string; base?: string };
  const { owner, repo, title, head, base } = body;
  if (!owner || !repo || !title || !head || !base || !validRepoPart(owner) || !validRepoPart(repo)) {
    res.status(400).json({ error: "valid owner, repo, title, head, and base are required" }); return;
  }
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
    method: "POST", headers: ghHeaders(auth.token), body: JSON.stringify({ title, body: body.body ?? "", head, base }),
  });
  if (!response.ok) {
    const error = await response.json() as { message?: string };
    res.status(ghError(response.status)).json({ error: error.message ?? `GitHub API error: ${response.status}` }); return;
  }
  const data = await response.json() as { number?: number; html_url?: string; state?: string };
  res.json({ number: data.number, url: data.html_url, state: data.state });
});

router.post("/github/pr/merge", async (req, res): Promise<void> => {
  const auth = await context(req, res); if (!auth) return;
  const body = req.body as { owner?: string; repo?: string; pullNumber?: number; commitTitle?: string; mergeMethod?: string; confirmed?: boolean };
  const { owner, repo, pullNumber, commitTitle, mergeMethod = "merge" } = body;
  if (!owner || !repo || !pullNumber || !validRepoPart(owner) || !validRepoPart(repo)) {
    res.status(400).json({ error: "valid owner, repo, and pullNumber are required" }); return;
  }
  if (body.confirmed !== true) { res.status(400).json({ error: "Pull-request merge requires confirmed=true" }); return; }
  if (!new Set(["merge", "squash", "rebase"]).has(mergeMethod)) { res.status(400).json({ error: "Invalid merge method" }); return; }
  const payload: Record<string, unknown> = { merge_method: mergeMethod };
  if (commitTitle) payload.commit_title = commitTitle.slice(0, 250);
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/merge`, {
    method: "PUT", headers: ghHeaders(auth.token), body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json() as { message?: string };
    res.status(ghError(response.status)).json({ error: error.message ?? `GitHub API error: ${response.status}` }); return;
  }
  const data = await response.json() as { sha?: string; merged?: boolean; message?: string };
  res.json({ merged: data.merged ?? true, sha: data.sha, message: data.message });
});

export default router;
