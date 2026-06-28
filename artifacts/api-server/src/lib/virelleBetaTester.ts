/**
 * VIBA → Virelle Studios Beta Tester
 *
 * Autonomously logs into virelle.life, creates a project, drives the
 * 15-minute film generation pipeline, captures frames, and runs
 * continuity checks — all using VIBA's own tools (Groq + Chromium).
 *
 * No Manus. No paid browser service. No external AI dependency.
 */

import { logger } from "./logger";
import { getVibaCredential } from "./vibaVault";
import { runFullContinuityCheck, type FrameInput, type ContinuityReport } from "./continuityChecker";

const VIRELLE_BASE = process.env["VIRELLE_BASE_URL"] ?? "https://virelle.life";

export interface VirelleBetaOptions {
  userId?: number | null;
  topic: string;
  credentialLabel?: string;
  durationMinutes?: number;
  characterNames?: string[];
  onProgress?: (step: string, detail?: string) => void;
}

export interface VirelleBetaReport {
  ok: boolean;
  error?: string;
  projectId?: string;
  projectTitle?: string;
  stepsCompleted: string[];
  stepsFailed: string[];
  generatedFrames: FrameInput[];
  continuityReport?: ContinuityReport;
  featureTestResults: FeatureTestResult[];
  overallVerdict: "PASS" | "WARN" | "FAIL" | "ERROR";
  badge: string;
  generatedAt: string;
}

export interface FeatureTestResult {
  feature: string;
  route: string;
  status: "pass" | "fail" | "skip" | "warn";
  httpStatus?: number;
  detail: string;
  checkedAt: string;
}

