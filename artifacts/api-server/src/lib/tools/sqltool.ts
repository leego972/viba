/**
 * sql_query — run read-only SQL against the connected PostgreSQL database.
 * Only SELECT statements allowed. Results capped at 100 rows / 4000 chars.
 */

export interface SqlTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }

export function getSqlTools(): SqlTool[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "sql_query",
          description: "Run a read-only SQL SELECT query against the VIBA PostgreSQL database. Use for data analysis, checking user counts, session stats, billing data, or any database investigation. Only SELECT statements are allowed — no INSERT, UPDATE, DELETE, or DDL.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "SQL SELECT query to execute (e.g. 'SELECT count(*) FROM sessions WHERE created_at > now() - interval \\'7 days\\'')" },
              max_rows: { type: "number", description: "Maximum rows to return (default 20, max 100)" },
            },
            required: ["query"],
          },
        },
      },
      async execute(args) {
        const query = str(args["query"]).trim();
        if (!query) return "Error: query is required";

        const normalized = query.toLowerCase().replace(/\s+/g, " ");
        const forbidden = ["insert ", "update ", "delete ", "drop ", "truncate ", "alter ", "create ", "grant ", "revoke "];
        for (const f of forbidden) {
          if (normalized.includes(f)) return `Error: only SELECT queries are allowed. Found forbidden keyword: ${f.trim()}`;
        }
        if (!normalized.startsWith("select") && !normalized.startsWith("with") && !normalized.startsWith("explain")) {
          return "Error: query must start with SELECT, WITH, or EXPLAIN";
        }

        const maxRows = Math.min(typeof args["max_rows"] === "number" ? args["max_rows"] : 20, 100);
        const limitedQuery = normalized.includes("limit ") ? query : `${query} LIMIT ${maxRows}`;

        try {
          const { pool } = await import("@workspace/db");
          const result = await pool.query(limitedQuery);
          const rows = result.rows as Record<string, unknown>[];
          if (rows.length === 0) return `Query returned 0 rows.\nQuery: ${query}`;
          const header = Object.keys(rows[0] ?? {}).join(" | ");
          const divider = header.replace(/[^|]/g, "-").replace(/\|/g, "+");
          const body = rows.map((r: Record<string, unknown>) => Object.values(r).map((v: unknown) =>
            v === null ? "NULL" : v instanceof Date ? v.toISOString() : String(v)
          ).join(" | ")).join("\n");
          const output = `${header}\n${divider}\n${body}\n\n(${rows.length} row${rows.length === 1 ? "" : "s"})`;
          return output.length > 4000 ? output.slice(0, 4000) + "\n...[truncated]" : output;
        } catch (err) {
          return `SQL error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}
