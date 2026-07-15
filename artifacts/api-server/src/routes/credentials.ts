import { Router, type IRouter } from "express";
import {
  listVibaCredentials,
  listCredentialAccessLogs,
  deleteVibaCredential,
  logVibaEvent,
  markVibaCredential,
  resolveVibaCredential,
  saveVibaCredential,
} from "../lib/vibaVault";

const router: IRouter = Router();

type Provider = "github" | "railway" | "railway_mcp" | "openai" | "anthropic" | "gemini" | "perplexity" | "groq" | "mistral" | "deepseek";

const REQUIRED_ENV: Record<Provider, string[]> = {
  github: ["GITHUB_TOKEN"],
  railway: ["RAILWAY_TOKEN"],
  railway_mcp: ["RAILWAY_MCP_URL", "RAILWAY_TOKEN"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
  perplexity: ["PERPLEXITY_API_KEY"],
  groq: ["GROQ_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
};

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REQUIRED_ENV, value);
}

async function validateGithub(token: string): Promise<{ ok: boolean; message: string; details?: Record<string, unknown> }> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "VIBA-Credential-Validator/1.0",
    },
  });
  if (!response.ok) return { ok: false, message: `GITHUB_TOKEN rejected by GitHub. Replace GITHUB_TOKEN. HTTP ${response.status}` };
  const data = await response.json() as { login?: string; id?: number };
  return { ok: true, message: "GITHUB_TOKEN is valid.", details: { login: data.login, id: data.id } };
}

async function validateRailway(token: string): Promise<{ ok: boolean; message: string; details?: Record<string, unknown> }> {
  const response = await fetch(process.env.RAILWAY_GRAPHQL_URL || "https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "VIBA-Credential-Validator/1.0",
    },
    body: JSON.stringify({ query: "query VibaCredentialRailwayCheck { me { id name email } }" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (data as { errors?: unknown }).errors) {
    return { ok: false, message: `RAILWAY_TOKEN rejected by Railway. Replace RAILWAY_TOKEN. HTTP ${response.status}` };
  }
  return { ok: true, message: "RAILWAY_TOKEN is valid.", details: data as Record<string, unknown> };
}

async function validateGroq(token: string): Promise<{ ok: boolean; message: string; details?: Record<string, unknown> }> {
  const response = await fetch("https://api.groq.com/openai/v1/models", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "VIBA-Credential-Validator/1.0",
    },
  });
  if (!response.ok) return { ok: false, message: `GROQ_API_KEY rejected by Groq. Replace GROQ_API_KEY. HTTP ${response.status}` };
  const data = await response.json() as { data?: Array<{ id?: string }> };
  return { ok: true, message: "GROQ_API_KEY is valid and available for low-cost/default VIBA tasks.", details: { modelCount: data.data?.length ?? 0 } };
}

async function validateProvider(provider: Provider, token: string): Promise<{ ok: boolean; message: string; details?: Record<string, unknown> }> {
  if (provider === "github") return validateGithub(token);
  if (provider === "railway") return validateRailway(token);
  if (provider === "groq") return validateGroq(token);
  if (provider === "railway_mcp") return { ok: true, message: "RAILWAY_MCP_URL is saved. Tool discovery should be tested through /connections/railway-mcp/tools." };
  if (token.length < 8) return { ok: false, message: `${REQUIRED_ENV[provider][0]} looks too short. Replace ${REQUIRED_ENV[provider][0]}.` };
  return { ok: true, message: `${REQUIRED_ENV[provider][0]} is saved. Live provider call validation can be added per provider.` };
}

router.get("/credentials/status", async (req, res): Promise<void> => {
  const uid = userId(req);
  const saved = await listVibaCredentials(uid);
  const required = Object.entries(REQUIRED_ENV).map(([provider, envNames]) => {
    const presentInEnv = envNames.filter((name) => Boolean(process.env[name]));
    return { provider, envNames, presentInEnv, envMissing: envNames.filter((name) => !process.env[name]) };
  });
  res.json({ app: "VIBA", defaultProvider: "groq", saved, required });
});

router.get("/credentials/required", async (_req, res): Promise<void> => {
  res.json({
    app: "VIBA",
    defaultProvider: "groq",
    required: REQUIRED_ENV,
    note: "VIBA checks env vars first, then encrypted saved credentials. If validation fails, the response names the exact key to replace. Groq is preferred for low-cost/default tasks when GROQ_API_KEY exists.",
  });
});

router.post("/credentials/save", async (req, res): Promise<void> => {
  const body = req.body as { provider?: unknown; kind?: unknown; value?: unknown; label?: unknown };
  if (!isProvider(body.provider)) { res.status(400).json({ error: "valid provider required" }); return; }
  const kind = typeof body.kind === "string" && body.kind.trim() ? body.kind.trim() : "token";
  const value = typeof body.value === "string" ? body.value.trim() : "";
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : "default";
  if (!value) { res.status(400).json({ error: "credential value required" }); return; }

  await saveVibaCredential({ userId: userId(req), provider: body.provider, kind, value, label });
  await logVibaEvent({ userId: userId(req), eventType: "credential_saved", provider: body.provider, status: "saved", message: `${body.provider} ${kind} saved for future use.`, metadata: { label } });
  res.json({ ok: true, provider: body.provider, kind, label, message: "Credential saved encrypted. The secret value is not returned." });
});

