import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  saveVibaCredential,
  resolveVibaCredential,
  logVibaEvent,
  listVibaCredentials,
  deleteVibaCredential,
} from "../lib/vibaVault";
import {
  listProviderPreferences,
  saveProviderPreference,
  type ProviderPreference,
} from "../lib/providerPreferences";
import { validateGithub } from "./credentials";

const router: IRouter = Router();

type ProviderStatus = "not_configured" | "configured" | "disabled";

interface ProviderDef {
  id: string;
  label: string;
  description: string;
  keyEnvVar: string | null;
  modelSettingKey: string | null;
  defaultModel: string;
  modelOptions: string[];
  endpointSettingKey: string | null;
  defaultEndpoint: string;
  endpointRequired: boolean;
  adapterType: string;
}

const PROVIDER_DEFS: ProviderDef[] = [
  { id: "openai", label: "OpenAI", description: "GPT and o-series models.", keyEnvVar: "OPENAI_API_KEY", modelSettingKey: "OPENAI_MODEL", defaultModel: "gpt-4.1-mini", modelOptions: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o", "gpt-4o-mini", "o3-mini"], endpointSettingKey: null, defaultEndpoint: "", endpointRequired: false, adapterType: "openai" },
  { id: "anthropic", label: "Anthropic", description: "Claude models.", keyEnvVar: "ANTHROPIC_API_KEY", modelSettingKey: "ANTHROPIC_MODEL", defaultModel: "claude-3-5-sonnet-20241022", modelOptions: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"], endpointSettingKey: null, defaultEndpoint: "", endpointRequired: false, adapterType: "anthropic" },
  { id: "google", label: "Google Gemini", description: "Gemini models.", keyEnvVar: "GEMINI_API_KEY", modelSettingKey: "GEMINI_MODEL", defaultModel: "gemini-2.0-flash", modelOptions: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"], endpointSettingKey: null, defaultEndpoint: "", endpointRequired: false, adapterType: "gemini" },
  { id: "perplexity", label: "Perplexity", description: "Web-connected research models.", keyEnvVar: "PERPLEXITY_API_KEY", modelSettingKey: "PERPLEXITY_MODEL", defaultModel: "sonar", modelOptions: ["sonar", "sonar-pro", "sonar-reasoning"], endpointSettingKey: null, defaultEndpoint: "", endpointRequired: false, adapterType: "perplexity" },
  { id: "groq", label: "Groq", description: "Low-latency hosted inference.", keyEnvVar: "GROQ_API_KEY", modelSettingKey: "GROQ_MODEL", defaultModel: "llama-3.3-70b-versatile", modelOptions: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it"], endpointSettingKey: null, defaultEndpoint: "", endpointRequired: false, adapterType: "groq" },
  { id: "ollama", label: "Ollama / Self-hosted", description: "A user-supplied Ollama endpoint.", keyEnvVar: null, modelSettingKey: "OLLAMA_MODEL", defaultModel: "llama3.2", modelOptions: [], endpointSettingKey: "OLLAMA_BASE_URL", defaultEndpoint: "", endpointRequired: true, adapterType: "ollama" },
  { id: "venice", label: "Venice AI", description: "OpenAI-compatible Venice models.", keyEnvVar: "VENICE_API_KEY", modelSettingKey: "VENICE_MODEL", defaultModel: "llama-3.3-70b", modelOptions: ["llama-3.3-70b", "llama-3.1-405b", "mistral-31-24b"], endpointSettingKey: "VENICE_ENDPOINT", defaultEndpoint: "https://api.venice.ai/api/v1", endpointRequired: true, adapterType: "openai-compatible" },
  { id: "mistral", label: "Mistral AI", description: "Mistral and Codestral models.", keyEnvVar: "MISTRAL_API_KEY", modelSettingKey: "MISTRAL_MODEL", defaultModel: "mistral-large-latest", modelOptions: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"], endpointSettingKey: null, defaultEndpoint: "", endpointRequired: false, adapterType: "mistral" },
  { id: "deepseek", label: "DeepSeek", description: "DeepSeek chat and reasoning models.", keyEnvVar: "DEEPSEEK_API_KEY", modelSettingKey: "DEEPSEEK_MODEL", defaultModel: "deepseek-chat", modelOptions: ["deepseek-chat", "deepseek-reasoner"], endpointSettingKey: "DEEPSEEK_ENDPOINT", defaultEndpoint: "https://api.deepseek.com", endpointRequired: true, adapterType: "deepseek" },
  { id: "github", label: "GitHub", description: "Repository access for supervised code workflows.", keyEnvVar: "GITHUB_TOKEN", modelSettingKey: null, defaultModel: "", modelOptions: [], endpointSettingKey: null, defaultEndpoint: "https://api.github.com", endpointRequired: false, adapterType: "service-token" },
  { id: "vastai", label: "Vast.ai", description: "GPU compute access.", keyEnvVar: "VAST_AI_API_KEY", modelSettingKey: null, defaultModel: "", modelOptions: [], endpointSettingKey: null, defaultEndpoint: "", endpointRequired: false, adapterType: "service-token" },
  { id: "custom", label: "Custom OpenAI-compatible AI", description: "A user-supplied OpenAI-compatible endpoint.", keyEnvVar: "CUSTOM_API_KEY", modelSettingKey: "CUSTOM_MODEL", defaultModel: "", modelOptions: [], endpointSettingKey: "CUSTOM_ENDPOINT", defaultEndpoint: "", endpointRequired: true, adapterType: "openai-compatible" },
];

const FIXED_IDS = new Set(PROVIDER_DEFS.map((provider) => provider.id));

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

async function getPlatformSetting(key: string | null): Promise<string | null> {
  if (!key) return null;
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function hasCredential(def: ProviderDef, uid: number | null): Promise<boolean> {
  if (!def.keyEnvVar) return true;
  if (process.env[def.keyEnvVar]?.trim()) return true;
  const aliases = def.id === "google" ? ["google", "gemini"] : [def.id];
  for (const provider of aliases) {
    const resolved = await resolveVibaCredential({
      userId: uid,
      provider,
      kind: "api_key",
      envNames: [def.keyEnvVar],
    });
    if (resolved.source === "vault") return true;
  }
  return false;
}

function preferenceMap(preferences: ProviderPreference[]): Map<string, ProviderPreference> {
  return new Map(preferences.map((preference) => [preference.providerId, preference]));
}

router.get("/providers", async (req, res): Promise<void> => {
  const uid = userId(req);
  const preferences = preferenceMap(await listProviderPreferences(uid));

  const providers = await Promise.all(PROVIDER_DEFS.map(async (def) => {
    const preference = preferences.get(def.id);
    const [credentialPresent, platformModel, platformEndpoint] = await Promise.all([
      hasCredential(def, uid),
      getPlatformSetting(def.modelSettingKey),
      getPlatformSetting(def.endpointSettingKey),
    ]);
    const model = preference?.model ?? platformModel ?? def.defaultModel;
    const endpoint = preference?.endpoint ?? platformEndpoint ?? def.defaultEndpoint;
    const endpointPresent = !def.endpointRequired || Boolean(endpoint);
    const configured = credentialPresent && endpointPresent;
    const enabled = preference?.enabled ?? configured;
    const status: ProviderStatus = !configured ? "not_configured" : enabled ? "configured" : "disabled";

    return {
      id: def.id,
      label: def.label,
      description: def.description,
      hasKey: credentialPresent,
      enabled,
      model,
      endpoint: endpoint || undefined,
      hasEndpoint: def.endpointRequired || Boolean(def.endpointSettingKey),
      defaultModel: def.defaultModel,
      modelOptions: def.modelOptions,
      adapterType: def.adapterType,
      status,
    };
  }));

  providers.sort((a, b) => {
    if (a.status === "configured" && b.status !== "configured") return -1;
    if (a.status !== "configured" && b.status === "configured") return 1;
    return a.label.localeCompare(b.label);
  });

  res.json({
    providers,
    configuredProviderIds: providers.filter((provider) => provider.status === "configured").map((provider) => provider.id),
    unsupportedDynamicProviders: false,
  });
});

router.post("/providers", async (req, res): Promise<void> => {
  const uid = userId(req);
  const body = req.body as { providers?: Array<{ id?: string; enabled?: boolean; model?: string }> };
  if (!uid) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!Array.isArray(body.providers)) {
    res.status(400).json({ error: "providers array is required" });
    return;
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const item of body.providers) {
    const id = normalizeProviderId(String(item.id ?? ""));
    if (!FIXED_IDS.has(id)) {
      results.push({ id, ok: false, error: "Provider has no verified VIBA adapter" });
      continue;
    }
    await saveProviderPreference({
      userId: uid,
      providerId: id,
      enabled: item.enabled,
      model: item.model,
    });
    results.push({ id, ok: true });
  }
  res.json({ ok: results.every((result) => result.ok), results });
});

router.patch("/providers/:provider", async (req, res): Promise<void> => {
  const uid = userId(req);
  const id = normalizeProviderId(String(req.params.provider ?? ""));
  if (!uid) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!FIXED_IDS.has(id)) {
    res.status(422).json({ error: "Provider has no verified VIBA adapter" });
    return;
  }

  const def = PROVIDER_DEFS.find((provider) => provider.id === id)!;
  const body = req.body as { enabled?: boolean; model?: string; endpoint?: string; key?: string };

  try {
    await saveProviderPreference({
      userId: uid,
      providerId: id,
      enabled: body.enabled,
      model: body.model,
      endpoint: body.endpoint,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid provider preference" });
    return;
  }

  if (body.key !== undefined) {
    const key = body.key.trim();
    const aliases = id === "google" ? ["google", "gemini"] : [id];
    if (!key) {
      for (const provider of aliases) {
        await deleteVibaCredential({ userId: uid, provider, kind: "api_key", label: "default" });
      }
    } else {
      await saveVibaCredential({ userId: uid, provider: id, kind: "api_key", value: key, label: "default" });
      await logVibaEvent({
        userId: uid,
        eventType: "provider_key_saved",
        provider: id,
        status: "saved",
        message: `${def.label} API key saved to the encrypted user vault.`,
      });
    }
  }

  res.json({ ok: true, provider: id, configured: await hasCredential(def, uid) });
});

router.post("/providers/:provider/test", async (req, res): Promise<void> => {
  const uid = userId(req);
  const id = normalizeProviderId(String(req.params.provider ?? ""));
  const def = PROVIDER_DEFS.find((provider) => provider.id === id);
  if (!uid) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!def) {
    res.status(422).json({ error: "Provider has no verified VIBA adapter" });
    return;
  }

  if (!(await hasCredential(def, uid))) {
    res.status(409).json({ configured: false, reachable: false, message: "No provider credential is configured." });
    return;
  }

  if (id === "github") {
    const token = (await resolveVibaCredential({ userId: uid, provider: "github", kind: "api_key", envNames: ["GITHUB_TOKEN"] })).value;
    if (!token) {
      res.status(409).json({ configured: false, reachable: false, message: "No GitHub token is configured." });
      return;
    }
    const result = await validateGithub(token);
    res.status(result.ok ? 200 : 502).json({ configured: true, reachable: result.ok, message: result.message, details: result.details });
    return;
  }

  res.status(501).json({
    configured: true,
    reachable: null,
    error: "live_validation_unavailable",
    message: `${def.label} has a runtime adapter, but this connection-test endpoint does not yet have a verified read-only validator. VIBA will not claim the connection was tested.`,
  });
});

router.get("/providers/:provider/keys", async (req, res): Promise<void> => {
  const id = normalizeProviderId(String(req.params.provider ?? ""));
  if (!FIXED_IDS.has(id)) {
    res.status(422).json({ error: "Provider has no verified VIBA adapter" });
    return;
  }
  const all = await listVibaCredentials(userId(req));
  const aliases = id === "google" ? new Set(["google", "gemini"]) : new Set([id]);
  const keys = all
    .filter((entry) => aliases.has(typeof entry.provider === "string" ? entry.provider : "") && entry.kind === "api_key")
    .map((entry) => ({
      label: typeof entry.label === "string" ? entry.label : "default",
      status: typeof entry.status === "string" ? entry.status : "saved",
      lastUsedAt: entry.last_used_at ?? null,
      updatedAt: entry.updated_at ?? null,
    }));
  res.json({ provider: id, keys });
});

router.post("/providers/:provider/keys", async (req, res): Promise<void> => {
  const uid = userId(req);
  const id = normalizeProviderId(String(req.params.provider ?? ""));
  const body = req.body as { key?: string; label?: string };
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : "default";
  if (!uid) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!FIXED_IDS.has(id) || !key) {
    res.status(400).json({ error: "A supported provider and key are required" });
    return;
  }
  await saveVibaCredential({ userId: uid, provider: id, kind: "api_key", value: key, label });
  await logVibaEvent({ userId: uid, eventType: "provider_key_saved", provider: id, status: "saved", message: `${id} API key saved with label ${label}.` });
  res.json({ ok: true, provider: id, label });
});

router.delete("/providers/:provider/keys/:label", async (req, res): Promise<void> => {
  const uid = userId(req);
  const id = normalizeProviderId(String(req.params.provider ?? ""));
  const label = String(req.params.label ?? "").trim();
  if (!uid) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!FIXED_IDS.has(id) || !label) {
    res.status(400).json({ error: "A supported provider and label are required" });
    return;
  }
  const aliases = id === "google" ? ["google", "gemini"] : [id];
  let deleted = false;
  for (const provider of aliases) {
    const result = await deleteVibaCredential({ userId: uid, provider, kind: "api_key", label });
    deleted = deleted || result.deleted;
  }
  await logVibaEvent({ userId: uid, eventType: "provider_key_deleted", provider: id, status: "deleted", message: `${id} API key ${label} removed.` });
  res.json({ ok: true, deleted, provider: id, label });
});

router.get("/providers/setting/:key", async (req, res): Promise<void> => {
  const key = String(req.params.key ?? "");
  if (!key || key.length > 64 || /KEY|TOKEN|SECRET|PASSWORD/i.test(key)) {
    res.status(400).json({ error: "Invalid or sensitive setting key" });
    return;
  }
  res.json({ key, value: await getPlatformSetting(key) });
});

export default router;
