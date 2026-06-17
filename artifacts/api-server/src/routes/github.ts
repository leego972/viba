import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

interface GithubApiRepo {
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
}

async function resolveGithubToken(): Promise<string | null> {
  let token: string | null = process.env.GITHUB_TOKEN ?? null;
  if (!token) {
    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, "GITHUB_TOKEN"));
    token = row?.value ?? null;
  }
  return token;
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
  if (status === 422) return 422;
  if (status >= 500) return 502;
  return 401;
}

// GET /github/repo?owner=:owner&repo=:repo
router.get("/github/repo", async (req, res): Promise<void> => {
  const { owner, repo } = req.query as { owner?: string; repo?: string };
  if (!owner || !repo) { res.status(400).json({ error: "owner and repo required" }); return; }
  const token = await resolveGithubToken();
  if (!token) { res.status(503).json({ error: "GitHub token not configured" }); return; }

  const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: ghHeaders(token) });
  if (!r.ok) { res.status(ghError(r.status)).json({ error: `GitHub API error: ${r.status}` }); return; }
  const data = await r.json() as GithubApiRepo;
  res.json({ fullName: data.full_name, htmlUrl: data.html_url, defaultBranch: data.default_branch, private: data.private });
});

// GET /github/repos — list repos
router.get("/github/repos", async (_req, res): Promise<void> => {
  const token = await resolveGithubToken();
  if (!token) { res.status(503).json({ error: "GitHub token not configured" }); return; }

  const r = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator", { headers: ghHeaders(token) });
  if (!r.ok) { res.status(ghError(r.status)).json({ error: `GitHub API error: ${r.status}` }); return; }
  const data = await r.json() as GithubApiRepo[];
  res.json(data.map((d) => ({ fullName: d.full_name, htmlUrl: d.html_url, defaultBranch: d.default_branch, private: d.private })));
});

// GET /github/file?owner=&repo=&path=&ref=  — read a file's content
router.get("/github/file", async (req, res): Promise<void> => {
  const { owner, repo, path, ref } = req.query as Record<string, string | undefined>;
  if (!owner || !repo || !path) { res.status(400).json({ error: "owner, repo, path required" }); return; }
  const token = await resolveGithubToken();
  if (!token) { res.status(503).json({ error: "GitHub token not configured" }); return; }

  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
  const r = await fetch(url, { headers: ghHeaders(token) });
  if (!r.ok) { res.status(ghError(r.status)).json({ error: `GitHub API error: ${r.status}` }); return; }
  const data = await r.json() as { content?: string; encoding?: string; sha?: string; name?: string; size?: number };
  const content = data.encoding === "base64" && data.content
    ? Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8")
    : data.content ?? "";
  res.json({ path, content, sha: data.sha, size: data.size, name: data.name });
});

// GET /github/tree?owner=&repo=&ref=&path=  — list directory contents
router.get("/github/tree", async (req, res): Promise<void> => {
  const { owner, repo, ref, path } = req.query as Record<string, string | undefined>;
  if (!owner || !repo) { res.status(400).json({ error: "owner and repo required" }); return; }
  const token = await resolveGithubToken();
  if (!token) { res.status(503).json({ error: "GitHub token not configured" }); return; }

  const treePath = path ?? "";
  const refParam = ref ?? "HEAD";
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${treePath}?ref=${encodeURIComponent(refParam)}`;
  const r = await fetch(url, { headers: ghHeaders(token) });
  if (!r.ok) { res.status(ghError(r.status)).json({ error: `GitHub API error: ${r.status}` }); return; }
  const data = await r.json() as Array<{ name: string; path: string; type: string; size: number; sha: string }>;
  res.json(Array.isArray(data) ? data.map((f) => ({ name: f.name, path: f.path, type: f.type, size: f.size, sha: f.sha })) : []);
});

// POST /github/branch — create a branch
// Body: { owner, repo, branch, fromRef? }
router.post("/github/branch", async (req, res): Promise<void> => {
  const body = req.body as { owner?: string; repo?: string; branch?: string; fromRef?: string };
  const { owner, repo, branch, fromRef = "HEAD" } = body;
  if (!owner || !repo || !branch) { res.status(400).json({ error: "owner, repo, branch required" }); return; }
  const token = await resolveGithubToken();
  if (!token) { res.status(503).json({ error: "GitHub token not configured" }); return; }

  // Resolve the SHA for fromRef
  const refRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(fromRef)}`, { headers: ghHeaders(token) });
  let sha: string;
  if (refRes.ok) {
    const refData = await refRes.json() as { object?: { sha?: string } };
    sha = refData.object?.sha ?? "";
  } else {
    // Try as a commit SHA directly
    sha = fromRef;
  }
  if (!sha) { res.status(400).json({ error: "Could not resolve fromRef" }); return; }

  const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (!r.ok) {
    const errData = await r.json() as { message?: string };
    res.status(ghError(r.status)).json({ error: errData.message ?? `GitHub API error: ${r.status}` });
    return;
  }
  res.json({ branch, sha, created: true });
});

