/**
 * http_request — make arbitrary HTTP requests to any API.
 * Supports GET, POST, PUT, PATCH, DELETE with custom headers and JSON body.
 */

export interface HttpTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }

export function getHttpTools(): HttpTool[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "http_request",
          description: "Make an HTTP request to any REST API endpoint. Use for calling external APIs, webhooks, or services. Supports custom headers and JSON body. Returns the response status, headers summary, and body (truncated to 4000 chars).",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "Full URL including query string (e.g. https://api.example.com/v1/users?limit=10)" },
              method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "HTTP method (default: GET)" },
              headers: { type: "object", description: "Request headers as key-value pairs (e.g. {\"Authorization\": \"Bearer token\", \"X-API-Key\": \"abc\"})" },
              body: { type: "object", description: "Request body as JSON object (for POST/PUT/PATCH)" },
              body_raw: { type: "string", description: "Raw string body (use instead of body when sending non-JSON, e.g. form data)" },
              timeout_ms: { type: "number", description: "Request timeout in ms (default 15000)" },
            },
            required: ["url"],
          },
        },
      },
      async execute(args) {
        const url = str(args["url"]);
        if (!url || !url.startsWith("http")) return "Error: valid url is required";

        const method = str(args["method"], "GET").toUpperCase();
        const headers: Record<string, string> = { "User-Agent": "VIBA-Agent/1.0" };

        if (args["headers"] && typeof args["headers"] === "object") {
          for (const [k, v] of Object.entries(args["headers"] as Record<string, unknown>)) {
            if (typeof v === "string") headers[k] = v;
          }
        }

        let body: string | undefined;
        if (args["body"] && typeof args["body"] === "object") {
          body = JSON.stringify(args["body"]);
          headers["Content-Type"] ??= "application/json";
        } else if (typeof args["body_raw"] === "string") {
          body = args["body_raw"] as string;
        }

        const timeout = typeof args["timeout_ms"] === "number" ? args["timeout_ms"] : 15_000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
          const res = await fetch(url, { method, headers, body, signal: controller.signal });
          clearTimeout(timer);

          const contentType = res.headers.get("content-type") ?? "";
          let responseBody: string;
          if (contentType.includes("application/json")) {
            const json = await res.json();
            responseBody = JSON.stringify(json, null, 2);
          } else {
            responseBody = await res.text();
          }

          const truncated = responseBody.length > 4000
            ? responseBody.slice(0, 4000) + `\n... [truncated ${responseBody.length - 4000} chars]`
            : responseBody;

          return `HTTP ${method} ${url}\nStatus: ${res.status} ${res.statusText}\nContent-Type: ${contentType}\n\nResponse:\n${truncated}`;
        } catch (err) {
          clearTimeout(timer);
          if ((err as Error).name === "AbortError") return `Error: Request timed out after ${timeout}ms`;
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}
