/**
 * VIBA Vision Tools
 *
 * Image analysis using Groq's free vision model (llama-3.2-11b-vision-preview).
 * No external paid service — Groq is VIBA's free backbone.
 * Any agent can call these tools via the registry.
 *
 * Tools:
 *   vision_analyze_image    — describe/analyze an image (URL or base64 data URI)
 *   vision_compare_frames   — compare two frames, return differences
 *   vision_check_person     — check face, body type, wardrobe of a person in frame
 *   vision_check_background — check scene/location/background consistency
 */

import { logger } from "../logger";

export interface VisionTool {
  definition: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  execute(args: Record<string, unknown>): Promise<string>;
}

const GROQ_VISION_MODEL = "llama-3.2-11b-vision-preview";
const GROQ_BASE = "https://api.groq.com/openai/v1";

function getGroqKey(): string {
  const key = process.env["GROQ_API_KEY"] ?? "";
  if (!key) throw new Error("GROQ_API_KEY is required for vision tools");
  return key;
}

async function groqVision(prompt: string, imageUrl: string, systemPrompt?: string): Promise<string> {
  const key = getGroqKey();

  const messages: Array<{role: string; content: unknown}> = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({
    role: "user",
    content: [
      { type: "image_url", image_url: { url: imageUrl } },
      { type: "text", text: prompt },
    ],
  });

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: GROQ_VISION_MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Groq vision API error ${res.status}: ${err}`);
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "(no response)";
}

async function groqVisionMulti(prompt: string, imageUrls: string[], systemPrompt?: string): Promise<string> {
  const key = getGroqKey();

  const imageContent = imageUrls.slice(0, 4).map(url => ({
    type: "image_url" as const,
    image_url: { url },
  }));

  const messages: Array<{role: string; content: unknown}> = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({
    role: "user",
    content: [
      ...imageContent,
      { type: "text", text: prompt },
    ],
  });

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: GROQ_VISION_MODEL,
      messages,
      max_tokens: 1500,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Groq vision multi-image API error ${res.status}: ${err}`);
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "(no response)";
}

