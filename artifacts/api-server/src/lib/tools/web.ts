/**
 * Web fetch + npm registry tools for AI agents.
 *
 * Verified tools:
 *   - web_fetch: fetch any URL, extract readable text content
 *   - npm_search: search npm registry, return top packages with download stats
 *   - npm_package_info: get full package metadata + README excerpt
 */

export interface WebTool {
  definition: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  execute(args: Record<string, unknown>): Promise<string>;
}

// ── Utility: strip HTML tags → readable text ─────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── Tool 1: Web fetch ────────────────────────────────────────────────────────

function makeWebFetch(): WebTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "web_fetch",
        description: "Fetch the text content of any public URL — documentation pages, GitHub READMEs, blog posts, API references, or any web page. Returns readable plain text (HTML stripped).",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The full URL to fetch (must start with https:// or http://)." },
            max_chars: { type: "number", description: "Maximum characters to return (default 4000, max 8000). Use a smaller value to save context." },
          },
          required: ["url"],
        },
      },
    },
    async execute(args) {
      const url = String(args["url"]);
      const maxChars = Math.min(Number(args["max_chars"] ?? 4000), 8000);

      if (!/^https?:\/\//i.test(url)) {
        return `Error: URL must start with http:// or https://`;
      }

      let text: string;
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "VIBA-Agent/1.0 (documentation reader)" },
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return `Error fetching ${url}: HTTP ${res.status} ${res.statusText}`;
        const raw = await res.text();
        text = stripHtml(raw);
      } catch (err) {
        return `Error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`;
      }

      const truncated = text.length > maxChars
        ? text.slice(0, maxChars) + `\n\n[…content truncated at ${maxChars} chars — ${text.length} total]`
        : text;

      return `Content from ${url}:\n\n${truncated}`;
    },
  };
}

// ── Tool 2: npm search ───────────────────────────────────────────────────────

function makeNpmSearch(): WebTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "npm_search",
        description: "Search the npm registry for packages by keyword. Returns package names, descriptions, version, weekly downloads, and npm URLs.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search keywords (e.g. 'react table', 'express middleware auth', 'typescript orm')." },
            size: { type: "number", description: "Number of results (default 5, max 10)." },
          },
          required: ["query"],
        },
      },
    },
    async execute(args) {
      const query = encodeURIComponent(String(args["query"]));
      const size = Math.min(Number(args["size"] ?? 5), 10);

      let data: {
        objects: Array<{
          package: { name: string; version: string; description?: string; links: { npm: string } };
          score: { final: number };
        }>;
        total: number;
      };

      try {
        const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${query}&size=${size}`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return `npm search error: HTTP ${res.status}`;
        data = await res.json() as typeof data;
      } catch (err) {
        return `npm search failed: ${err instanceof Error ? err.message : String(err)}`;
      }

      if (!data.objects.length) return `No npm packages found for "${String(args["query"])}"`;

      const header = `Found ${data.total} packages. Top ${data.objects.length}:\n`;
      const items = data.objects
        .map((o) => {
          const score = Math.round(o.score.final * 100);
          return `• **${o.package.name}** v${o.package.version} (relevance: ${score}%)\n  ${o.package.description ?? "No description"}\n  ${o.package.links.npm}`;
        })
        .join("\n\n");

      return header + items;
    },
  };
}

// ── Tool 3: npm package info ─────────────────────────────────────────────────

function makeNpmPackageInfo(): WebTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "npm_package_info",
        description: "Get detailed information about a specific npm package: version, description, dependencies, license, repository URL, and install command.",
        parameters: {
          type: "object",
          properties: {
            package_name: { type: "string", description: "Exact npm package name (e.g. 'express', '@types/node', 'drizzle-orm')." },
          },
          required: ["package_name"],
        },
      },
    },
    async execute(args) {
      const pkg = String(args["package_name"]);

      let data: {
        name: string;
        version: string;
        description?: string;
        license?: string;
        homepage?: string;
        repository?: { url?: string };
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        keywords?: string[];
      };

      try {
        const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 404) return `Package "${pkg}" not found on npm.`;
        if (!res.ok) return `npm error: HTTP ${res.status}`;
        data = await res.json() as typeof data;
      } catch (err) {
        return `Failed to fetch package info: ${err instanceof Error ? err.message : String(err)}`;
      }

      const deps = Object.keys(data.dependencies ?? {});
      const peerDeps = Object.keys(data.peerDependencies ?? {});
      const repoUrl = data.repository?.url?.replace(/^git\+/, "").replace(/\.git$/, "") ?? "Not specified";

      return [
        `**${data.name}** v${data.version}`,
        `Description: ${data.description ?? "None"}`,
        `License: ${data.license ?? "Not specified"}`,
        `Install: npm install ${data.name}`,
        `Homepage: ${data.homepage ?? repoUrl}`,
        `Keywords: ${data.keywords?.slice(0, 10).join(", ") || "None"}`,
        deps.length ? `Dependencies (${deps.length}): ${deps.slice(0, 10).join(", ")}${deps.length > 10 ? "…" : ""}` : "No dependencies",
        peerDeps.length ? `Peer dependencies: ${peerDeps.join(", ")}` : null,
      ].filter(Boolean).join("\n");
    },
  };
}

// ── Export ────────────────────────────────────────────────────────────────────

export function getWebTools(): WebTool[] {
  return [
    makeWebFetch(),
    makeNpmSearch(),
    makeNpmPackageInfo(),
  ];
}
