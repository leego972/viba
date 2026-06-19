/**
 * GitHub REST API v3 tools for AI agents.
 *
 * Verified against api.github.com — all 10 tools tested before integration.
 * Tools cover: repo management, file read/write, branches, PRs, issues, search.
 *
 * Token scopes needed for full functionality:
 *   repo (read + write code, PRs, issues), read:user
 */

const GH_API = "https://api.github.com";

export interface GitHubContext {
  token: string;
}

export interface GitHubTool {
  definition: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  execute(args: Record<string, unknown>, ctx: GitHubContext): Promise<string>;
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "VIBA-Agent/1.0",
  };
}

async function ghFetch(url: string, token: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    ...options,
    headers: { ...ghHeaders(token), ...(options.headers as Record<string, string> ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = (JSON.parse(text) as { message?: string }).message ?? text; } catch { /* keep raw */ }
    throw new Error(`GitHub ${res.status}: ${msg}`);
  }
  if (!text) return {};
  return JSON.parse(text);
}

// ── Tool 1: List repositories ────────────────────────────────────────────────

function makeListRepos(): GitHubTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "github_list_repos",
        description: "List the authenticated user's GitHub repositories, sorted by most recently updated.",
        parameters: {
          type: "object",
          properties: {
            per_page: { type: "number", description: "Max results to return (default 10, max 30)." },
            type: { type: "string", enum: ["all", "owner", "member"], description: "Filter by repo type (default: owner)." },
          },
        },
      },
    },
    async execute(args, ctx) {
      const perPage = Math.min(Number(args["per_page"] ?? 10), 30);
      const type = String(args["type"] ?? "owner");
      const data = await ghFetch(
        `${GH_API}/user/repos?sort=updated&per_page=${perPage}&type=${type}`,
        ctx.token,
      ) as Array<{ full_name: string; description: string | null; html_url: string; stargazers_count: number; language: string | null; private: boolean }>;
      if (!data.length) return "No repositories found.";
      return data
        .map((r) => `• ${r.full_name} [${r.private ? "private" : "public"}]${r.language ? ` (${r.language})` : ""} ⭐${r.stargazers_count}\n  ${r.description ?? "No description"}\n  ${r.html_url}`)
        .join("\n\n");
    },
  };
}

// ── Tool 2: Get repository info ──────────────────────────────────────────────

function makeGetRepo(): GitHubTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "github_get_repo",
        description: "Get details about a specific GitHub repository including stars, language, default branch, and open issue count.",
        parameters: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner (username or org)." },
            repo: { type: "string", description: "Repository name." },
          },
          required: ["owner", "repo"],
        },
      },
    },
    async execute(args, ctx) {
      const data = await ghFetch(
        `${GH_API}/repos/${args["owner"]}/${args["repo"]}`,
        ctx.token,
      ) as { full_name: string; description: string | null; html_url: string; default_branch: string; stargazers_count: number; forks_count: number; open_issues_count: number; language: string | null; private: boolean; topics: string[]; created_at: string; updated_at: string };
      return [
        `**${data.full_name}** [${data.private ? "private" : "public"}]`,
        `Description: ${data.description ?? "None"}`,
        `Language: ${data.language ?? "Not set"}`,
        `Default branch: ${data.default_branch}`,
        `Stars: ${data.stargazers_count} | Forks: ${data.forks_count} | Open issues: ${data.open_issues_count}`,
        `Topics: ${data.topics?.join(", ") || "None"}`,
        `Created: ${data.created_at.split("T")[0]} | Updated: ${data.updated_at.split("T")[0]}`,
        `URL: ${data.html_url}`,
      ].join("\n");
    },
  };
}

// ── Tool 3: Read file ────────────────────────────────────────────────────────

function makeReadFile(): GitHubTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "github_read_file",
        description: "Read the contents of a file from a GitHub repository.",
        parameters: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner." },
            repo: { type: "string", description: "Repository name." },
            path: { type: "string", description: "File path within the repo (e.g. src/index.ts)." },
            ref: { type: "string", description: "Branch, tag, or commit SHA (default: repo default branch)." },
          },
          required: ["owner", "repo", "path"],
        },
      },
    },
    async execute(args, ctx) {
      const ref = args["ref"] ? `?ref=${args["ref"]}` : "";
      const data = await ghFetch(
        `${GH_API}/repos/${args["owner"]}/${args["repo"]}/contents/${args["path"]}${ref}`,
        ctx.token,
      ) as { content?: string; encoding?: string; name: string; size: number; sha: string };
      if (!data.content) return "File found but has no content (may be a directory or empty file).";
      const decoded = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
      const truncated = decoded.length > 6000 ? decoded.slice(0, 6000) + "\n\n[…truncated — file is " + data.size + " bytes]" : decoded;
      return `File: ${String(args["path"])} (${data.size} bytes, sha: ${data.sha.slice(0, 8)})\n\n${truncated}`;
    },
  };
}

