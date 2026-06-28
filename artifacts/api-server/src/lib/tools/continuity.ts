/**
 * VIBA Continuity Tools
 *
 * Orchestrates vision tools to run full continuity checks across a set of frames.
 * Works entirely on Groq free tier — no paid AI services.
 *
 * Tools:
 *   continuity_run_check    — run full continuity analysis on an array of frame URLs
 *   continuity_score_report — generate a scored pass/fail report from continuity results
 */

import { logger } from "../logger";

export interface ContinuityTool {
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

async function groqVisionMulti(prompt: string, imageUrls: string[]): Promise<string> {
  const key = process.env["GROQ_API_KEY"] ?? "";
  if (!key) throw new Error("GROQ_API_KEY required");

  const imageContent = imageUrls.slice(0, 4).map(url => ({
    type: "image_url" as const,
    image_url: { url },
  }));

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: GROQ_VISION_MODEL,
      messages: [{
        role: "user",
        content: [...imageContent, { type: "text", text: prompt }],
      }],
      max_tokens: 2000,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "(no response)";
}

export function getContinuityTools(): ContinuityTool[] {
  return [
    // ── continuity_run_check ───────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "continuity_run_check",
          description: "Run a full continuity check across multiple film frames. Checks character face/body/wardrobe consistency and background/scene consistency. Returns per-frame findings and an overall continuity score. Input up to 4 frame URLs per call.",
          parameters: {
            type: "object",
            properties: {
              frame_urls: {
                type: "array",
                items: { type: "string" },
                description: "Array of frame image URLs or base64 data URIs (max 4 per call)",
              },
              character_names: {
                type: "array",
                items: { type: "string" },
                description: "Names of characters expected to appear across frames",
              },
              scene_description: {
                type: "string",
                description: "What scene is this? e.g. 'Interior kitchen, morning, characters Sarah and Marcus having breakfast'",
              },
              check_types: {
                type: "array",
                items: { type: "string" },
                description: "What to check: ['face', 'body', 'wardrobe', 'background', 'lighting'] — default is all",
              },
            },
            required: ["frame_urls"],
          },
        },
      },
      async execute(args) {
        const frameUrls = (Array.isArray(args["frame_urls"]) ? args["frame_urls"] : []) as string[];
        const characterNames = (Array.isArray(args["character_names"]) ? args["character_names"] : []) as string[];
        const sceneDesc = String(args["scene_description"] ?? "Unknown scene");
        const checkTypes = (Array.isArray(args["check_types"]) ? args["check_types"] : ["face", "body", "wardrobe", "background", "lighting"]) as string[];

        if (frameUrls.length === 0) {
          return JSON.stringify({ ok: false, error: "No frame URLs provided" });
        }

        const frames = frameUrls.slice(0, 4);
        const characters = characterNames.length > 0 ? characterNames.join(", ") : "all visible characters";
        const checks = checkTypes.join(", ");

        const prompt = `You are a senior film continuity supervisor reviewing ${frames.length} frames from the same scene.

Scene: ${sceneDesc}
Expected characters: ${characters}
Check these aspects: ${checks}

For each frame and across all frames, identify:
1. Character continuity: Are faces, body types, and appearances consistent?
2. Wardrobe continuity: Same clothing, colors, accessories throughout?
3. Background continuity: Same location, props, set dressing?
4. Lighting continuity: Consistent light direction, color, intensity?

Respond ONLY with this JSON structure:
{
  "overall_score": <0-100>,
  "overall_verdict": "PASS|WARN|FAIL",
  "frame_count": ${frames.length},
  "issues": [
    {
      "type": "face|body|wardrobe|background|lighting",
      "severity": "minor|major|critical",
      "frame_indices": [<0-based frame numbers>],
      "description": "<specific issue>"
    }
  ],
  "consistent_elements": ["<list of things that are consistent>"],
  "character_profiles": [
    {
      "name": "<character name or 'unknown'>",
      "face_consistent": true|false,
      "wardrobe_consistent": true|false,
      "notes": ""
    }
  ],
  "recommendation": "<what needs fixing before final cut>"
}`;

        try {
          const raw = await groqVisionMulti(prompt, frames);
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            return JSON.stringify({ ok: true, raw, warning: "Could not parse structured JSON from vision model" });
          }
          const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
          logger.info({ frameCount: frames.length, score: parsed["overall_score"] }, "continuity_run_check complete");
          return JSON.stringify({ ok: true, ...parsed });
        } catch (err) {
          logger.warn({ err }, "continuity_run_check failed");
          return JSON.stringify({ ok: false, error: String(err) });
        }
      },
    },

    // ── continuity_score_report ────────────────────────────────────────────
    {
      definition: {
        type: "function",
        function: {
          name: "continuity_score_report",
          description: "Aggregate multiple continuity check results into a final production-ready report with overall pass/fail verdict, issue list, and recommendations.",
          parameters: {
            type: "object",
            properties: {
              check_results: {
                type: "array",
                description: "Array of result objects from continuity_run_check calls",
                items: { type: "object" },
              },
              project_title: { type: "string", description: "Film/video project title" },
              total_scenes: { type: "number", description: "Total number of scenes in the project" },
            },
            required: ["check_results"],
          },
        },
      },
      async execute(args) {
        const results = (Array.isArray(args["check_results"]) ? args["check_results"] : []) as Array<Record<string, unknown>>;
        const projectTitle = String(args["project_title"] ?? "Untitled Project");
        const totalScenes = Number(args["total_scenes"] ?? results.length);

        if (results.length === 0) {
          return JSON.stringify({ ok: false, error: "No check results to aggregate" });
        }

        const scores = results
          .map(r => Number(r["overall_score"] ?? 0))
          .filter(s => s > 0);

        const avgScore = scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0;

        const allIssues = results.flatMap(r =>
          Array.isArray(r["issues"]) ? r["issues"] as Array<Record<string, unknown>> : []
        );

        const criticalIssues = allIssues.filter(i => i["severity"] === "critical");
        const majorIssues = allIssues.filter(i => i["severity"] === "major");
        const minorIssues = allIssues.filter(i => i["severity"] === "minor");

        const verdict = criticalIssues.length > 0 ? "FAIL"
          : majorIssues.length > 3 ? "FAIL"
          : avgScore >= 80 ? "PASS"
          : avgScore >= 60 ? "WARN"
          : "FAIL";

        const report = {
          ok: true,
          project_title: projectTitle,
          generated_at: new Date().toISOString(),
          verdict,
          overall_score: avgScore,
          scenes_checked: results.length,
          total_scenes: totalScenes,
          coverage_pct: Math.round((results.length / Math.max(totalScenes, 1)) * 100),
          issue_summary: {
            critical: criticalIssues.length,
            major: majorIssues.length,
            minor: minorIssues.length,
            total: allIssues.length,
          },
          critical_issues: criticalIssues,
          major_issues: majorIssues,
          minor_issues: minorIssues,
          production_ready: verdict === "PASS",
          badge: verdict === "PASS"
            ? "✅ CONTINUITY APPROVED — Production Ready"
            : verdict === "WARN"
            ? "⚠️ CONTINUITY WARNING — Review Required"
            : "❌ CONTINUITY FAIL — Reshoots Required",
          recommendation: criticalIssues.length > 0
            ? `${criticalIssues.length} critical continuity error(s) must be resolved before final cut.`
            : majorIssues.length > 0
            ? `${majorIssues.length} major issue(s) should be addressed. Minor fixes acceptable for streaming release.`
            : "Continuity meets production standards. Approved for final cut.",
        };

        logger.info({ project: projectTitle, verdict, score: avgScore }, "continuity_score_report generated");
        return JSON.stringify(report);
      },
    },
  ];
}
