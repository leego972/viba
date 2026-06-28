/**
 * VIBA Continuity Checker
 *
 * Programmatic API for running full character + scene continuity analysis
 * across a set of video frames or screenshots.
 *
 * Powered entirely by Groq free vision model — no paid AI service needed.
 * Called by the Virelle beta tester and exposed as agent tools.
 */

import { logger } from "./logger";

const GROQ_VISION_MODEL = "llama-3.2-11b-vision-preview";
const GROQ_BASE = "https://api.groq.com/openai/v1";

export interface FrameInput {
  url: string;
  label?: string;
  sceneIndex?: number;
  timestamp?: string;
}

export interface ContinuityIssue {
  type: "face" | "body" | "wardrobe" | "background" | "lighting" | "props";
  severity: "minor" | "major" | "critical";
  frameIndices: number[];
  description: string;
}

export interface CharacterContinuity {
  name: string;
  faceConsistent: boolean;
  wardrobeConsistent: boolean;
  bodyConsistent: boolean;
  notes: string;
}

export interface SceneContinuityResult {
  sceneLabel: string;
  frameCount: number;
  overallScore: number;
  verdict: "PASS" | "WARN" | "FAIL";
  issues: ContinuityIssue[];
  consistentElements: string[];
  characters: CharacterContinuity[];
  checkedAt: string;
}

export interface ContinuityReport {
  projectTitle: string;
  generatedAt: string;
  totalFramesAnalyzed: number;
  totalScenes: number;
  overallScore: number;
  verdict: "PASS" | "WARN" | "FAIL";
  badge: string;
  productionReady: boolean;
  sceneResults: SceneContinuityResult[];
  issueSummary: {
    critical: number;
    major: number;
    minor: number;
    total: number;
  };
  criticalIssues: ContinuityIssue[];
  recommendation: string;
}