async function apiCall(
  path: string,
  options: { method?: string; body?: unknown; jwt?: string } = {},
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${VIRELLE_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.jwt ? { Authorization: `Bearer ${options.jwt}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  let data: unknown;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

async function login(email: string, password: string): Promise<string | null> {
  // Try common auth endpoints
  const paths = ["/api/auth/login", "/api/auth/signin", "/api/login", "/api/user/login"];
  for (const path of paths) {
    try {
      const res = await apiCall(path, { method: "POST", body: { email, password } });
      if (res.ok) {
        const d = res.data as Record<string, unknown>;
        const jwt = String(d["token"] ?? d["accessToken"] ?? d["jwt"] ?? d["access_token"] ?? "");
        if (jwt) {
          logger.info({ path }, "Virelle login succeeded");
          return jwt;
        }
      }
    } catch { /* try next */ }
  }
  return null;
}

async function testRoute(path: string, jwt: string, feature: string): Promise<FeatureTestResult> {
  const url = `${VIRELLE_BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(10000),
    });
    return {
      feature,
      route: path,
      status: res.status < 400 ? "pass" : res.status === 401 ? "warn" : "fail",
      httpStatus: res.status,
      detail: res.status < 400 ? "Route accessible" : `HTTP ${res.status}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      feature,
      route: path,
      status: "fail",
      detail: String(err),
      checkedAt: new Date().toISOString(),
    };
  }
}

export async function runVirelleBetaTest(opts: VirelleBetaOptions): Promise<VirelleBetaReport> {
  const {
    userId = null,
    topic,
    credentialLabel = "admin",
    durationMinutes = 15,
    characterNames = [],
    onProgress = () => {},
  } = opts;

  const stepsCompleted: string[] = [];
  const stepsFailed: string[] = [];
  const featureTestResults: FeatureTestResult[] = [];
  const generatedFrames: FrameInput[] = [];

  // ── Step 1: Retrieve credentials from vault ────────────────────────────
  onProgress("auth", "Retrieving credentials from VIBA Vault");
  let email = "", password = "";
  try {
    email = (await getVibaCredential({ userId, provider: "virelle", kind: "email", label: credentialLabel })) ?? "";
    password = (await getVibaCredential({ userId, provider: "virelle", kind: "password", label: credentialLabel })) ?? "";
    if (!email || !password) throw new Error("Email or password not found in vault");
    stepsCompleted.push("vault_credential_retrieval");
  } catch (err) {
    stepsFailed.push("vault_credential_retrieval");
    return {
      ok: false,
      error: `Credentials not found. Store them via VIBA: POST /api/credentials with provider='virelle', kind='email'/'password', label='${credentialLabel}'`,
      stepsCompleted,
      stepsFailed,
      generatedFrames,
      featureTestResults,
      overallVerdict: "ERROR",
      badge: "❌ SETUP REQUIRED — Store Virelle credentials in VIBA Vault first",
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Step 2: Login ──────────────────────────────────────────────────────
  onProgress("auth", `Logging into ${VIRELLE_BASE}`);
  const jwt = await login(email, password);
  if (!jwt) {
    stepsFailed.push("login");
    return {
      ok: false,
      error: "Login failed. Check credentials in vault or verify the site is reachable.",
      stepsCompleted,
      stepsFailed,
      generatedFrames,
      featureTestResults,
      overallVerdict: "ERROR",
      badge: "❌ LOGIN FAILED",
      generatedAt: new Date().toISOString(),
    };
  }
  stepsCompleted.push("login");

  // ── Step 3: Test all Virelle features ──────────────────────────────────
  onProgress("feature_scan", "Testing all Virelle feature routes");
  const routesToTest = [
    { path: "/api/health", feature: "Health Check" },
    { path: "/api/trpc/project.list", feature: "Project List" },
    { path: "/api/trpc/character.list", feature: "Character List" },
    { path: "/api/trpc/subscription.status", feature: "Subscription Status" },
    { path: "/api/trpc/billing.credits", feature: "Credit Balance" },
    { path: "/api/trpc/narrative.generate", feature: "Narrative Engine" },
    { path: "/api/trpc/voice.list", feature: "Voice Studio" },
    { path: "/api/trpc/soundtrack.list", feature: "Music Score" },
    { path: "/api/trpc/vfx.list", feature: "VFX Studio" },
    { path: "/api/trpc/wardrobe.list", feature: "Wardrobe Marketplace" },
    { path: "/api/trpc/crowdfund.list", feature: "Crowdfunding" },
    { path: "/api/trpc/community.posts", feature: "Community Forum" },
    { path: "/api/trpc/epk.list", feature: "EPK Generator" },
    { path: "/api/trpc/advertising.list", feature: "Advertising Dashboard" },
    { path: "/api/trpc/affiliate.status", feature: "Affiliate Program" },
    { path: "/api/trpc/blog.list", feature: "Blog" },
    { path: "/api/trpc/location.list", feature: "Location Studio" },
    { path: "/api/trpc/props.list", feature: "Props Library" },
    { path: "/api/trpc/production.documents", feature: "Production Documents" },
    { path: "/api/trpc/pipeline.status", feature: "Autonomous Pipeline" },
  ];

  const routeResults = await Promise.allSettled(
    routesToTest.map(r => testRoute(r.path, jwt, r.feature))
  );
  for (const r of routeResults) {
    if (r.status === "fulfilled") featureTestResults.push(r.value);
  }
  stepsCompleted.push("feature_route_scan");

  // ── Step 4: Create a project ───────────────────────────────────────────
  onProgress("create_project", `Creating project: "${topic}"`);
  let projectId: string | undefined;
  let projectTitle = topic;

  const createRes = await apiCall("/api/trpc/project.create", {
    method: "POST",
    jwt,
    body: { json: { title: topic, description: `VIBA Beta Test — ${topic}`, mode: "quick", rating: "PG-13", duration: durationMinutes * 60 } },
  });

  if (createRes.ok) {
    const d = createRes.data as Record<string, unknown>;
    const result = (d["result"] as Record<string, unknown>)?.["data"] as Record<string, unknown> ?? d;
    const jsonData = (result?.["json"] as Record<string, unknown>) ?? result;
    projectId = String(jsonData?.["id"] ?? jsonData?.["projectId"] ?? "");
    projectTitle = String(jsonData?.["title"] ?? topic);
    if (projectId) stepsCompleted.push("project_created");
    else stepsFailed.push("project_created");
  } else {
    stepsFailed.push("project_created");
    logger.warn({ status: createRes.status }, "Project creation failed");
  }

  // ── Step 5: Generate script ────────────────────────────────────────────
  if (projectId) {
    onProgress("script", `Generating screenplay for: ${topic}`);
    const scriptRes = await apiCall("/api/trpc/script.generate", {
      method: "POST",
      jwt,
      body: { json: { projectId, premise: topic, duration: durationMinutes, tone: "cinematic", rating: "PG-13" } },
    });
    if (scriptRes.ok) stepsCompleted.push("script_generated");
    else stepsFailed.push("script_generated");

    // ── Step 6: Generate characters ──────────────────────────────────────
    onProgress("characters", "Setting up characters");
    const chars = characterNames.length > 0
      ? characterNames
      : ["Protagonist", "Antagonist", "Supporting Character"];

    for (const charName of chars) {
      const charRes = await apiCall("/api/trpc/character.create", {
        method: "POST",
        jwt,
        body: { json: { projectId, name: charName, description: `Main character: ${charName}` } },
      });
      if (charRes.ok) stepsCompleted.push(`character_${charName}`);
    }

    // ── Step 7: Generate storyboard ──────────────────────────────────────
    onProgress("storyboard", "Generating storyboard");
    const sbRes = await apiCall("/api/trpc/storyboard.generate", {
      method: "POST",
      jwt,
      body: { json: { projectId } },
    });
    if (sbRes.ok) stepsCompleted.push("storyboard_generated");
    else stepsFailed.push("storyboard_generated");

    // ── Step 8: Trigger video generation ────────────────────────────────
    onProgress("video_generation", `Generating ${durationMinutes}-minute film`);
    const videoRes = await apiCall("/api/trpc/video.generate", {
      method: "POST",
      jwt,
      body: { json: { projectId, duration: durationMinutes * 60, quality: "high" } },
    });
    if (!videoRes.ok) {
      // Try alternate endpoint
      const altRes = await apiCall("/api/trpc/generation.start", {
        method: "POST",
        jwt,
        body: { json: { projectId } },
      });
      if (altRes.ok) stepsCompleted.push("video_generation_started");
      else stepsFailed.push("video_generation_started");
    } else {
      stepsCompleted.push("video_generation_started");
    }

    // ── Step 9: Poll for completion and grab frames ──────────────────────
    onProgress("polling", "Waiting for generation to complete");
    let attempts = 0;
    const maxAttempts = 20;
    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 5000));
      const statusRes = await apiCall(`/api/trpc/generation.status?input=${encodeURIComponent(JSON.stringify({ json: { projectId } }))}`, { jwt });
      if (statusRes.ok) {
        const d = statusRes.data as Record<string, unknown>;
        const result = (d["result"] as Record<string, unknown>)?.["data"] as Record<string, unknown> ?? {};
        const jsonData = (result?.["json"] as Record<string, unknown>) ?? result;
        const status = String(jsonData?.["status"] ?? "");
        const frames = jsonData?.["frames"] as string[] ?? jsonData?.["thumbnails"] as string[] ?? [];

        if (frames.length > 0) {
          generatedFrames.push(...frames.map((url, i) => ({
            url,
            label: `Scene ${i + 1}`,
            sceneIndex: i,
          })));
        }

        if (status === "complete" || status === "completed" || status === "done") {
          stepsCompleted.push("video_generation_complete");
          break;
        }
        if (status === "failed" || status === "error") {
          stepsFailed.push("video_generation_complete");
          break;
        }
      }
      attempts++;
      onProgress("polling", `Generation in progress… (${attempts}/${maxAttempts})`);
    }
  }

  // ── Step 10: Run continuity check on generated frames ─────────────────
  let continuityReport: ContinuityReport | undefined;
  if (generatedFrames.length > 0) {
    onProgress("continuity", `Running continuity check on ${generatedFrames.length} frames`);
    try {
      continuityReport = await runFullContinuityCheck({
        projectTitle: projectTitle ?? topic,
        frames: generatedFrames,
        characterNames,
        sceneDescription: `${durationMinutes}-minute film: ${topic}`,
        onProgress: (done, total) => onProgress("continuity", `Analysing batch ${done}/${total}`),
      });
      stepsCompleted.push("continuity_check");
    } catch (err) {
      logger.warn({ err }, "Continuity check failed");
      stepsFailed.push("continuity_check");
    }
  } else {
    onProgress("continuity", "No frames available yet — continuity check skipped (generation may still be in progress)");
  }

  // ── Final verdict ──────────────────────────────────────────────────────
  const failedCritical = stepsFailed.includes("login") || stepsFailed.includes("vault_credential_retrieval");
  const continuityVerdict = continuityReport?.verdict ?? "WARN";
  const featurePasses = featureTestResults.filter(r => r.status === "pass").length;
  const featureTotal = featureTestResults.length;
  const featureScore = featureTotal > 0 ? Math.round((featurePasses / featureTotal) * 100) : 0;

  const overallVerdict: "PASS" | "WARN" | "FAIL" | "ERROR" =
    failedCritical ? "ERROR"
    : continuityVerdict === "FAIL" ? "FAIL"
    : featureScore < 50 ? "FAIL"
    : continuityVerdict === "WARN" || featureScore < 80 ? "WARN"
    : "PASS";

  const badge =
    overallVerdict === "PASS" ? "✅ VIRELLE BETA TEST PASSED — Production Pipeline Approved"
    : overallVerdict === "WARN" ? "⚠️ VIRELLE BETA TEST WARNINGS — Review Issues Before Launch"
    : overallVerdict === "ERROR" ? "❌ BETA TEST ERROR — Setup Required"
    : "❌ VIRELLE BETA TEST FAILED — Issues Must Be Resolved";

  logger.info({
    project: projectTitle,
    verdict: overallVerdict,
    stepsCompleted: stepsCompleted.length,
    stepsFailed: stepsFailed.length,
    features: `${featurePasses}/${featureTotal}`,
    frames: generatedFrames.length,
  }, "Virelle beta test complete");

  return {
    ok: overallVerdict !== "ERROR",
    projectId,
    projectTitle,
    stepsCompleted,
    stepsFailed,
    generatedFrames,
    continuityReport,
    featureTestResults,
    overallVerdict,
    badge,
    generatedAt: new Date().toISOString(),
  };
}
