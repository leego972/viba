/**
 * discord_webhook — post messages to Discord channels via webhook URL.
 * Webhook URL can be passed directly or stored in DISCORD_WEBHOOK_URL env var.
 */

export interface DiscordTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }

export function getDiscordTools(): DiscordTool[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "discord_webhook",
          description: "Post a message to a Discord channel via webhook. Use for sending agent updates, reports, alerts, or notifications to a team Discord server. Supports plain text and rich embeds.",
          parameters: {
            type: "object",
            properties: {
              content: { type: "string", description: "Plain text message to post (max 2000 chars)" },
              webhook_url: { type: "string", description: "Discord webhook URL. If omitted, uses the DISCORD_WEBHOOK_URL environment variable." },
              username: { type: "string", description: "Override the webhook bot username (default: VIBA Agent)" },
              title: { type: "string", description: "Embed title (creates a rich embed instead of plain text)" },
              description: { type: "string", description: "Embed description (used with title for rich embeds)" },
              color: { type: "number", description: "Embed color as decimal integer (e.g. 5763719 = green, 15548997 = red, 5793266 = blue)" },
              fields: {
                type: "array",
                description: "Embed fields array (used with title)",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    value: { type: "string" },
                    inline: { type: "boolean" },
                  },
                },
              },
            },
          },
        },
      },
      async execute(args) {
        const webhookUrl = str(args["webhook_url"]) || process.env["DISCORD_WEBHOOK_URL"] || "";
        if (!webhookUrl) return "Error: no webhook URL provided and DISCORD_WEBHOOK_URL is not set";

        const content = str(args["content"]);
        const title = str(args["title"]);
        const description = str(args["description"]);

        if (!content && !title) return "Error: provide content or title";

        const payload: Record<string, unknown> = {
          username: str(args["username"], "VIBA Agent"),
          avatar_url: "https://viba.guru/viba-logo.png",
        };

        if (title || description) {
          const embed: Record<string, unknown> = {};
          if (title) embed["title"] = title;
          if (description) embed["description"] = description;
          if (typeof args["color"] === "number") embed["color"] = args["color"];
          if (Array.isArray(args["fields"])) embed["fields"] = args["fields"];
          embed["footer"] = { text: "VIBA Multi-Agent Orchestration" };
          embed["timestamp"] = new Date().toISOString();
          payload["embeds"] = [embed];
          if (content) payload["content"] = content;
        } else {
          payload["content"] = content.slice(0, 2000);
        }

        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.ok || res.status === 204) return `Discord message posted successfully`;
        const body = await res.text().catch(() => "");
        return `Discord webhook failed: ${res.status} ${res.statusText}${body ? " — " + body : ""}`;
      },
    },
  ];
}