// ── Tool 4: Write / create file ──────────────────────────────────────────────

function makeWriteFile(): GitHubTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "github_write_file",
        description: "Create or update a file in a GitHub repository. Automatically handles SHA for updates.",
        parameters: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner." },
            repo: { type: "string", description: "Repository name." },
            path: { type: "string", description: "File path within the repo (e.g. src/index.ts)." },
            content: { type: "string", description: "Full file content as a plain string." },
            message: { type: "string", description: "Commit message." },
            branch: { type: "string", description: "Target branch (default: repo default branch)." },
          },
          required: ["owner", "repo", "path", "content", "message"],
        },
      },
    },
    async execute(args, ctx) {
      const branch = String(args["branch"] ?? "main");
      let sha: string | undefined;
      try {
        const existing = await ghFetch(
          `${GH_API}/repos/${args["owner"]}/${args["repo"]}/contents/${args["path"]}?ref=${branch}`,
          ctx.token,
        ) as { sha?: string };
        sha = existing.sha;
      } catch { /* file doesn't exist yet — create */ }

      const body: Record<string, unknown> = {
        message: args["message"],
        content: Buffer.from(String(args["content"])).toString("base64"),
        branch,
      };
      if (sha) body["sha"] = sha;

      const result = await ghFetch(
        `${GH_API}/repos/${args["owner"]}/${args["repo"]}/contents/${args["path"]}`,
        ctx.token,
        { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
      ) as { content: { html_url: string; sha: string }; commit: { sha: string } };

      return sha
        ? `✅ File updated: ${result.content.html_url}\nCommit: ${result.commit.sha.slice(0, 8)}`
        : `✅ File created: ${result.content.html_url}\nCommit: ${result.commit.sha.slice(0, 8)}`;
    },
  };
}

// ── Tool 5: List branches ────────────────────────────────────────────────────

function makeListBranches(): GitHubTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "github_list_branches",
        description: "List branches in a GitHub repository.",
        parameters: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner." },
            repo: { type: "string", description: "Repository name." },
          },
          required: ["owner", "repo"],
        },
      },
    },
    async execute(args, ctx) {
      const data = await ghFetch(
        `${GH_API}/repos/${args["owner"]}/${args["repo"]}/branches?per_page=30`,
        ctx.token,
      ) as Array<{ name: string; commit: { sha: string }; protected: boolean }>;
      if (!data.length) return "No branches found.";
      return data.map((b) => `• ${b.name} (${b.commit.sha.slice(0, 8)})${b.protected ? " 🔒 protected" : ""}`).join("\n");
    },
  };
}

// ── Tool 6: Create branch ────────────────────────────────────────────────────

function makeCreateBranch(): GitHubTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "github_create_branch",
        description: "Create a new branch in a GitHub repository from an existing branch or SHA.",
        parameters: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner." },
            repo: { type: "string", description: "Repository name." },
            branch: { type: "string", description: "New branch name to create." },
            from_branch: { type: "string", description: "Source branch to create from (default: main)." },
          },
          required: ["owner", "repo", "branch"],
        },
      },
    },
    async execute(args, ctx) {
      const fromBranch = String(args["from_branch"] ?? "main");
      const ref = await ghFetch(
        `${GH_API}/repos/${args["owner"]}/${args["repo"]}/git/ref/heads/${fromBranch}`,
        ctx.token,
      ) as { object: { sha: string } };

      await ghFetch(
        `${GH_API}/repos/${args["owner"]}/${args["repo"]}/git/refs`,
        ctx.token,
        {
          method: "POST",
          body: JSON.stringify({ ref: `refs/heads/${args["branch"]}`, sha: ref.object.sha }),
          headers: { "Content-Type": "application/json" },
        },
      );
      return `✅ Branch "${String(args["branch"])}" created from "${fromBranch}" (sha: ${ref.object.sha.slice(0, 8)})`;
    },
  };
}

// ── Tool 7: Create pull request ──────────────────────────────────────────────

function makeCreatePR(): GitHubTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "github_create_pull_request",
        description: "Open a pull request on a GitHub repository.",
        parameters: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner." },
            repo: { type: "string", description: "Repository name." },
            title: { type: "string", description: "PR title." },
            body: { type: "string", description: "PR description / body (markdown supported)." },
            head: { type: "string", description: "Source branch (the branch with changes)." },
            base: { type: "string", description: "Target branch to merge into (default: main)." },
          },
          required: ["owner", "repo", "title", "head"],
        },
      },
    },
    async execute(args, ctx) {
      const data = await ghFetch(
        `${GH_API}/repos/${args["owner"]}/${args["repo"]}/pulls`,
        ctx.token,
        {
          method: "POST",
          body: JSON.stringify({
            title: args["title"],
            body: args["body"] ?? "",
            head: args["head"],
            base: args["base"] ?? "main",
          }),
          headers: { "Content-Type": "application/json" },
        },
      ) as { number: number; html_url: string; title: string };
      return `✅ Pull request #${data.number} opened: "${data.title}"\n${data.html_url}`;
    },
  };
}

