/**
 * VIBA RSS/Feed Tools
 *
 * rss_feed_read — fetch and parse an RSS 2.0 or Atom feed, return items with title/link/date/summary
 */

export interface RssTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&[a-z]+;/g, "");
}

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeHtmlEntities(m[1]!.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim()) : "";
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, "i"));
  return m ? decodeHtmlEntities(m[1]!) : "";
}

interface FeedItem {
  title: string;
  link: string;
  date: string;
  summary: string;
  author: string;
}

function parseRss2(xml: string, maxItems: number): FeedItem[] {
  const channelMatch = xml.match(/<channel>([\s\S]*)<\/channel>/i);
  const channel = channelMatch ? channelMatch[1]! : xml;
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
  const items: FeedItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = itemPattern.exec(channel)) !== null && items.length < maxItems) {
    const item = m[1]!;
    const link = extractTag(item, "link") || extractAttr(item, "link", "href") ||
                 (item.match(/<link[^>]*>\s*(https?[^<]+)\s*<\/link>/i)?.[1] ?? "");
    items.push({
      title:   extractTag(item, "title"),
      link:    link.trim(),
      date:    extractTag(item, "pubDate") || extractTag(item, "dc:date"),
      summary: extractTag(item, "description") || extractTag(item, "content:encoded"),
      author:  extractTag(item, "author") || extractTag(item, "dc:creator"),
    });
  }
  return items;
}

function parseAtom(xml: string, maxItems: number): FeedItem[] {
  const entryPattern = /<entry>([\s\S]*?)<\/entry>/gi;
  const items: FeedItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = entryPattern.exec(xml)) !== null && items.length < maxItems) {
    const entry = m[1]!;
    const link = extractAttr(entry, "link", "href") || extractTag(entry, "link");
    items.push({
      title:   extractTag(entry, "title"),
      link:    link.trim(),
      date:    extractTag(entry, "published") || extractTag(entry, "updated"),
      summary: extractTag(entry, "summary") || extractTag(entry, "content"),
      author:  extractTag(entry, "name"),
    });
  }
  return items;
}

export function getRssTools(): RssTool[] {
  return [

    {
      definition: {
        type: "function",
        function: {
          name: "rss_feed_read",
          description: "Fetch and parse an RSS 2.0 or Atom feed URL. Returns a list of feed items with title, link, publication date, and summary. Use for monitoring blog posts, news, release announcements, GitHub releases, Reddit feeds, podcast episodes, or any RSS/Atom-based content.",
          parameters: {
            type: "object",
            properties: {
              url:          { type: "string",  description: "URL of the RSS or Atom feed" },
              max_items:    { type: "number",  description: "Maximum items to return (default: 10, max: 50)" },
              include_summary: { type: "boolean", description: "Include full summary/description text (default: true — set false for titles-only)" },
            },
            required: ["url"],
          },
        },
      },
      async execute(args) {
        const url      = str(args["url"]);
        const maxItems = Math.min(typeof args["max_items"] === "number" ? args["max_items"] : 10, 50);
        const inclSummary = args["include_summary"] !== false;
        if (!url.startsWith("http")) return "Error: valid feed URL required";

        let xml: string;
        try {
          const res = await fetch(url, {
            headers: { "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*", "User-Agent": "VIBA-Agent/1.0" },
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) return `Failed to fetch feed: HTTP ${res.status}`;
          xml = await res.text();
        } catch (err) {
          return `Feed fetch failed: ${err instanceof Error ? err.message : String(err)}`;
        }

        // Detect feed type
        const isAtom = /<feed[^>]*xmlns[^>]*atom/i.test(xml) || xml.includes("<entry>");
        const items  = isAtom ? parseAtom(xml, maxItems) : parseRss2(xml, maxItems);

        if (items.length === 0) return "No items found in feed. The URL may not be a valid RSS/Atom feed.";

        // Extract feed-level metadata
        const feedTitle = extractTag(xml, "title");
        const feedDesc  = extractTag(xml, "description") || extractTag(xml, "subtitle");

        const lines: string[] = [
          `Feed: ${feedTitle || url}`,
          feedDesc ? `Description: ${feedDesc.slice(0, 120)}` : "",
          `Type: ${isAtom ? "Atom" : "RSS 2.0"} | Items: ${items.length}`,
          "",
        ];

        for (let i = 0; i < items.length; i++) {
          const item = items[i]!;
          lines.push(`${i + 1}. ${item.title || "(no title)"}`);
          if (item.link)   lines.push(`   Link:   ${item.link}`);
          if (item.date)   lines.push(`   Date:   ${item.date}`);
          if (item.author) lines.push(`   Author: ${item.author}`);
          if (inclSummary && item.summary) {
            const summary = item.summary.replace(/\s+/g, " ").trim().slice(0, 200);
            lines.push(`   Summary: ${summary}${item.summary.length > 200 ? "…" : ""}`);
          }
          lines.push("");
        }

        return lines.filter((l, i) => !(i === 1 && l === "")).join("\n").trimEnd();
      },
    },

  ];
}