router.post("/credentials/validate", async (req, res): Promise<void> => {
  const body = req.body as { provider?: unknown; kind?: unknown; label?: unknown };
  if (!isProvider(body.provider)) { res.status(400).json({ error: "valid provider required" }); return; }
  const kind = typeof body.kind === "string" && body.kind.trim() ? body.kind.trim() : (body.provider === "railway_mcp" ? "url" : "token");
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : "default";
  const envNames = REQUIRED_ENV[body.provider];

  const resolved = await resolveVibaCredential({ userId: userId(req), provider: body.provider, kind, envNames, label });
  if (!resolved.value) {
    res.status(400).json({
      ok: false,
      provider: body.provider,
      missing: resolved.missing,
      message: `Missing ${resolved.missing.join(" or ")}. Add it in env vars or save it in VIBA credentials.`,
    });
    return;
  }

  const result = await validateProvider(body.provider, resolved.value);
  await markVibaCredential({ userId: userId(req), provider: body.provider, kind, label, status: result.ok ? "valid" : "invalid", error: result.ok ? null : result.message });
  await logVibaEvent({ userId: userId(req), eventType: "credential_validated", provider: body.provider, status: result.ok ? "valid" : "invalid", message: result.message, metadata: { source: resolved.source, label } });
  res.status(result.ok ? 200 : 400).json({ ...result, provider: body.provider, source: resolved.source, label });
});

router.get("/credentials/:provider/current", async (req, res): Promise<void> => {
  const provider = req.params.provider;
  if (!isProvider(provider)) { res.status(400).json({ error: "valid provider required" }); return; }
  const kind = provider === "railway_mcp" ? "url" : "token";
  const envNames = REQUIRED_ENV[provider];
  const resolved = await resolveVibaCredential({ userId: userId(req), provider, kind, envNames });
  res.json({
    provider,
    configured: Boolean(resolved.value),
    source: resolved.source,
    missing: resolved.missing,
    message: resolved.value ? `${provider} credential is available for reuse.` : `Missing ${resolved.missing.join(" or ")}.`,
  });
});

router.post("/credentials/browser-profile-note", async (req, res): Promise<void> => {
  const body = req.body as { provider?: unknown };
  if (!isProvider(body.provider) || !["github", "railway"].includes(body.provider)) {
    res.status(400).json({ error: "provider must be github or railway" });
    return;
  }
  await logVibaEvent({ userId: userId(req), eventType: "browser_profile_requested", provider: body.provider, status: "pending", message: `${body.provider} browser access requested. API token connection remains preferred.` });
  res.json({
    ok: true,
    provider: body.provider,
    message: "Browser-based access should be supervised and used only for accounts the user owns. API tokens are preferred. Do not bypass MFA, CAPTCHA, or platform security checks.",
  });
});

/**
 * GET /api/credentials/vault-list
 * Returns metadata for all saved credentials. Raw values NEVER returned.
 */
router.get("/credentials/vault-list", async (req, res): Promise<void> => {
  const uid = userId(req);
  const all = await listVibaCredentials(uid);
  const credentials = all.map((c) => ({
    provider: c["provider"],
    kind: c["kind"],
    label: c["label"],
    scope: c["scope"],
    status: c["status"],
    configured: true,
    expires_at: c["expires_at"],
    last_used_at: c["last_used_at"],
    last_validated_at: c["last_validated_at"],
    last_error: c["last_error"],
    updated_at: c["updated_at"],
    rawValueReturned: false,
  }));
  res.json({ credentials, rawValueReturned: false });
});

/**
 * GET /api/credentials/access-logs
 * Returns access log entries for the current user. No raw values.
 */
router.get("/credentials/access-logs", async (req, res): Promise<void> => {
  const uid = userId(req);
  const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const all = await listCredentialAccessLogs({ userId: uid, provider, limit });
  const logs = all.map((l) => ({
    provider: l["provider"],
    kind: l["kind"],
    label: l["label"],
    purpose: l["purpose"],
    job_id: l["job_id"],
    scope: l["scope"],
    source: l["source"],
    status: l["status"],
    created_at: l["created_at"],
  }));
  res.json({ logs, rawValuesReturned: false });
});

/**
 * DELETE /api/credentials
 * Deletes a saved credential by (provider, kind, label). Cannot recover.
 */
router.delete("/credentials", async (req, res): Promise<void> => {
  const body = req.body as { provider?: unknown; kind?: unknown; label?: unknown };
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind.trim() : "token";
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : "default";
  if (!provider) { res.status(400).json({ error: "provider is required" }); return; }
  const result = await deleteVibaCredential({ userId: userId(req), provider, kind, label });
  if (!result.deleted) { res.status(404).json({ error: "Credential not found or already deleted." }); return; }
  await logVibaEvent({ userId: userId(req), eventType: "credential_deleted", provider, status: "deleted", message: `${provider} ${kind} credential deleted.`, metadata: { label } });
  res.json({ ok: true, provider, kind, label, message: "Credential deleted. Existing provider accounts are not affected." });
});

router.get("/viba/logs", async (req, res): Promise<void> => {
  const uid = userId(req);
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const { rows } = await (await import("@workspace/db")).pool.query(
    `SELECT id, user_id, session_id, event_type, severity, provider, subject, status, message, metadata, created_at
       FROM viba_activity_logs
      WHERE user_id = $1 OR user_id IS NULL
      ORDER BY created_at DESC
      LIMIT $2`,
    [uid, limit],
  );
  res.json({ logs: rows });
});

export default router;
