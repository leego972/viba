/**
 * diff_generate — generate a unified diff between two text strings.
 * stripe_query — look up Stripe customers, subscriptions, and recent charges.
 */

export interface UtilTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }

function unifiedDiff(oldText: string, newText: string, oldLabel = "original", newLabel = "modified"): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const lines: string[] = [`--- ${oldLabel}`, `+++ ${newLabel}`];
  let i = 0; let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      lines.push(` ${oldLines[i]}`); i++; j++;
    } else if (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) {
      lines.push(`+${newLines[j]}`); j++;
    } else {
      lines.push(`-${oldLines[i]}`); i++;
    }
  }
  const changed = lines.filter(l => l.startsWith("+") || l.startsWith("-")).length;
  if (changed === 0) return "Files are identical — no differences found.";
  return lines.join("\n");
}

export function getDiffTools(): UtilTool[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "diff_generate",
          description: "Generate a unified diff between two text strings (original vs modified). Use for code review, showing what changed in a file, comparing configuration versions, or summarising edits made by an agent.",
          parameters: {
            type: "object",
            properties: {
              original: { type: "string", description: "Original text content" },
              modified: { type: "string", description: "Modified text content" },
              original_label: { type: "string", description: "Label for original (default: 'original')" },
              modified_label: { type: "string", description: "Label for modified (default: 'modified')" },
            },
            required: ["original", "modified"],
          },
        },
      },
      async execute(args) {
        const original = str(args["original"]);
        const modified = str(args["modified"]);
        if (!original && !modified) return "Error: original and modified are required";
        const diff = unifiedDiff(
          original,
          modified,
          str(args["original_label"], "original"),
          str(args["modified_label"], "modified"),
        );
        return diff.length > 6000 ? diff.slice(0, 6000) + "\n...[diff truncated]" : diff;
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "stripe_query",
          description: "Query Stripe for customer, subscription, and payment data. Use for checking billing status, finding customers, reviewing recent charges, or investigating subscription issues. Requires STRIPE_SECRET_KEY.",
          parameters: {
            type: "object",
            properties: {
              resource: { type: "string", enum: ["customers", "subscriptions", "charges", "invoices", "customer"], description: "Which Stripe resource to query" },
              customer_id: { type: "string", description: "Stripe customer ID (for customer-specific queries, e.g. 'cus_xxx')" },
              email: { type: "string", description: "Filter customers by email address" },
              limit: { type: "number", description: "Max results (default 10, max 50)" },
              status: { type: "string", description: "Filter by status (e.g. 'active', 'canceled', 'past_due' for subscriptions)" },
            },
            required: ["resource"],
          },
        },
      },
      async execute(args) {
        const stripeKey = process.env["STRIPE_SECRET_KEY"];
        if (!stripeKey) return "Error: STRIPE_SECRET_KEY is not configured";

        const resource = str(args["resource"]);
        const limit = Math.min(typeof args["limit"] === "number" ? args["limit"] : 10, 50);

        const base = "https://api.stripe.com/v1";
        const headers = {
          "Authorization": `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        };

        const params = new URLSearchParams();
        params.set("limit", String(limit));
        if (args["status"]) params.set("status", str(args["status"]));
        if (args["customer_id"] && resource !== "customer") params.set("customer", str(args["customer_id"]));
        if (args["email"] && resource === "customers") params.set("email", str(args["email"]));

        let endpoint = `${base}/${resource}`;
        if (resource === "customer" && args["customer_id"]) {
          endpoint = `${base}/customers/${str(args["customer_id"])}`;
        }

        try {
          const url = resource === "customer" ? endpoint : `${endpoint}?${params.toString()}`;
          const res = await fetch(url, { headers });
          if (!res.ok) {
            const err = await res.json() as { error?: { message?: string } };
            return `Stripe error: ${err.error?.message ?? res.statusText}`;
          }
          const data = await res.json() as { data?: unknown[]; object?: string; id?: string };
          const items = data.data ?? [data];
          if (!items.length) return `No ${resource} found matching your query.`;
          const out = JSON.stringify(items.slice(0, limit), null, 2);
          return out.length > 5000 ? out.slice(0, 5000) + "\n...[truncated]" : out;
        } catch (err) {
          return `Stripe query failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}