// ── Tool 8: List issues ──────────────────────────────────────────────────────

function makeListIssues(): GitHubTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "github_list_issues",
        description: "List open issues in a GitHub repository.",
        parameters: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner." },
            repo: { type: "string", description: "Repository name." },
            state: { type: "string", enum: ["open", "closed", "all"], description: "Filter by issue state (default: open)." },
            per_page: { type: "number", description: "Max results (default 10, max 20)." },
          },
          required: ["owner", "repo"],
        },
      },
    },
    async execute(args, ctx) {
      const state = String(args["state"] ?? "open");
      const perPage = Math.min(Number(args["per_page"] ?? 10), 20);
      const data = await ghFetch(
        `${GH_API}/repos/${args["owner"]}/${args["repo"]}/issues?state=${state}&per_page=${perPage}`,
        ctx.token,
      ) as Array<{ number: number; title: string; state: string; html_url: string; user: { login: string }; created_at: string; labels: Array<{ name: string }> }>;
      const issues = data.filter((i) => !("pull_request" in i));
      if (!issues.length) return `No ${state} issues found.`;
      return issues
        .map((i) => `#${i.number} [${i.state}] ${i.title}\n  By: ${i.user.login} | ${i.created_at.split("T")[0]}${i.labels.length ? " | Labels: " + i.labels.map((l) => l.name).join(", ") : ""}\n  ${i.html_url}`)
        .join("\n\n");
    },
  };
}

// ── Tool 9: Create issue ─────────────────────────────────────────────────────

function makeCreateIssue(): GitHubTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "github_create_issue",
        description: "Create a new issue in a GitHub repository.",
        parameters: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner." },
            repo: { type: "string", description: "Repository name." },
            title: { type: "string", description: "Issue title." },
            body: { type: "string", description: "Issue description (markdown supported)." },
            labels: { type: "array", items: { type: "string" }, description: "Labels to apply (must already exist in the repo)." },
          },
          required: ["owner", "repo", "title"],
        },
      },
    },
    async execute(args, ctx) {
      const data = await ghFetch(
        `${GH_API}/repos/${args["owner"]}/${args["repo"]}/issues`,
        ctx.token,
        {
          method: "POST",
          body: JSON.stringify({
            title: args["title"],
            body: args["body"] ?? "",
            labels: args["labels"] ?? [],
          }),
          headers: { "Content-Type": "application/json" },
        },
      ) as { number: number; html_url: string; title: string };
      return `✅ Issue #${data.number} created: "${data.title}"\n${data.html_url}`;
    },
  };
}

// ── Tool 10: Search repositories ─────────────────────────────────────────────

function makeSearchRepos(): GitHubTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "github_search_repos",
        description: "Search GitHub repositories by keyword, language, or topic.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query (e.g. 'react dashboard language:typescript')." },
            per_page: { type: "number", description: "Max results (default 5, max 10)." },
          },
          required: ["query"],
        },
      },
    },
    async execute(args, ctx) {
      const perPage = Math.min(Number(args["per_page"] ?? 5), 10);
      const data = await ghFetch(
        `${GH_API}/search/repositories?q=${encodeURIComponent(String(args["query"]))}&sort=stars&order=desc&per_page=${perPage}`,
        ctx.token,
      ) as { total_count: number; items: Array<{ full_name: string; description: string | null; html_url: string; stargazers_count: number; language: string | null; topics: string[] }> };
      if (!data.items.length) return `No repositories found for query: "${String(args["query"])}"`;
      const header = `Found ${data.total_count.toLocaleString()} repositories. Top ${data.items.length}:\n`;
      const items = data.items
        .map((r) => `• ${r.full_name}${r.language ? ` (${r.language})` : ""} ⭐${r.stargazers_count}\n  ${r.description ?? "No description"}\n  ${r.html_url}`)
        .join("\n\n");
      return header + items;
    },
  };
}

// ── Export ────────────────────────────────────────────────────────────────────

export function getGitHubTools(): GitHubTool[] {
  return [
    makeListRepos(),
    makeGetRepo(),
    makeReadFile(),
    makeWriteFile(),
    makeListBranches(),
    makeCreateBranch(),
    makeCreatePR(),
    makeListIssues(),
    makeCreateIssue(),
    makeSearchRepos(),
  ];
}
