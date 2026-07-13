/**
 * Agent memory tools — in-session key-value store.
 * Agents can store facts, decisions, and context mid-session and recall them later.
 * Storage is scoped per session_id and lives in process memory (fast, no DB overhead).
 */

export interface MemoryTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }

const store = new Map<string, Map<string, string>>();

function getSession(sessionId: string): Map<string, string> {
  let s = store.get(sessionId);
  if (!s) { s = new Map(); store.set(sessionId, s); }
  return s;
}

export function getMemoryTools(): MemoryTool[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "memory_store",
          description: "Store a fact, decision, or piece of information in agent memory under a named key. Other agents in the same session can recall it. Use this to persist decisions, extracted data, or context that future tasks need.",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "string", description: "Session identifier (use the current VIBA session ID to share memory across agents)" },
              key: { type: "string", description: "Memory key — short, descriptive name (e.g. 'user_goal', 'api_token', 'chosen_framework')" },
              value: { type: "string", description: "The value to store (text, JSON string, decision outcome, etc.)" },
            },
            required: ["session_id", "key", "value"],
          },
        },
      },
      async execute(args) {
        const sid = str(args["session_id"]); const key = str(args["key"]); const value = str(args["value"]);
        if (!sid || !key) return "Error: session_id and key are required";
        getSession(sid).set(key, value);
        return `Stored "${key}" in session ${sid}`;
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "memory_recall",
          description: "Retrieve a value previously stored in agent memory. Returns all keys if no key is specified. Use this to access decisions or context stored by earlier agents in the session.",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "string", description: "Session identifier" },
              key: { type: "string", description: "Key to retrieve. Omit to list all stored keys and values." },
            },
            required: ["session_id"],
          },
        },
      },
      async execute(args) {
        const sid = str(args["session_id"]); const key = str(args["key"]);
        if (!sid) return "Error: session_id is required";
        const s = getSession(sid);
        if (key) {
          const v = s.get(key);
          return v !== undefined ? `${key}: ${v}` : `No memory found for key "${key}" in session ${sid}`;
        }
        if (s.size === 0) return `No memory stored for session ${sid} yet.`;
        return `Session ${sid} memory (${s.size} entries):\n` + [...s.entries()].map(([k, v]) => `  ${k}: ${v}`).join("\n");
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "memory_clear",
          description: "Delete a specific key from agent memory, or clear all memory for the session.",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "string", description: "Session identifier" },
              key: { type: "string", description: "Key to delete. Omit to clear all memory for this session." },
            },
            required: ["session_id"],
          },
        },
      },
      async execute(args) {
        const sid = str(args["session_id"]); const key = str(args["key"]);
        if (!sid) return "Error: session_id is required";
        const s = getSession(sid);
        if (key) {
          s.delete(key);
          return `Deleted key "${key}" from session ${sid}`;
        }
        s.clear();
        return `Cleared all memory for session ${sid}`;
      },
    },
  ];
}
