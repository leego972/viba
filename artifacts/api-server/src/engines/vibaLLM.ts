import { logger } from "../lib/logger";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = process.env["GROQ_MODEL"] ?? "llama-3.3-70b-versatile";

export async function invokeLLM(prompt: string, systemPrompt?: string): Promise<string> {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) {
    logger.warn("[vibaLLM] GROQ_API_KEY not set — returning stub response");
    return `[Simulated response for: ${prompt.slice(0, 80)}]`;
  }

  const messages: { role: string; content: string }[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  try {
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Groq API error ${res.status}: ${err}`);
    }

    const data = await res.json() as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content ?? "";
  } catch (err) {
    logger.error(`[vibaLLM] LLM call failed: ${String(err)}`);
    throw err;
  }
}

export function safeJsonExtract(text: string): unknown {
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fenceMatch ? fenceMatch[1] : text;
  const objMatch = /(\{[\s\S]*\}|\[[\s\S]*\])/.exec(raw ?? "");
  if (!objMatch) return null;
  try { return JSON.parse(objMatch[1]); } catch { return null; }
}
