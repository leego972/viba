/**
 * VIBA Slack Tools
 *
 * slack_webhook — post a message to a Slack channel via incoming webhook URL
 *
 * Supports plain text, mrkdwn formatting, Block Kit blocks, and attachments.
 * Webhook URL is read from the SLACK_WEBHOOK_URL environment variable if not
 * provided directly — so agents don't need to know the secret.
 */

export interface SlackTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }

export function getSlackTools(): SlackTool[] {
  return [

    {
      definition: {
        type: "function",
        function: {
          name: "slack_webhook",
          description: "Post a message to a Slack channel using an incoming webhook. Supports plain text, Slack mrkdwn formatting (*bold*, _italic_, `code`, ```code block```, >blockquote), and structured Block Kit blocks for rich layouts. The webhook URL can be provided directly or read from the SLACK_WEBHOOK_URL environment variable.",
          parameters: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "Message text. Supports Slack mrkdwn: *bold*, _italic_, `code`, ~strike~, :emoji:, <URL|label>, @mentions. This is the fallback text for notifications.",
              },
              webhook_url: {
                type: "string",
                description: "Slack incoming webhook URL (https://hooks.slack.com/services/...). If omitted, uses SLACK_WEBHOOK_URL env var.",
              },
              channel: {
                type: "string",
                description: "Override the default channel (e.g. #general or @username). Only works if the webhook supports channel overrides.",
              },
              username: {
                type: "string",
                description: "Override the bot display name (default: VIBA Agent).",
              },
              icon_emoji: {
                type: "string",
                description: "Override the bot icon emoji (e.g. ':robot_face:'). Default: :robot_face:",
              },
              icon_url: {
                type: "string",
                description: "Override the bot icon with an image URL (takes precedence over icon_emoji).",
              },
              blocks: {
                type: "array",
                description: "Slack Block Kit blocks array for rich message layout. See https://api.slack.com/block-kit. If provided, 'text' becomes the notification fallback only.",
                items: { type: "object" },
              },
              attachments: {
                type: "array",
                description: "Legacy Slack attachments array. Use blocks for new implementations.",
                items: { type: "object" },
              },
              thread_ts: {
                type: "string",
                description: "Thread timestamp to reply in a thread (e.g. '1234567890.123456').",
              },
              unfurl_links: {
                type: "boolean",
                description: "Whether to unfurl URL previews (default: false).",
              },
            },
            required: ["text"],
          },
        },
      },
      async execute(args) {
        const webhookUrl = str(args["webhook_url"]) || process.env["SLACK_WEBHOOK_URL"] || "";
        if (!webhookUrl) {
          return "Error: No Slack webhook URL provided. Pass webhook_url in args or set SLACK_WEBHOOK_URL environment variable.";
        }
        if (!webhookUrl.startsWith("https://hooks.slack.com/")) {
          return "Error: Invalid Slack webhook URL — must start with https://hooks.slack.com/";
        }

        const text = str(args["text"]);
        if (!text) return "Error: text is required";

        // Build payload
        const payload: Record<string, unknown> = { text };

        const channel  = str(args["channel"]);
        const username = str(args["username"], "VIBA Agent");
        const iconUrl  = str(args["icon_url"]);
        const iconEmoji = str(args["icon_emoji"], ":robot_face:");

        if (channel)  payload["channel"]    = channel;
        if (username) payload["username"]   = username;
        if (iconUrl)  payload["icon_url"]   = iconUrl;
        else          payload["icon_emoji"] = iconEmoji;

        if (Array.isArray(args["blocks"]) && args["blocks"].length > 0) {
          payload["blocks"] = args["blocks"];
        }
        if (Array.isArray(args["attachments"]) && args["attachments"].length > 0) {
          payload["attachments"] = args["attachments"];
        }
        if (typeof args["thread_ts"] === "string" && args["thread_ts"]) {
          payload["thread_ts"] = args["thread_ts"];
        }
        if (typeof args["unfurl_links"] === "boolean") {
          payload["unfurl_links"] = args["unfurl_links"];
        } else {
          payload["unfurl_links"] = false;
        }

        try {
          const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10_000),
          });

          const body = await res.text();
          if (!res.ok || body !== "ok") {
            return `Slack webhook failed: HTTP ${res.status} — ${body}`;
          }

          return [
            `✅ Slack message sent`,
            `Channel:  ${channel || "(webhook default)"}`,
            `Username: ${username}`,
            `Text:     ${text.slice(0, 100)}${text.length > 100 ? "…" : ""}`,
            Array.isArray(args["blocks"]) ? `Blocks:   ${(args["blocks"] as unknown[]).length} block(s)` : "",
          ].filter(Boolean).join("\n");
        } catch (err) {
          return `Slack webhook error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

  ];
}
