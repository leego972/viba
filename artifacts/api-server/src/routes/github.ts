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

// GET /github/repo?owner=:owner&repo=:repo — fetch a single repo's metadata
router.get("/github/repo", async (req, res): Promise<void> => {
  const { owner, repo } = req.query as { owner?: string; repo?: string };

  if (!owner || !repo) {
    res.status(400).json({ error: "owner and repo query params are required" });
    return;
  }

  const token = await resolveGithubToken();

  if (!token) {
    res.status(503).json({
      error:
        "GitHub token not configured. Add GITHUB_TOKEN in Settings or set it as an environment variable.",
    });
    return;
  }

  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "VIBA-App/1.0",
      },
    },
  );

  if (!response.ok) {
    const httpStatus = response.status === 404 ? 404 : response.status >= 500 ? 502 : 401;
    res.status(httpStatus).json({ error: `GitHub API error: ${response.status}` });
    return;
  }

  const data = (await response.json()) as GithubApiRepo;

  res.json({
    fullName: data.full_name,
    htmlUrl: data.html_url,
    defaultBranch: data.default_branch,
    private: data.private,
  });
});

// GET /github/repos — list repos for the configured GitHub token
// Token resolution order: GITHUB_TOKEN env var → GITHUB_TOKEN setting in DB
router.get("/github/repos", async (_req, res): Promise<void> => {
  const token = await resolveGithubToken();

  if (!token) {
    res.status(503).json({
      error:
        "GitHub token not configured. Add GITHUB_TOKEN in Settings or set it as an environment variable.",
    });
    return;
  }

  const response = await fetch(
    "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator",
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "VIBA-App/1.0",
      },
    },
  );

  if (!response.ok) {
    const httpStatus = response.status >= 500 ? 502 : 401;
    res.status(httpStatus).json({ error: `GitHub API error: ${response.status}` });
    return;
  }

  const data = (await response.json()) as GithubApiRepo[];

  res.json(
    data.map((r) => ({
      fullName: r.full_name,
      htmlUrl: r.html_url,
      defaultBranch: r.default_branch,
      private: r.private,
    })),
  );
});

export default router;
