/**
 * code_run — execute Node.js code in a sandboxed subprocess.
 * Use for computation, data transformation, JSON parsing, regex, math, etc.
 * Output is captured from stdout/stderr, capped at 4000 chars.
 */

import { spawn } from "node:child_process";

export interface SandboxTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }
function num(v: unknown, fb = 10_000): number { return typeof v === "number" ? v : fb; }

const BLOCKED = [
  "require('fs')", 'require("fs")', "require('child_process')", 'require("child_process")',
  "require('net')", "require('http')", "require('https')",
  "__dirname", "__filename", "process.exit", "process.env",
];

export function getSandboxTools(): SandboxTool[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "code_run",
          description: "Execute a Node.js code snippet safely and return its output. Use for: computing values, parsing/transforming JSON data, regex extraction, math calculations, sorting/filtering arrays, generating text programmatically. Output captured from console.log. No network, filesystem, or process access allowed.",
          parameters: {
            type: "object",
            properties: {
              code: { type: "string", description: "Node.js code to execute. Use console.log() to output results. Example: 'const data = [{a:1},{a:2}]; console.log(data.map(x=>x.a*2));'" },
              timeout_ms: { type: "number", description: "Max execution time in ms (default 10000, max 30000)" },
            },
            required: ["code"],
          },
        },
      },
      async execute(args) {
        const code = str(args["code"]);
        if (!code) return "Error: code is required";

        for (const blocked of BLOCKED) {
          if (code.includes(blocked)) return `Error: '${blocked}' is not allowed in sandboxed code`;
        }

        const timeout = Math.min(num(args["timeout_ms"], 10_000), 30_000);
        const wrapped = `
"use strict";
(async () => {
  try {
${code.split("\n").map(l => "    " + l).join("\n")}
  } catch(e) { console.error("Runtime error:", e.message); }
})();
`;

        return new Promise((resolve) => {
          let stdout = "";
          let stderr = "";
          const proc = spawn(process.execPath, ["-e", wrapped], {
            timeout,
            env: { PATH: process.env["PATH"] },
          });
          proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
          proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
          proc.on("close", (code) => {
            const output = [stdout, stderr].filter(Boolean).join("\n").trim();
            const truncated = output.length > 4000 ? output.slice(0, 4000) + "\n...[truncated]" : output;
            if (!truncated) {
              resolve(code === 0 ? "Code executed with no output." : `Process exited with code ${code}`);
            } else {
              resolve(truncated);
            }
          });
          proc.on("error", (e) => resolve(`Execution error: ${e.message}`));
        });
      },
    },
  ];
}
