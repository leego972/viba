/**
 * VIBA Inference Tools
 *
 * generate_text — call Groq's LLM API directly to generate text, summarise content,
 *                 answer questions, or run focused sub-reasoning tasks from within
 *                 an agent's tool loop. Powered by the free GROQ_API_KEY.
 */

export interface InferenceTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }
function num(v: unknown, fb: number): number { return typeof v === "number" ? v : fb; }

export function getInferenceTools(): InferenceTool[] {
  return [

    {
      definition: {
        type: "function",
        function: {
          name: "generate_text",
          description: "Use an LLM to generate text, answer questions, summarise documents, translate content, rewrite text, or perform any language task. Backed by Groq (free tier, very fast). Use this when you need focused reasoning on a specific sub-problem without changing your own context: e.g. 'summarise this document', 'extract the key points', 'write a commit message for these changes', 'classify this text', 'translate to French'.",
          parameters: {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                description: "The user message / task to complete. Be specific and include all relevant context.",
              },
              system_prompt: {
                type: "string",
                description: "Optional system/role instructions for the model (e.g. 'You are a technical writer. Be concise.'). Default: general assistant.",
              },
              model: {
                type: "string",
                enum: [
                  "llama-3.3-70b-versatile",
                  "llama-3.1-8b-instant",
                  "mixtral-8x7b-32768",
                  "gemma2-9b-it",
                  "llama3-70b-8192",
                ],
                description: "Model to use (default: llama-3.3-70b-versatile — best quality; use llama-3.1-8b-instant for speed).",
              },
              temperature: {
                type: "number",
                description: "Sampling temperature 0.0-1.0 (default: 0.3 — balanced; use 0.0 for deterministic, 0.8+ for creative).",
              },
              max_tokens: {
                type: "number",
                description: "Maximum tokens in the response (default: 1024, max: 4096).",
              },
              json_mode: {
                type: "boolean",
                description: "Request a JSON-formatted response (default: false). When true, include 'respond in JSON' in your prompt.",
              },
            },
            required: ["prompt"],
          },
        },
      },
      async execute(args) {
        const apiKey = process.env["GROQ_API_KEY"];
        if (!apiKey) return "Error: GROQ_API_KEY is not set — cannot use generate_text tool.";

        const prompt      = str(args["prompt"]);
        const systemPrompt = str(args["system_prompt"], "You are a helpful, accurate, and concise AI assistant.");
        const model       = str(args["model"], "llama-3.3-70b-versatile");
        const temperature = Math.min(Math.max(num(args["temperature"], 0.3), 0), 1);
        const maxTokens   = Math.min(Math.max(num(args["max_tokens"], 1024), 64), 4096);
        const jsonMode    = args["json_mode"] === true;

        if (!prompt) return "Error: prompt is required";

        const body: Record<string, unknown> = {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: prompt },
          ],
          temperature,
          max_tokens: maxTokens,
          stream: false,
        };
        if (jsonMode) body["response_format"] = { type: "json_object" };

        try {
          const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(45_000),
          });

          if (!res.ok) {
            const errText = await res.text();
            return `Groq API error: HTTP ${res.status} — ${errText.slice(0, 300)}`;
          }

          const data = await res.json() as {
            choices: Array<{ message: { content: string }; finish_reason: string }>;
            usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
          };

          const content     = data.choices[0]?.message.content ?? "";
          const finishReason = data.choices[0]?.finish_reason ?? "unknown";
          const usage       = data.usage;

          const lines = [
            content,
            "",
            `─── Generation info ────────────────────────`,
            `Model:  ${model}`,
            `Tokens: ${usage?.prompt_tokens ?? "?"} prompt + ${usage?.completion_tokens ?? "?"} completion = ${usage?.total_tokens ?? "?"} total`,
            finishReason !== "stop" ? `Finish: ${finishReason} ⚠️` : "",
          ].filter(l => l !== "");

          return lines.join("\n");
        } catch (err) {
          return `generate_text failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

  ];
}
