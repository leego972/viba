/**
 * VIBA Utility Tools
 *
 * hash_text           — compute SHA-256/MD5/SHA-512 of any string
 * base64_encode       — encode text to Base64
 * base64_decode       — decode Base64 to text
 * jwt_decode          — decode a JWT (header + payload — never verifies signature)
 * uuid_generate       — generate a v4 UUID
 * regex_test          — test a regex pattern against text, return matches
 * json_validate       — validate JSON text, optionally check required keys
 * csv_parse           — parse CSV string into a JSON array of objects
 * markdown_to_html    — convert Markdown to HTML
 * qr_code_generate    — generate a QR code image URL for any text
 * calendar_event_create — produce an iCal (.ics) event string (RFC 5545)
 */

import crypto from "node:crypto";

export interface UtilsTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }
function num(v: unknown, fb: number): number { return typeof v === "number" ? v : fb; }

// ── Markdown → HTML ──────────────────────────────────────────────────────────
function markdownToHtml(md: string): string {
  let html = md
    // Escape HTML entities (prevent XSS in output)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // Fenced code blocks (``` lang\n...\n```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code${lang ? ` class="language-${lang}"` : ""}>${code.trimEnd()}</code></pre>`)
    // Headings
    .replace(/^######\s+(.+)$/gm, "<h6>$1</h6>")
    .replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>")
    .replace(/^####\s+(.+)$/gm, "<h4>$1</h4>")
    .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
    .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
    .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")
    // Blockquotes
    .replace(/^>\s+(.+)$/gm, "<blockquote>$1</blockquote>")
    // Horizontal rules
    .replace(/^(?:---|\*\*\*|___)\s*$/gm, "<hr>")
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    // Strikethrough
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Images (before links)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Unordered lists
  const ulBlock = (block: string): string =>
    "<ul>" + block.replace(/^[-*+]\s+(.+)$/gm, "<li>$1</li>") + "</ul>";
  html = html.replace(/((?:^[-*+]\s+.+$\n?)+)/gm, (m) => ulBlock(m.trimEnd()));

  // Ordered lists
  const olBlock = (block: string): string =>
    "<ol>" + block.replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>") + "</ol>";
  html = html.replace(/((?:^\d+\.\s+.+$\n?)+)/gm, (m) => olBlock(m.trimEnd()));

  // Paragraphs (lines not already wrapped in block tags)
  html = html.split("\n\n").map((para) => {
    const trimmed = para.trim();
    if (!trimmed) return "";
    if (/^<(h[1-6]|ul|ol|pre|blockquote|hr|p)/.test(trimmed)) return trimmed;
    return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
  }).join("\n");

  return html;
}

// ── Cron next-run calculator ─────────────────────────────────────────────────
function cronNext(expression: string, count: number): Date[] {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron expression must have 5 fields: minute hour day month weekday");
  const [minExpr, hrExpr, domExpr, monExpr, dowExpr] = parts;

  function parseField(expr: string, min: number, max: number): Set<number> {
    const result = new Set<number>();
    for (const part of expr!.split(",")) {
      if (part === "*") { for (let i = min; i <= max; i++) result.add(i); continue; }
      const stepMatch = part.match(/^(\*|\d+)-?(\d+)?\/(\d+)$/);
      if (stepMatch) {
        const start = stepMatch[1] === "*" ? min : parseInt(stepMatch[1]!);
        const end = stepMatch[2] ? parseInt(stepMatch[2]!) : max;
        const step = parseInt(stepMatch[3]!);
        for (let i = start; i <= end; i += step) result.add(i);
        continue;
      }
      const rangeMatch = part.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        for (let i = parseInt(rangeMatch[1]!); i <= parseInt(rangeMatch[2]!); i++) result.add(i);
        continue;
      }
      const n = parseInt(part);
      if (!isNaN(n) && n >= min && n <= max) result.add(n);
    }
    return result;
  }

  const minutes  = parseField(minExpr!,  0, 59);
  const hours    = parseField(hrExpr!,   0, 23);
  const days     = parseField(domExpr!,  1, 31);
  const months   = parseField(monExpr!,  1, 12);
  const weekdays = parseField(dowExpr!,  0,  6);
  const domStar  = domExpr === "*";
  const dowStar  = dowExpr === "*";

  const results: Date[] = [];
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // start from next minute

  let iterations = 0;
  while (results.length < count && iterations < 100_000) {
    iterations++;
    const mo = d.getMonth() + 1;
    const dy = d.getDate();
    const dw = d.getDay();
    const hr = d.getHours();
    const mn = d.getMinutes();

    if (!months.has(mo))    { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0); continue; }

    const domOk = days.has(dy);
    const dowOk = weekdays.has(dw);
    const dayOk = domStar && dowStar ? domOk : (!domStar && !dowStar ? domOk || dowOk : (!domStar ? domOk : dowOk));
    if (!dayOk)              { d.setDate(d.getDate() + 1); d.setHours(0, 0); continue; }
    if (!hours.has(hr))      { d.setHours(d.getHours() + 1, 0); continue; }
    if (!minutes.has(mn))    { d.setMinutes(d.getMinutes() + 1); continue; }

    results.push(new Date(d));
    d.setMinutes(d.getMinutes() + 1);
  }
  return results;
}