async function callGroqVision(prompt: string, imageUrls: string[]): Promise<string> {
  const key = process.env["GROQ_API_KEY"] ?? "";
  if (!key) throw new Error("GROQ_API_KEY required for continuity checking");

  const images = imageUrls.slice(0, 4).map(url => ({
    type: "image_url" as const,
    image_url: { url },
  }));

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: GROQ_VISION_MODEL,
      messages: [
        {
          role: "system",
          content: "You are a professional film continuity supervisor. Be precise, critical, and structured. Always respond with valid JSON.",
        },
        {
          role: "user",
          content: [...images, { type: "text" as const, text: prompt }],
        },
      ],
      max_tokens: 2000,
      temperature: 0.05,
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq vision error ${res.status}: ${errText}`);
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

function parseJson<T>(raw: string, fallback: T): T {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try { return JSON.parse(match[0]) as T; } catch { return fallback; }
}

/**
 * Analyze a batch of frames (up to 4) for continuity within a scene.
 */
export async function analyzeSceneFrames(
  frames: FrameInput[],
  options: {
    sceneDescription?: string;
    characterNames?: string[];
    checkTypes?: Array<"face" | "body" | "wardrobe" | "background" | "lighting">;
  } = {},
): Promise<SceneContinuityResult> {
  const batch = frames.slice(0, 4);
  const sceneLabel = options.sceneDescription ?? frames[0]?.label ?? "Scene";
  const characters = options.characterNames?.join(", ") ?? "all visible characters";
  const checks = (options.checkTypes ?? ["face", "body", "wardrobe", "background", "lighting"]).join(", ");

  const prompt = `Analyze these ${batch.length} film frame(s) for production continuity.

Scene: ${sceneLabel}
Characters to track: ${characters}
Check: ${checks}

Return ONLY valid JSON:
{
  "overall_score": <0-100>,
  "verdict": "PASS|WARN|FAIL",
  "issues": [
    {"type": "face|body|wardrobe|background|lighting|props", "severity": "minor|major|critical", "frame_indices": [<0-based>], "description": "..."}
  ],
  "consistent_elements": ["..."],
  "characters": [
    {"name": "...", "face_consistent": true, "wardrobe_consistent": true, "body_consistent": true, "notes": "..."}
  ]
}`;

  const urls = batch.map(f => f.url);
  const raw = await callGroqVision(prompt, urls);

  type RawResult = {
    overall_score?: number;
    verdict?: string;
    issues?: Array<{ type: string; severity: string; frame_indices: number[]; description: string }>;
    consistent_elements?: string[];
    characters?: Array<{ name: string; face_consistent: boolean; wardrobe_consistent: boolean; body_consistent: boolean; notes: string }>;
  };

  const parsed = parseJson<RawResult>(raw, { overall_score: 0, verdict: "FAIL", issues: [], consistent_elements: [], characters: [] });

  return {
    sceneLabel,
    frameCount: batch.length,
    overallScore: parsed.overall_score ?? 0,
    verdict: (parsed.verdict as "PASS" | "WARN" | "FAIL") ?? "FAIL",
    issues: (parsed.issues ?? []).map(i => ({
      type: i.type as ContinuityIssue["type"],
      severity: i.severity as ContinuityIssue["severity"],
      frameIndices: i.frame_indices ?? [],
      description: i.description,
    })),
    consistentElements: parsed.consistent_elements ?? [],
    characters: (parsed.characters ?? []).map(c => ({
      name: c.name,
      faceConsistent: c.face_consistent,
      wardrobeConsistent: c.wardrobe_consistent,
      bodyConsistent: c.body_consistent,
      notes: c.notes,
    })),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Run full continuity analysis across all frames of a project.
 * Splits frames into batches of 4 (Groq vision limit), analyses each, then aggregates.
 */
export async function runFullContinuityCheck(options: {
  projectTitle: string;
  frames: FrameInput[];
  characterNames?: string[];
  sceneDescription?: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<ContinuityReport> {
  const { projectTitle, frames, characterNames, sceneDescription } = options;

  if (frames.length === 0) {
    throw new Error("No frames provided for continuity check");
  }

  logger.info({ project: projectTitle, frameCount: frames.length }, "Starting full continuity check");

  // Split into batches of 4
  const batches: FrameInput[][] = [];
  for (let i = 0; i < frames.length; i += 4) {
    batches.push(frames.slice(i, i + 4));
  }

  const sceneResults: SceneContinuityResult[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const result = await analyzeSceneFrames(batch, {
        sceneDescription: sceneDescription ?? `Scene batch ${i + 1} of ${batches.length}`,
        characterNames,
      });
      sceneResults.push(result);
      options.onProgress?.(i + 1, batches.length);
      logger.info({ batch: i + 1, total: batches.length, score: result.overallScore }, "Batch analysed");
    } catch (err) {
      logger.warn({ err, batch: i }, "Batch analysis failed — skipping");
    }

    // Rate limit: don't hammer Groq
    if (i < batches.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Aggregate
  const scores = sceneResults.map(r => r.overallScore).filter(s => s > 0);
  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;

  const allIssues = sceneResults.flatMap(r => r.issues);
  const criticalIssues = allIssues.filter(i => i.severity === "critical");
  const majorIssues = allIssues.filter(i => i.severity === "major");
  const minorIssues = allIssues.filter(i => i.severity === "minor");

  const verdict: "PASS" | "WARN" | "FAIL" =
    criticalIssues.length > 0 ? "FAIL"
    : majorIssues.length > 3 ? "FAIL"
    : avgScore >= 80 ? "PASS"
    : avgScore >= 60 ? "WARN"
    : "FAIL";

  const badge =
    verdict === "PASS" ? "✅ CONTINUITY APPROVED — Production Ready"
    : verdict === "WARN" ? "⚠️ CONTINUITY WARNING — Review Required"
    : "❌ CONTINUITY FAIL — Reshoots Required";

  const recommendation =
    criticalIssues.length > 0
      ? `${criticalIssues.length} critical continuity error(s) found. Must be resolved before final cut.`
    : majorIssues.length > 0
      ? `${majorIssues.length} major issue(s) should be addressed before theatrical release.`
    : "Continuity meets production standards. Approved for final cut.";

  logger.info({ project: projectTitle, verdict, score: avgScore, issues: allIssues.length }, "Full continuity check complete");

  return {
    projectTitle,
    generatedAt: new Date().toISOString(),
    totalFramesAnalyzed: frames.length,
    totalScenes: batches.length,
    overallScore: avgScore,
    verdict,
    badge,
    productionReady: verdict === "PASS",
    sceneResults,
    issueSummary: {
      critical: criticalIssues.length,
      major: majorIssues.length,
      minor: minorIssues.length,
      total: allIssues.length,
    },
    criticalIssues,
    recommendation,
  };
}
