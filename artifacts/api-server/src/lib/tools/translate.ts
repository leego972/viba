/**
 * text_translate — translate text to any language using Groq (free).
 * Falls back to MyMemory free API if GROQ_API_KEY is not set.
 */

export interface TranslateTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }

async function translateWithGroq(text: string, targetLang: string, sourceLang?: string): Promise<string> {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) throw new Error("no groq key");
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1", timeout: 20_000 });
  const from = sourceLang ? `from ${sourceLang} ` : "";
  const res = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 2048,
    temperature: 0.1,
    messages: [
      { role: "system", content: `You are a professional translator. Translate text ${from}to ${targetLang}. Output ONLY the translated text with no explanation, no quotes, no preamble.` },
      { role: "user", content: text },
    ],
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}

async function translateWithMyMemory(text: string, targetLang: string, sourceLang = "en"): Promise<string> {
  const langPair = `${sourceLang}|${targetLang}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${langPair}`;
  const res = await fetch(url, { headers: { "User-Agent": "VIBA-Agent/1.0" } });
  const data = await res.json() as { responseStatus: number; responseData?: { translatedText?: string } };
  if (data.responseStatus === 200 && data.responseData?.translatedText) {
    return data.responseData.translatedText;
  }
  throw new Error(`MyMemory API error: ${data.responseStatus}`);
}

export function getTranslateTools(): TranslateTool[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "text_translate",
          description: "Translate text from one language to another. Use for localising content, communicating in different languages, or translating research materials. Supports all major languages.",
          parameters: {
            type: "object",
            properties: {
              text: { type: "string", description: "Text to translate" },
              target_language: { type: "string", description: "Target language name or code (e.g. 'French', 'Spanish', 'Japanese', 'fr', 'es', 'ja')" },
              source_language: { type: "string", description: "Source language (optional — auto-detected if omitted)" },
            },
            required: ["text", "target_language"],
          },
        },
      },
      async execute(args) {
        const text = str(args["text"]);
        const targetLang = str(args["target_language"]);
        const sourceLang = str(args["source_language"]) || undefined;
        if (!text || !targetLang) return "Error: text and target_language are required";
        if (text.length > 4000) return "Error: text is too long (max 4000 chars). Split into chunks.";
        try {
          const translated = await translateWithGroq(text, targetLang, sourceLang);
          return `Translation (→ ${targetLang}):\n${translated}`;
        } catch {
          try {
            const langCode = targetLang.length === 2 ? targetLang : targetLang.slice(0, 2).toLowerCase();
            const translated = await translateWithMyMemory(text, langCode, sourceLang?.slice(0, 2).toLowerCase());
            return `Translation (→ ${targetLang}):\n${translated}`;
          } catch (err2) {
            return `Translation failed: ${err2 instanceof Error ? err2.message : String(err2)}`;
          }
        }
      },
    },
  ];
}