export function getUtilsTools(): UtilsTool[] {
  return [

    // ── hash_text ─────────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "hash_text",
          description: "Compute a cryptographic hash of any text. Supports SHA-256, SHA-512, SHA-1, and MD5. Use for checksums, content fingerprinting, password hashing verification, or integrity checks.",
          parameters: {
            type: "object",
            properties: {
              text: { type: "string", description: "Text to hash" },
              algorithm: { type: "string", enum: ["sha256", "sha512", "sha1", "md5"], description: "Hash algorithm (default: sha256)" },
              encoding: { type: "string", enum: ["hex", "base64"], description: "Output encoding (default: hex)" },
            },
            required: ["text"],
          },
        },
      },
      async execute(args) {
        const text = str(args["text"]);
        const algo = str(args["algorithm"], "sha256");
        const enc = str(args["encoding"], "hex") as "hex" | "base64";
        if (!text) return "Error: text is required";
        const hash = crypto.createHash(algo).update(text, "utf8").digest(enc);
        return `${algo.toUpperCase()} (${enc}): ${hash}\nInput length: ${text.length} chars`;
      },
    },

    // ── base64_encode ─────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "base64_encode",
          description: "Encode text or binary data to Base64. Useful for embedding data in URLs, JSON payloads, or HTTP headers.",
          parameters: {
            type: "object",
            properties: {
              text: { type: "string", description: "Text to encode" },
              url_safe: { type: "boolean", description: "Use URL-safe Base64 (replace +/ with -_)" },
            },
            required: ["text"],
          },
        },
      },
      async execute(args) {
        const text = str(args["text"]);
        if (!text) return "Error: text is required";
        let encoded = Buffer.from(text, "utf8").toString("base64");
        if (args["url_safe"]) encoded = encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
        return `Base64${args["url_safe"] ? " (URL-safe)" : ""}:\n${encoded}\n\nDecoded length: ${text.length} chars → encoded ${encoded.length} chars`;
      },
    },

    // ── base64_decode ─────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "base64_decode",
          description: "Decode a Base64 string back to text. Handles both standard and URL-safe Base64.",
          parameters: {
            type: "object",
            properties: {
              encoded: { type: "string", description: "Base64 string to decode" },
            },
            required: ["encoded"],
          },
        },
      },
      async execute(args) {
        const encoded = str(args["encoded"]).replace(/-/g, "+").replace(/_/g, "/");
        if (!encoded) return "Error: encoded string is required";
        try {
          const decoded = Buffer.from(encoded, "base64").toString("utf8");
          return `Decoded (${decoded.length} chars):\n${decoded.slice(0, 4000)}${decoded.length > 4000 ? "\n...[truncated]" : ""}`;
        } catch {
          return "Error: invalid Base64 input";
        }
      },
    },

    // ── jwt_decode ────────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "jwt_decode",
          description: "Decode and inspect a JWT token — returns the header and payload as readable JSON. Does NOT verify the signature. Use for debugging auth tokens, checking expiry, inspecting claims, or auditing token contents.",
          parameters: {
            type: "object",
            properties: {
              token: { type: "string", description: "JWT token (three base64url parts separated by dots)" },
            },
            required: ["token"],
          },
        },
      },
      async execute(args) {
        const token = str(args["token"]).trim();
        if (!token) return "Error: token is required";
        const parts = token.split(".");
        if (parts.length !== 3) return "Error: not a valid JWT — expected 3 dot-separated parts";
        try {
          const decode = (s: string) => JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as unknown;
          const header  = decode(parts[0]!) as Record<string, unknown>;
          const payload = decode(parts[1]!) as Record<string, unknown>;

          const now = Math.floor(Date.now() / 1000);
          const exp = typeof payload["exp"] === "number" ? payload["exp"] : null;
          const iat = typeof payload["iat"] === "number" ? payload["iat"] : null;
          const nbf = typeof payload["nbf"] === "number" ? payload["nbf"] : null;

          const lines = [
            "JWT Token Inspection",
            `Signature: NOT VERIFIED (decode only)`,
            "",
            "─── Header ────────────────────────────",
            JSON.stringify(header, null, 2),
            "",
            "─── Payload ───────────────────────────",
            JSON.stringify(payload, null, 2),
            "",
            "─── Timing ────────────────────────────",
            iat  ? `Issued:   ${new Date(iat * 1000).toISOString()}` : "",
            nbf  ? `Not before: ${new Date(nbf * 1000).toISOString()}` : "",
            exp  ? `Expires:  ${new Date(exp * 1000).toISOString()} — ${exp < now ? "⚠️ EXPIRED" : `valid for ${Math.floor((exp - now) / 60)} more minutes`}` : "Expiry:   none (no exp claim)",
          ].filter(l => l !== "");
          return lines.join("\n");
        } catch {
          return "Error: could not decode JWT — payload is not valid JSON";
        }
      },
    },

    // ── uuid_generate ─────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "uuid_generate",
          description: "Generate one or more cryptographically random UUID v4 values. Use for creating unique IDs, correlation tokens, idempotency keys, or test fixtures.",
          parameters: {
            type: "object",
            properties: {
              count: { type: "number", description: "Number of UUIDs to generate (default: 1, max: 50)" },
              format: { type: "string", enum: ["hyphenated", "compact", "uppercase"], description: "Output format (default: hyphenated)" },
            },
          },
        },
      },
      async execute(args) {
        const count = Math.min(Math.max(1, num(args["count"], 1)), 50);
        const format = str(args["format"], "hyphenated");
        const uuids = Array.from({ length: count }, () => {
          const id = crypto.randomUUID();
          if (format === "compact")   return id.replace(/-/g, "");
          if (format === "uppercase") return id.toUpperCase();
          return id;
        });
        return uuids.length === 1 ? uuids[0]! : uuids.join("\n");
      },
    },

    // ── regex_test ────────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "regex_test",
          description: "Test a regular expression against text. Returns whether it matches, all captured groups, and all matches if global flag is set. Use for pattern validation, text extraction, or content filtering.",
          parameters: {
            type: "object",
            properties: {
              pattern: { type: "string", description: "Regular expression pattern (without slashes)" },
              text: { type: "string", description: "Text to test the pattern against" },
              flags: { type: "string", description: "Regex flags (e.g. 'gi' for global case-insensitive). Default: empty" },
              max_matches: { type: "number", description: "Max matches to return when using global flag (default: 20)" },
            },
            required: ["pattern", "text"],
          },
        },
      },
      async execute(args) {
        const pattern = str(args["pattern"]);
        const text    = str(args["text"]);
        const flags   = str(args["flags"], "");
        const maxM    = Math.min(num(args["max_matches"], 20), 100);
        if (!pattern) return "Error: pattern is required";
        let regex: RegExp;
        try { regex = new RegExp(pattern, flags); } catch (e) { return `Invalid regex: ${e instanceof Error ? e.message : String(e)}`; }

        if (flags.includes("g")) {
          const matches: string[] = [];
          let m: RegExpExecArray | null;
          while ((m = regex.exec(text)) !== null && matches.length < maxM) {
            matches.push(m[0]!);
            if (!flags.includes("g")) break;
          }
          return matches.length
            ? `Found ${matches.length} match(es):\n${matches.map((m, i) => `  ${i + 1}. ${JSON.stringify(m)}`).join("\n")}`
            : "No matches found.";
        }

        const m = regex.exec(text);
        if (!m) return "No match found.";
        const lines = [`✅ Match found at index ${m.index}: ${JSON.stringify(m[0])}`];
        if (m.length > 1) {
          lines.push("Groups:");
          for (let i = 1; i < m.length; i++) lines.push(`  [${i}]: ${JSON.stringify(m[i])}`);
        }
        return lines.join("\n");
      },
    },

    // ── json_validate ─────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "json_validate",
          description: "Validate that a string is valid JSON. Optionally check for required top-level keys and report their types. Returns a formatted preview of the structure.",
          parameters: {
            type: "object",
            properties: {
              text: { type: "string", description: "String to validate as JSON" },
              required_keys: { type: "array", items: { type: "string" }, description: "Top-level keys that must be present" },
            },
            required: ["text"],
          },
        },
      },
      async execute(args) {
        const text = str(args["text"]);
        if (!text) return "Error: text is required";
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch (e) { return `❌ Invalid JSON: ${e instanceof Error ? e.message : String(e)}`; }

        const lines = [`✅ Valid JSON`, `Type: ${Array.isArray(parsed) ? "array" : typeof parsed}`];
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          const obj = parsed as Record<string, unknown>;
          lines.push(`Keys (${Object.keys(obj).length}): ${Object.keys(obj).join(", ")}`);
          const required = Array.isArray(args["required_keys"]) ? (args["required_keys"] as string[]) : [];
          for (const k of required) {
            lines.push(`  ${k}: ${k in obj ? `✅ present (${typeof obj[k]})` : "❌ MISSING"}`);
          }
        } else if (Array.isArray(parsed)) {
          lines.push(`Length: ${(parsed as unknown[]).length} items`);
        }
        const preview = JSON.stringify(parsed, null, 2).slice(0, 1000);
        lines.push("", "Preview:", preview + (JSON.stringify(parsed).length > 1000 ? "\n... [truncated]" : ""));
        return lines.join("\n");
      },
    },

    // ── csv_parse ─────────────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "csv_parse",
          description: "Parse a CSV string into a JSON array of objects. The first row is treated as headers. Handles quoted fields, commas within quotes, and empty values. Returns the parsed data as JSON.",
          parameters: {
            type: "object",
            properties: {
              csv: { type: "string", description: "CSV text to parse" },
              delimiter: { type: "string", description: "Field delimiter (default: comma). Use \\t for TSV." },
              max_rows: { type: "number", description: "Maximum rows to return (default: 100)" },
            },
            required: ["csv"],
          },
        },
      },
      async execute(args) {
        const csv = str(args["csv"]);
        const delim = str(args["delimiter"], ",") === "\\t" ? "\t" : str(args["delimiter"], ",");
        const maxRows = Math.min(num(args["max_rows"], 100), 500);
        if (!csv) return "Error: csv text is required";

        function parseRow(line: string): string[] {
          const fields: string[] = [];
          let field = "";
          let inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i]!;
            if (ch === '"') {
              if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
              else inQuotes = !inQuotes;
            } else if (ch === delim && !inQuotes) {
              fields.push(field.trim()); field = "";
            } else {
              field += ch;
            }
          }
          fields.push(field.trim());
          return fields;
        }

        const lines = csv.trim().split(/\r?\n/);
        if (lines.length < 2) return "Error: CSV must have at least a header row and one data row";
        const headers = parseRow(lines[0]!);
        const rows: Record<string, string>[] = [];
        for (let i = 1; i < Math.min(lines.length, maxRows + 1); i++) {
          const values = parseRow(lines[i]!);
          const row: Record<string, string> = {};
          headers.forEach((h, j) => { row[h] = values[j] ?? ""; });
          rows.push(row);
        }
        const json = JSON.stringify(rows, null, 2);
        return [
          `CSV parsed: ${rows.length} rows, ${headers.length} columns`,
          `Headers: ${headers.join(", ")}`,
          lines.length > maxRows + 1 ? `(showing first ${maxRows} of ${lines.length - 1} total rows)` : "",
          "",
          json.slice(0, 4000) + (json.length > 4000 ? "\n...[truncated]" : ""),
        ].filter(Boolean).join("\n");
      },
    },

    // ── markdown_to_html ──────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "markdown_to_html",
          description: "Convert Markdown text to HTML. Supports headings (H1-H6), bold, italic, strikethrough, inline code, code blocks with language hints, links, images, ordered/unordered lists, blockquotes, and horizontal rules.",
          parameters: {
            type: "object",
            properties: {
              markdown: { type: "string", description: "Markdown text to convert" },
              wrap_body: { type: "boolean", description: "Wrap output in a full HTML document with <html><body> tags (default: false — returns fragment only)" },
            },
            required: ["markdown"],
          },
        },
      },
      async execute(args) {
        const md = str(args["markdown"]);
        if (!md) return "Error: markdown text is required";
        const fragment = markdownToHtml(md);
        if (args["wrap_body"]) {
          return `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8"><title>Document</title></head>\n<body>\n${fragment}\n</body>\n</html>`;
        }
        return fragment;
      },
    },

    // ── qr_code_generate ──────────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "qr_code_generate",
          description: "Generate a QR code for any text, URL, or data. Returns a direct image URL that can be embedded in web pages or documents.",
          parameters: {
            type: "object",
            properties: {
              data: { type: "string", description: "Text, URL, or data to encode in the QR code" },
              size: { type: "number", description: "Image size in pixels (width & height, default: 300, max: 1000)" },
              error_correction: { type: "string", enum: ["L", "M", "Q", "H"], description: "Error correction level — L=7%, M=15%, Q=25%, H=30% (default: M)" },
              format: { type: "string", enum: ["png", "svg"], description: "Image format (default: png)" },
            },
            required: ["data"],
          },
        },
      },
      async execute(args) {
        const data = str(args["data"]);
        if (!data) return "Error: data is required";
        const size   = Math.min(Math.max(100, num(args["size"], 300)), 1000);
        const ecc    = str(args["error_correction"], "M");
        const format = str(args["format"], "png");
        const encoded = encodeURIComponent(data);
        const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&ecc=${ecc}&format=${format}&data=${encoded}`;
        // Verify the URL is reachable
        try {
          const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
          return `QR code URL generated (could not verify): ${url}\nError: ${e instanceof Error ? e.message : String(e)}`;
        }
        return [
          `QR Code generated for: ${data.slice(0, 80)}${data.length > 80 ? "…" : ""}`,
          `Image URL: ${url}`,
          `Size: ${size}×${size}px | Format: ${format.toUpperCase()} | Error correction: ${ecc}`,
          "",
          `Embed in HTML: <img src="${url}" alt="QR code" width="${size}" height="${size}">`,
        ].join("\n");
      },
    },

    // ── calendar_event_create ─────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "calendar_event_create",
          description: "Generate an iCal (.ics) calendar event string (RFC 5545). The output can be saved as a .ics file or sent in an email for users to add to their calendars. Supports single events with title, start/end time, description, location, and optional organizer.",
          parameters: {
            type: "object",
            properties: {
              title:       { type: "string", description: "Event title" },
              start:       { type: "string", description: "Start datetime in ISO 8601 format (e.g. 2026-08-15T14:00:00)" },
              end:         { type: "string", description: "End datetime in ISO 8601 format" },
              description: { type: "string", description: "Event description (optional)" },
              location:    { type: "string", description: "Physical or virtual location (optional)" },
              organizer_name:  { type: "string", description: "Organizer name (optional)" },
              organizer_email: { type: "string", description: "Organizer email (optional)" },
              timezone:    { type: "string", description: "IANA timezone name (e.g. America/New_York). Default: UTC" },
            },
            required: ["title", "start", "end"],
          },
        },
      },
      async execute(args) {
        const title  = str(args["title"]);
        const start  = str(args["start"]);
        const end    = str(args["end"]);
        if (!title || !start || !end) return "Error: title, start, and end are required";

        const toIcalDate = (iso: string): string => {
          const d = new Date(iso);
          if (isNaN(d.getTime())) throw new Error(`Invalid date: ${iso}`);
          return d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
        };

        try {
          const dtStart = toIcalDate(start);
          const dtEnd   = toIcalDate(end);
          const uid = `${crypto.randomUUID()}@viba.guru`;
          const now = toIcalDate(new Date().toISOString());
          const desc = str(args["description"]).replace(/\n/g, "\\n");
          const loc  = str(args["location"]);
          const orgName  = str(args["organizer_name"]);
          const orgEmail = str(args["organizer_email"]);

          const lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//VIBA//CalendarTool//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:REQUEST",
            "BEGIN:VEVENT",
            `UID:${uid}`,
            `DTSTAMP:${now}`,
            `DTSTART:${dtStart}`,
            `DTEND:${dtEnd}`,
            `SUMMARY:${title}`,
            desc ? `DESCRIPTION:${desc}` : "",
            loc  ? `LOCATION:${loc}` : "",
            orgName && orgEmail ? `ORGANIZER;CN=${orgName}:mailto:${orgEmail}` : "",
            "STATUS:CONFIRMED",
            "END:VEVENT",
            "END:VCALENDAR",
          ].filter(Boolean);

          return [
            `iCal event created: ${title}`,
            `Start: ${new Date(start).toLocaleString()} → End: ${new Date(end).toLocaleString()}`,
            "",
            "─── .ics content ──────────────────────",
            lines.join("\r\n"),
          ].join("\n");
        } catch (e) {
          return `Error creating event: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    },

  ];
}