// PUT /github/file — create or update a file (commit)
// Body: { owner, repo, path, content, message, branch?, sha? }
router.put("/github/file", async (req, res): Promise<void> => {
  const body = req.body as { owner?: string; repo?: string; path?: string; content?: string; message?: string; branch?: string; sha?: string };
  const { owner, repo, path, content, message, branch, sha } = body;
  if (!owner || !repo || !path || content === undefined || !message) {
    res.status(400).json({ error: "owner, repo, path, content, message required" });
    return;
  }
  const token = await resolveGithubToken();
  if (!token) { res.status(503).json({ error: "GitHub token not configured" }); return; }

  const b64 = Buffer.from(content, "utf8").toString("base64");
  const payload: Record<string, unknown> = { message, content: b64 };
  if (branch) payload.branch = branch;
  if (sha) payload.sha = sha; // required for updates

  const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`, {
    method: "PUT",
    headers: ghHeaders(token),
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const errData = await r.json() as { message?: string };
    res.status(ghError(r.status)).json({ error: errData.message ?? `GitHub API error: ${r.status}` });
    return;
  }
  const data = await r.json() as { commit?: { sha?: string }; content?: { sha?: string } };
  res.json({ path, commitSha: data.commit?.sha, fileSha: data.content?.sha });
});

// POST /github/pr — open a pull request
// Body: { owner, repo, title, body?, head, base }
router.post("/github/pr", async (req, res): Promise<void> => {
  const body = req.body as { owner?: string; repo?: string; title?: string; body?: string; head?: string; base?: string };
  const { owner, repo, title, head, base } = body;
  if (!owner || !repo || !title || !head || !base) {
    res.status(400).json({ error: "owner, repo, title, head, base required" });
    return;
  }
  const token = await resolveGithubToken();
  if (!token) { res.status(503).json({ error: "GitHub token not configured" }); return; }

  const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({ title, body: body.body ?? "", head, base }),
  });
  if (!r.ok) {
    const errData = await r.json() as { message?: string };
    res.status(ghError(r.status)).json({ error: errData.message ?? `GitHub API error: ${r.status}` });
    return;
  }
  const data = await r.json() as { number?: number; html_url?: string; state?: string };
  res.json({ number: data.number, url: data.html_url, state: data.state });
});

// POST /github/pr/merge — merge a pull request
// Body: { owner, repo, pullNumber, commitTitle?, mergeMethod? }
router.post("/github/pr/merge", async (req, res): Promise<void> => {
  const body = req.body as { owner?: string; repo?: string; pullNumber?: number; commitTitle?: string; mergeMethod?: string };
  const { owner, repo, pullNumber, commitTitle, mergeMethod = "merge" } = body;
  if (!owner || !repo || !pullNumber) {
    res.status(400).json({ error: "owner, repo, pullNumber required" });
    return;
  }
  const token = await resolveGithubToken();
  if (!token) { res.status(503).json({ error: "GitHub token not configured" }); return; }

  const payload: Record<string, unknown> = { merge_method: mergeMethod };
  if (commitTitle) payload.commit_title = commitTitle;

  const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/merge`, {
    method: "PUT",
    headers: ghHeaders(token),
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const errData = await r.json() as { message?: string };
    res.status(ghError(r.status)).json({ error: errData.message ?? `GitHub API error: ${r.status}` });
    return;
  }
  const data = await r.json() as { sha?: string; merged?: boolean; message?: string };
  res.json({ merged: data.merged ?? true, sha: data.sha, message: data.message });
});

export default router;
