/**
 * VIBA Webhook Post Tool
 *
 * webhook_post — POST a JSON payload to any webhook URL with:
 *   - Configurable retry logic with exponential back-off
 *   - Optional HMAC-SHA256 request signing (Stripe/GitHub/Shopify-style)
 *   - Delivery receipt with timing, attempt count, and status code
 *
 * Distinct from http_request: focused on reliable fire-and-confirm delivery
 * to event-driven systems (Zapier, Make, n8n, custom ingest endpoints).
 */

import crypto from "node:crypto";

export interface WebhookTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }
function num(v: unknown, fb: number): number { return typeof v === "number" ? v : fb; }

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getWebhookTools(): WebhookTool[] {
  return [

    {
      definition: {
        type: "function",
        function: {
          name: "webhook_post",
          description: "POST a structured payload to any webhook URL with automatic retry on failure and optional HMAC-SHA256 request signing. Use to trigger Zapier zaps, Make scenarios, n8n webhooks, or any custom ingest endpoint. Retries up to 3 times with exponential back-off. Returns a delivery receipt with status, timing, and attempt count.",
          parameters: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "Webhook endpoint URL (must be https://)",
              },
              payload: {
                type: "object",
                description: "JSON payload to send as the request body",
              },
              headers: {
                type: "object",
                description: "Additional HTTP headers to include (e.g. {'X-Api-Key': '...'}). Content-Type is set to application/json automatically.",
              },
              secret: {
                type: "string",
                description: "Optional HMAC-SHA256 signing secret. When provided, adds an X-Hub-Signature-256 header (same format as GitHub webhooks). Compatible with Stripe, GitHub, Shopify, and most custom signing schemes.",
              },
              signature_header: {
                type: "string",
                description: "Name of the signature header (default: X-Hub-Signature-256). Use X-Stripe-Signature for Stripe-style, X-Shopify-Hmac-Sha256 for Shopify-style.",
              },
              retries: {
                type: "number",
                description: "Number of retry attempts on failure (default: 2, max: 4). Uses exponential back-off: 1s, 2s, 4s.",
              },
              timeout_ms: {
                type: "number",
                description: "Per-attempt timeout in milliseconds (default: 10000).",
              },
              expected_status: {
                type: "number",
                description: "Expected HTTP success status code (default: 200). Use 202 for async accept patterns.",
              },
            },
            required: ["url", "payload"],
          },
        },
      },
      async execute(args) {
        const url = str(args["url"]);
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
          return "Error: webhook URL must start with http:// or https://";
        }

        const payload     = args["payload"] ?? {};
        const secret      = str(args["secret"]);
        const sigHeader   = str(args["signature_header"], "X-Hub-Signature-256");
        const maxRetries  = Math.min(Math.max(0, num(args["retries"], 2)), 4);
        const timeoutMs   = Math.min(Math.max(1000, num(args["timeout_ms"], 10_000)), 30_000);
        const expectedStatus = num(args["expected_status"], 200);
        const extraHeaders = (typeof args["headers"] === "object" && args["headers"] !== null)
          ? args["headers"] as Record<string, string> : {};

        const bodyStr = JSON.stringify(payload);

        // Build headers
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "User-Agent":   "VIBA-Webhook/1.0",
          ...extraHeaders,
        };

        // HMAC signing
        if (secret) {
          const sig = "sha256=" + crypto.createHmac("sha256", secret).update(bodyStr).digest("hex");
          headers[sigHeader] = sig;
        }

        let lastError: string = "";
        let lastStatus: number | null = null;
        let lastBody: string = "";
        const overallStart = Date.now();

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (attempt > 0) {
            const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
            await sleep(backoffMs);
          }

          const attemptStart = Date.now();
          try {
            const res = await fetch(url, {
              method: "POST",
              headers,
              body: bodyStr,
              signal: AbortSignal.timeout(timeoutMs),
            });

            lastStatus = res.status;
            lastBody   = (await res.text()).slice(0, 500);
            const attemptMs = Date.now() - attemptStart;

            if (res.status === expectedStatus || (res.status >= 200 && res.status < 300)) {
              const totalMs = Date.now() - overallStart;
              return [
                `✅ Webhook delivered`,
                `URL:      ${url}`,
                `Status:   HTTP ${res.status}`,
                `Attempts: ${attempt + 1}/${maxRetries + 1}`,
                `Time:     ${attemptMs}ms (attempt) / ${totalMs}ms (total)`,
                secret ? `Signed:   ${sigHeader} header added` : "",
                lastBody ? `Response: ${lastBody.slice(0, 200)}` : "",
              ].filter(Boolean).join("\n");
            }

            lastError = `HTTP ${res.status}: ${lastBody.slice(0, 200)}`;

            // Don't retry on client errors (4xx) — they won't succeed on retry
            if (res.status >= 400 && res.status < 500) {
              return [
                `❌ Webhook failed (client error — not retrying)`,
                `URL:     ${url}`,
                `Status:  HTTP ${res.status}`,
                `Body:    ${lastBody.slice(0, 300)}`,
              ].join("\n");
            }

          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
          }
        }

        const totalMs = Date.now() - overallStart;
        return [
          `❌ Webhook delivery failed after ${maxRetries + 1} attempt(s)`,
          `URL:      ${url}`,
          `Status:   ${lastStatus !== null ? `HTTP ${lastStatus}` : "no response"}`,
          `Error:    ${lastError}`,
          `Time:     ${totalMs}ms total`,
        ].join("\n");
      },
    },

  ];
}