export function getVisionTools(): VisionTool[] {
  return [
    // ── vision_analyze_image ───────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "vision_analyze_image",
          description: "Analyze an image using Groq's free vision AI. Returns a detailed description. Accepts a public URL or base64 data URI (data:image/png;base64,...). Use for screenshots, film frames, storyboards.",
          parameters: {
            type: "object",
            properties: {
              image_url: { type: "string", description: "Public image URL or base64 data URI" },
              question: { type: "string", description: "What to analyze or look for (e.g. 'Describe this film frame in detail including characters, setting, lighting, and mood')" },
            },
            required: ["image_url", "question"],
          },
        },
      },
      async execute(args) {
        const imageUrl = String(args["image_url"] ?? "");
        const question = String(args["question"] ?? "Describe this image in detail.");
        try {
          const analysis = await groqVision(
            question,
            imageUrl,
            "You are a precise visual analyst. Be specific about colors, clothing details, facial features, lighting, and spatial relationships. Your analysis will be used for film production continuity checking."
          );
          logger.info({ model: GROQ_VISION_MODEL }, "vision_analyze_image complete");
          return JSON.stringify({ ok: true, analysis });
        } catch (err) {
          logger.warn({ err }, "vision_analyze_image failed");
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── vision_compare_frames ──────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "vision_compare_frames",
          description: "Compare two film frames or screenshots side by side. Returns a continuity analysis: what changed vs what stayed consistent. Essential for checking scene continuity in video production.",
          parameters: {
            type: "object",
            properties: {
              frame_a_url: { type: "string", description: "First frame — URL or base64 data URI" },
              frame_b_url: { type: "string", description: "Second frame — URL or base64 data URI" },
              focus: { type: "string", description: "What to compare: 'character' | 'wardrobe' | 'background' | 'lighting' | 'all' (default: 'all')" },
            },
            required: ["frame_a_url", "frame_b_url"],
          },
        },
      },
      async execute(args) {
        const frameA = String(args["frame_a_url"] ?? "");
        const frameB = String(args["frame_b_url"] ?? "");
        const focus = String(args["focus"] ?? "all");

        const focusInstructions: Record<string, string> = {
          character: "Focus specifically on: face identity, hair style/color, skin tone, body build.",
          wardrobe: "Focus specifically on: clothing items, colors, patterns, accessories, shoes.",
          background: "Focus specifically on: location, set dressing, props, time of day, weather.",
          lighting: "Focus specifically on: light direction, shadows, color temperature, exposure.",
          all: "Analyze all aspects: characters, wardrobe, background, lighting, props.",
        };

        const prompt = `Compare these two film frames for production continuity.
${focusInstructions[focus] ?? focusInstructions["all"]}

Provide your response as JSON with this exact structure:
{
  "consistent": ["list of things that match between frames"],
  "inconsistent": ["list of continuity errors or differences"],
  "severity": "none|minor|major|critical",
  "score": <0-100 where 100 is perfect continuity>,
  "notes": "overall summary"
}`;

        try {
          const raw = await groqVisionMulti(prompt, [frameA, frameB],
            "You are a film continuity supervisor. Be precise and critical. Continuity errors cost production money."
          );
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
          return JSON.stringify({ ok: true, ...parsed });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── vision_check_person ────────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "vision_check_person",
          description: "Extract a detailed character profile from a frame: face, body type, hair, wardrobe. Use this to build a reference baseline, then compare against later frames.",
          parameters: {
            type: "object",
            properties: {
              image_url: { type: "string", description: "Frame URL or base64 data URI" },
              character_name: { type: "string", description: "Character name (for labelling the result)" },
              is_reference: { type: "boolean", description: "True if this is the reference/canonical frame for this character" },
            },
            required: ["image_url"],
          },
        },
      },
      async execute(args) {
        const imageUrl = String(args["image_url"] ?? "");
        const characterName = String(args["character_name"] ?? "Unknown Character");
        const isReference = args["is_reference"] === true;

        const prompt = `Extract a detailed character profile from this frame for film continuity tracking.

Respond as JSON:
{
  "character_name": "${characterName}",
  "is_reference_frame": ${isReference},
  "face": {
    "approximate_age": "",
    "gender_presentation": "",
    "skin_tone": "",
    "hair_color": "",
    "hair_style": "",
    "facial_hair": "",
    "distinguishing_features": []
  },
  "body": {
    "build": "",
    "approximate_height": "",
    "posture": ""
  },
  "wardrobe": {
    "top": "",
    "bottom": "",
    "outerwear": "",
    "footwear": "",
    "accessories": [],
    "colors": []
  },
  "notes": ""
}`;

        try {
          const raw = await groqVision(prompt, imageUrl,
            "You are a film continuity department head. Extract precise visual details for continuity tracking."
          );
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
          return JSON.stringify({ ok: true, profile: parsed });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── vision_check_background ────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "vision_check_background",
          description: "Analyze the scene background, location, and set dressing in a frame. Returns structured data for continuity comparison.",
          parameters: {
            type: "object",
            properties: {
              image_url: { type: "string", description: "Frame URL or base64 data URI" },
              scene_name: { type: "string", description: "Scene identifier for labelling" },
            },
            required: ["image_url"],
          },
        },
      },
      async execute(args) {
        const imageUrl = String(args["image_url"] ?? "");
        const sceneName = String(args["scene_name"] ?? "Unknown Scene");

        const prompt = `Analyze the background and environment in this film frame for continuity tracking.

Respond as JSON:
{
  "scene_name": "${sceneName}",
  "location_type": "",
  "time_of_day": "",
  "lighting": {
    "type": "",
    "direction": "",
    "color_temperature": "",
    "mood": ""
  },
  "set_dressing": [],
  "visible_props": [],
  "weather_or_conditions": "",
  "camera_angle": "",
  "background_actors": "",
  "notes": ""
}`;

        try {
          const raw = await groqVision(prompt, imageUrl,
            "You are a film continuity and art department supervisor."
          );
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
          return JSON.stringify({ ok: true, scene: parsed });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },
  ];
}
