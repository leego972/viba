/**
 * file_write / file_read / file_list — temporary file workspace for agents.
 * Files are stored in /tmp/viba-workspace/ and persist for the process lifetime.
 * Agents can create reports, scripts, data files, and pass them between tasks.
 */

import fs from "node:fs/promises";
import path from "node:path";

export interface FilestoreTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }

const WORKSPACE = "/tmp/viba-workspace";

async function ensureWorkspace() {
  await fs.mkdir(WORKSPACE, { recursive: true });
}

function safePath(filename: string): string {
  const safe = path.basename(filename.replace(/\.\./g, "")).replace(/[^a-zA-Z0-9._\-]/g, "_");
  if (!safe) throw new Error("Invalid filename");
  return path.join(WORKSPACE, safe);
}

export function getFilestoreTools(): FilestoreTool[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "file_write",
          description: "Write content to a file in the agent workspace. Use for saving reports, generated code, data exports, markdown documents, or any text content that other agents or tasks need to access. Files persist for the session.",
          parameters: {
            type: "object",
            properties: {
              filename: { type: "string", description: "Filename (e.g. 'report.md', 'analysis.json', 'script.js'). No path separators." },
              content: { type: "string", description: "File content to write" },
              append: { type: "boolean", description: "Append to existing file instead of overwriting (default: false)" },
            },
            required: ["filename", "content"],
          },
        },
      },
      async execute(args) {
        const filename = str(args["filename"]);
        const content = str(args["content"]);
        if (!filename || !content) return "Error: filename and content are required";
        await ensureWorkspace();
        const filepath = safePath(filename);
        if (args["append"] === true) {
          await fs.appendFile(filepath, content, "utf8");
        } else {
          await fs.writeFile(filepath, content, "utf8");
        }
        const size = Buffer.byteLength(content, "utf8");
        return `File written: ${filename} (${size} bytes) at ${filepath}`;
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "file_read",
          description: "Read the content of a file from the agent workspace. Use to access reports, data, or code written by earlier agents in the session.",
          parameters: {
            type: "object",
            properties: {
              filename: { type: "string", description: "Filename to read (e.g. 'report.md')" },
              max_chars: { type: "number", description: "Maximum characters to return (default 6000)" },
            },
            required: ["filename"],
          },
        },
      },
      async execute(args) {
        const filename = str(args["filename"]);
        if (!filename) return "Error: filename is required";
        const maxChars = typeof args["max_chars"] === "number" ? args["max_chars"] : 6000;
        try {
          const filepath = safePath(filename);
          const content = await fs.readFile(filepath, "utf8");
          const truncated = content.length > maxChars
            ? content.slice(0, maxChars) + `\n...[truncated ${content.length - maxChars} chars]`
            : content;
          return `File: ${filename} (${content.length} bytes)\n\n${truncated}`;
        } catch (err) {
          return `Error reading ${filename}: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "file_list",
          description: "List all files currently in the agent workspace. Shows filename, size, and last modified time.",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      },
      async execute(_args) {
        await ensureWorkspace();
        try {
          const entries = await fs.readdir(WORKSPACE, { withFileTypes: true });
          const files = entries.filter(e => e.isFile());
          if (files.length === 0) return "Agent workspace is empty — no files written yet.";
          const lines = await Promise.all(files.map(async (f) => {
            const stat = await fs.stat(path.join(WORKSPACE, f.name));
            return `  ${f.name} — ${stat.size} bytes, modified ${stat.mtime.toISOString()}`;
          }));
          return `Agent workspace (${files.length} files):\n${lines.join("\n")}`;
        } catch {
          return "Workspace is empty or inaccessible.";
        }
      },
    },
  ];
}
