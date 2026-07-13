/**
 * web_search — DuckDuckGo instant answer + result search.
 * No API key required. Uses the DuckDuckGo JSON API.
 */

export interface SearchTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }
function num(v: unknown, fb = 5): number { return typeof v === "number" ? v : fb; }

async function ddgSearch(query: string, maxResults: number): Promise<string> {
  const encoded = encodeURIComponent(query);
  const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
  const res = await fetch(url, { headers: { "User-Agent": "VIBA-Agent/1.0" } });
  if (!res.ok) throw new Error(`DuckDuckGo returned ${res.status}`);
  const data = await res.json() as {
    AbstractText?: string;
    AbstractURL?: string;
    AbstractSource?: string;
    Answer?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Name?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
    Results?: Array<{ Text?: string; FirstURL?: string }>;
  };

  const lines: string[] = [];

  if (data.Answer) lines.push(`DIRECT ANSWER: ${data.Answer}`);
  if (data.AbstractText) {
    lines.push(`SUMMARY (${data.AbstractSource ?? "Wikipedia"}): ${data.AbstractText}`);
    if (data.AbstractURL) lines.push(`Source: ${data.AbstractURL}`);
  }

  const results: Array<{ title: string; url: string }> = [];
  for (const r of data.Results ?? []) {
    if (r.Text && r.FirstURL) results.push({ title: r.Text, url: r.FirstURL });
  }
  for (const t of data.RelatedTopics ?? []) {
    if (results.length >= maxResults) break;
    if (t.Text && t.FirstURL) {
      results.push({ title: t.Text, url: t.FirstURL });
    } else if (t.Topics) {
      for (const sub of t.Topics) {
        if (results.length >= maxResults) break;
        if (sub.Text && sub.FirstURL) results.push({ title: sub.Text, url: sub.FirstURL });
      }
    }
  }

  if (results.length > 0) {
    lines.push(`\nTOP RESULTS:`);
    for (const [i, r] of results.slice(0, maxResults).entries()) {
      lines.push(`${i + 1}. ${r.title}\n   ${r.url}`);
    }
  }

  if (lines.length === 0) return `No results found for "${query}". Try a different query.`;
  return lines.join("\n");
}

export function getSearchTools(): SearchTool[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "web_search",
          description: "Search the web for current information, news, documentation, or research. Returns summaries and top result links. Use this when you need to find information you don't already know — current events, library docs, competitor research, etc.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query (e.g. 'best Node.js ORM 2025', 'React Server Components tutorial', 'VIBA multi-agent orchestration')" },
              max_results: { type: "number", description: "Number of results to return (default 5, max 10)" },
            },
            required: ["query"],
          },
        },
      },
      async execute(args) {
        const query = str(args["query"]);
        if (!query) return "Error: query is required";
        const max = Math.min(num(args["max_results"], 5), 10);
        try {
          return await ddgSearch(query, max);
        } catch (err) {
          return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}
