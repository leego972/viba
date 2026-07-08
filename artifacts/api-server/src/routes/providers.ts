import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { saveVibaCredential, resolveVibaCredential, logVibaEvent, listVibaCredentials, deleteVibaCredential } from "../lib/vibaVault";

const router: IRouter = Router();

type Status = "not_configured" | "configured" | "disabled";
type AdapterType = "auto" | "openai" | "openai-compatible" | "anthropic" | "gemini" | "groq" | "perplexity" | "ollama" | "replit" | "manus" | "railway";

interface ProviderDef {
  id: string;
  label: string;
  description: string;
  keyEnvVar: string | null;
  acceptsKey: boolean;
  keyRequired: boolean;
  modelSettingKey: string | null;
  defaultModel: string;
  modelOptions: string[];
  hasEndpoint: boolean;
  endpointSettingKey: string | null;
  defaultEndpoint: string;
  adapterType: AdapterType;
  custom?: boolean;
}

const ADAPTER_TYPES: Array<{ id: AdapterType; label: string; description: string; requiresEndpoint: boolean; requiresKey: boolean }> = [
  { id: "auto", label: "Automatic", description: "VIBA chooses the best adapter from the provider name and saved details.", requiresEndpoint: false, requiresKey: true },
  { id: "openai", label: "OpenAI", description: "Native OpenAI Chat Completions adapter.", requiresEndpoint: false, requiresKey: true },
  { id: "openai-compatible", label: "OpenAI-compatible", description: "Generic adapter for Venice, OpenRouter, Together, Fireworks, DeepSeek-compatible endpoints, LM Studio and similar /v1 APIs.", requiresEndpoint: false, requiresKey: true },
  { id: "anthropic", label: "Anthropic / Claude", description: "Native Claude Messages API adapter.", requiresEndpoint: false, requiresKey: true },
  { id: "gemini", label: "Google Gemini", description: "Gemini adapter through Google-compatible endpoint support.", requiresEndpoint: false, requiresKey: true },
  { id: "groq", label: "Groq", description: "Groq low-latency inference adapter.", requiresEndpoint: false, requiresKey: true },
  { id: "perplexity", label: "Perplexity", description: "Perplexity research/model adapter.", requiresEndpoint: false, requiresKey: true },
  { id: "ollama", label: "Ollama / Local", description: "Local or self-hosted Ollama-style endpoint. API key usually not required.", requiresEndpoint: false, requiresKey: false },
  { id: "replit", label: "Replit", description: "Replit task/tool execution adapter.", requiresEndpoint: false, requiresKey: true },
  { id: "manus", label: "Manus", description: "Manus workspace/task adapter.", requiresEndpoint: false, requiresKey: true },
  { id: "railway", label: "Railway", description: "Railway infrastructure/deployment adapter.", requiresEndpoint: false, requiresKey: true },
];

const PROVIDER_DEFS: ProviderDef[] = [
  { id: "openai", label: "OpenAI (ChatGPT)", description: "Powers GPT-4, GPT-4o, and o-series models.", keyEnvVar: "OPENAI_API_KEY", acceptsKey: true, keyRequired: true, modelSettingKey: "OPENAI_MODEL", defaultModel: "gpt-4.1-mini", modelOptions: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o", "gpt-4o-mini", "o3-mini", "o1-mini"], hasEndpoint: false, endpointSettingKey: null, defaultEndpoint: "", adapterType: "openai" },
  { id: "anthropic", label: "Anthropic (Claude)", description: "Powers Claude Sonnet, Opus, and Haiku.", keyEnvVar: "ANTHROPIC_API_KEY", acceptsKey: true, keyRequired: true, modelSettingKey: "ANTHROPIC_MODEL", defaultModel: "claude-3-5-sonnet-20241022", modelOptions: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"], hasEndpoint: false, endpointSettingKey: null, defaultEndpoint: "", adapterType: "anthropic" },
  { id: "gemini", label: "Google Gemini", description: "Powers Gemini Flash and Pro models.", keyEnvVar: "GEMINI_API_KEY", acceptsKey: true, keyRequired: true, modelSettingKey: "GEMINI_MODEL", defaultModel: "gemini-2.0-flash", modelOptions: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"], hasEndpoint: false, endpointSettingKey: null, defaultEndpoint: "", adapterType: "gemini" },
  { id: "groq", label: "Groq", description: "Included fast inference when the server Groq credential is configured.", keyEnvVar: "GROQ_API_KEY", acceptsKey: true, keyRequired: true, modelSettingKey: "GROQ_MODEL", defaultModel: "llama-3.3-70b-versatile", modelOptions: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"], hasEndpoint: false, endpointSettingKey: null, defaultEndpoint: "", adapterType: "groq" },
  { id: "local", label: "Local / Self-hosted", description: "Ollama or any OpenAI-compatible local server. Requires a saved endpoint URL.", keyEnvVar: null, acceptsKey: false, keyRequired: false, modelSettingKey: "LOCAL_MODEL", defaultModel: "llama3", modelOptions: [], hasEndpoint: true, endpointSettingKey: "LOCAL_ENDPOINT", defaultEndpoint: "http://localhost:11434", adapterType: "ollama" },
  { id: "custom", label: "Custom AI Provider", description: "Any API provider not listed above. Choose adapter type if automatic detection is not enough.", keyEnvVar: "CUSTOM_API_KEY", acceptsKey: true, keyRequired: false, modelSettingKey: "CUSTOM_MODEL", defaultModel: "", modelOptions: [], hasEndpoint: true, endpointSettingKey: "CUSTOM_ENDPOINT", defaultEndpoint: "https://your-provider.example.com/v1", adapterType: "auto" },
];

function isValidProviderId(id: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(id);
}

function displayNameFromId(id: string): string {
  return id
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || id;
}

function settingPrefix(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function adapterSettingKey(id: string): string {
  return `${settingPrefix(id)}_ADAPTER_TYPE`;
}

function enabledSettingKey(id: string): string {
  return `${settingPrefix(id)}_ENABLED`;
}

function parseAdapterType(value: unknown, fallback: AdapterType): AdapterType {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim().toLowerCase();
  return ADAPTER_TYPES.some((item) => item.id === candidate) ? candidate as AdapterType : fallback;
}

function customProviderDef(id: string): ProviderDef {
  const prefix = settingPrefix(id);
  return {
    id,
    label: displayNameFromId(id),
    description: "Custom API provider saved in the VIBA vault.",
    keyEnvVar: `${prefix}_API_KEY`,
    acceptsKey: true,
    keyRequired: false,
    modelSettingKey: `${prefix}_MODEL`,
    defaultModel: "",
    modelOptions: [],
    hasEndpoint: true,
    endpointSettingKey: `${prefix}_ENDPOINT`,
    defaultEndpoint: "",
    adapterType: "auto",
    custom: true,
  };
}

function providerDefFor(id: string): ProviderDef | null {
  if (!isValidProviderId(id)) return null;
  return PROVIDER_DEFS.find((d) => d.id === id) ?? customProviderDef(id);
}

async function getSettingValue(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function upsertSetting(key: string, value: string): Promise<void> {
  const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (existing) await db.update(settingsTable).set({ value }).where(eq(settingsTable.key, key));
  else await db.insert(settingsTable).values({ key, value });
}

async function deleteSetting(key: string): Promise<void> {
  await db.delete(settingsTable).where(eq(settingsTable.key, key));
}

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

async function hasKeyConfigured(def: ProviderDef, uid: number | null): Promise<boolean> {
  if (!def.acceptsKey) return false;
  if (def.keyEnvVar && process.env[def.keyEnvVar]) return true;
  const resolved = await resolveVibaCredential({ userId: uid, provider: def.id, kind: "api_key", envNames: def.keyEnvVar ? [def.keyEnvVar] : [] });
  return resolved.source === "vault";
}

function savedEndpoint(def: ProviderDef, settingsMap: Map<string, string>): string {
  if (!def.endpointSettingKey) return "";
  return (settingsMap.get(def.endpointSettingKey) ?? "").trim();
}

function configured(def: ProviderDef, hasKey: boolean, settingsMap: Map<string, string>): boolean {
  const endpointOk = !def.hasEndpoint || !def.keyRequired || savedEndpoint(def, settingsMap).length > 0 || def.custom === true;
  const keyOk = !def.keyRequired || hasKey;
  return endpointOk && keyOk && (hasKey || def.acceptsKey === false || savedEndpoint(def, settingsMap).length > 0);
}

async function serializeProvider(def: ProviderDef, uid: number | null, settingsMap: Map<string, string>) {
  const hasKey = await hasKeyConfigured(def, uid);
  const isConfigured = configured(def, hasKey, settingsMap);
  const enabledSetting = settingsMap.get(enabledSettingKey(def.id));
  const enabled = enabledSetting !== undefined ? enabledSetting === "true" : isConfigured;
  const status: Status = !isConfigured ? "not_configured" : !enabled ? "disabled" : "configured";
  const adapterType = parseAdapterType(settingsMap.get(adapterSettingKey(def.id)), def.adapterType);
  return {
    id: def.id,
    label: def.label,
    description: def.description,
    hasKey,
    acceptsKey: def.acceptsKey,
    keyRequired: def.keyRequired,
    enabled,
    model: settingsMap.get(def.modelSettingKey ?? "") ?? def.defaultModel,
    endpoint: def.hasEndpoint ? savedEndpoint(def, settingsMap) : undefined,
    placeholderEndpoint: def.defaultEndpoint,
    hasEndpoint: def.hasEndpoint,
    defaultModel: def.defaultModel,
    modelOptions: def.modelOptions,
    adapterType,
    availableAdapterTypes: ADAPTER_TYPES,
    status,
    custom: def.custom === true,
  };
}

router.get("/providers/adapter-types", (_req, res): void => {
  res.json({ adapterTypes: ADAPTER_TYPES, rawValuesReturned: false });
});

router.get("/providers", async (req, res): Promise<void> => {
  const uid = userId(req);
  const allSettings = await db.select().from(settingsTable);
  const settingsMap = new Map(allSettings.map((s) => [s.key, s.value]));
  const credentials = await listVibaCredentials(uid);
  const ids = new Set(PROVIDER_DEFS.map((def) => def.id));
  for (const credential of credentials) {
    if (credential.kind === "api_key" && isValidProviderId(credential.provider)) {
      ids.add(credential.provider);
    }
  }
  const defs = Array.from(ids).map((id) => providerDefFor(id)).filter((def): def is ProviderDef => Boolean(def));
  const providers = await Promise.all(defs.map((def) => serializeProvider(def, uid, settingsMap)));
  res.json({ providers, adapterTypes: ADAPTER_TYPES, rawValuesReturned: false });
});

router.post("/providers", async (req, res): Promise<void> => {
  const body = req.body as { providers?: Array<{ id: string; enabled?: boolean; model?: string; endpoint?: string; adapterType?: AdapterType }> };
  if (!Array.isArray(body.providers)) { res.status(400).json({ error: "providers array is required" }); return; }
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const p of body.providers) {
    const def = providerDefFor(p.id);
    if (!def) { results.push({ id: p.id, ok: false, error: "Invalid provider id" }); continue; }
    if (p.enabled !== undefined) await upsertSetting(enabledSettingKey(def.id), String(p.enabled));
    if (p.model !== undefined && def.modelSettingKey) await upsertSetting(def.modelSettingKey, p.model.trim());
    if (p.endpoint !== undefined && def.endpointSettingKey) await upsertSetting(def.endpointSettingKey, p.endpoint.trim());
    if (p.adapterType !== undefined) await upsertSetting(adapterSettingKey(def.id), parseAdapterType(p.adapterType, def.adapterType));
    results.push({ id: p.id, ok: true });
  }
  res.json({ ok: true, results, rawValuesReturned: false });
});

router.patch("/providers/:provider", async (req, res): Promise<void> => {
  const id = String(req.params["provider"] ?? "").toLowerCase();
  const def = providerDefFor(id);
  if (!def) { res.status(404).json({ error: `Unknown or invalid provider: ${id}` }); return; }
  const body = req.body as { enabled?: boolean; model?: string; endpoint?: string; key?: string; adapterType?: AdapterType };
  if (body.enabled !== undefined) await upsertSetting(enabledSettingKey(def.id), String(body.enabled));
  if (body.model !== undefined && def.modelSettingKey) await upsertSetting(def.modelSettingKey, body.model.trim());
  if (body.endpoint !== undefined && def.endpointSettingKey) await upsertSetting(def.endpointSettingKey, body.endpoint.trim());
  if (body.adapterType !== undefined) await upsertSetting(adapterSettingKey(def.id), parseAdapterType(body.adapterType, def.adapterType));
  if (body.key !== undefined && def.acceptsKey) {
    const key = body.key.trim();
    if (!key) {
      await deleteSetting(`${settingPrefix(def.id)}_API_KEY`).catch(() => {});
      await deleteVibaCredential({ userId: userId(req), provider: def.id, kind: "api_key", label: "default" }).catch(() => undefined);
    } else {
      await saveVibaCredential({ userId: userId(req), provider: def.id, kind: "api_key", value: key, label: "default" });
      await logVibaEvent({ userId: userId(req), eventType: "provider_key_saved", provider: def.id, status: "saved", message: `${def.label} credential saved to vault.` });
    }
  }
  res.json({ ok: true, provider: def.id, rawValuesReturned: false });
});

router.post("/providers/:provider/test", async (req, res): Promise<void> => {
  const id = String(req.params["provider"] ?? "").toLowerCase();
  const def = providerDefFor(id);
  if (!def) { res.status(404).json({ error: `Unknown or invalid provider: ${id}` }); return; }
  const allSettings = await db.select().from(settingsTable);
  const settingsMap = new Map(allSettings.map((s) => [s.key, s.value]));
  const hasKey = await hasKeyConfigured(def, userId(req));
  if (!configured(def, hasKey, settingsMap)) { res.json({ configured: false, message: "Provider is missing a required credential or endpoint.", rawValuesReturned: false }); return; }
  if (def.hasEndpoint && savedEndpoint(def, settingsMap)) {
    const endpoint = savedEndpoint(def, settingsMap);
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(endpoint, { signal: controller.signal }).finally(() => clearTimeout(t));
      res.json({ configured: true, reachable: r.status < 500, statusCode: r.status, message: `Endpoint responded with HTTP ${r.status}.`, rawValuesReturned: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.json({ configured: false, reachable: false, message: `Endpoint unreachable: ${msg}`, rawValuesReturned: false });
    }
    return;
  }
  res.json({ configured: true, requiresManualValidation: true, message: "Credential is present. Live validation happens during a real session.", rawValuesReturned: false });
});

router.get("/providers/:provider/keys", async (req, res): Promise<void> => {
  const id = String(req.params["provider"] ?? "").toLowerCase();
  const def = providerDefFor(id);
  if (!def) { res.status(404).json({ error: `Unknown or invalid provider: ${id}` }); return; }
  const all = await listVibaCredentials(userId(req));
  const keys = all.filter((c) => c.provider === def.id && c.kind === "api_key").map((c) => ({ label: c.label, status: c.status, lastUsedAt: c.last_used_at ?? null, updatedAt: c.updated_at }));
  res.json({ provider: def.id, keys, rawValuesReturned: false });
});

router.post("/providers/:provider/keys", async (req, res): Promise<void> => {
  const id = String(req.params["provider"] ?? "").toLowerCase();
  const def = providerDefFor(id);
  if (!def) { res.status(404).json({ error: `Unknown or invalid provider: ${id}` }); return; }
  if (!def.acceptsKey) { res.status(400).json({ error: "This provider does not use a stored secret." }); return; }
  const body = req.body as { key?: string; label?: string };
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : "default";
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) { res.status(400).json({ error: "key is required" }); return; }
  await saveVibaCredential({ userId: userId(req), provider: def.id, kind: "api_key", value: key, label });
  await logVibaEvent({ userId: userId(req), eventType: "provider_key_saved", provider: def.id, status: "saved", message: `${def.label} credential saved to vault with label ${label}.` });
  res.json({ ok: true, provider: def.id, label, rawValuesReturned: false });
});

router.delete("/providers/:provider/keys/:label", async (req, res): Promise<void> => {
  const id = String(req.params["provider"] ?? "").toLowerCase();
  const label = String(req.params["label"] ?? "");
  const def = providerDefFor(id);
  if (!def) { res.status(404).json({ error: `Unknown or invalid provider: ${id}` }); return; }
  if (!label) { res.status(400).json({ error: "label is required" }); return; }
  const result = await deleteVibaCredential({ userId: userId(req), provider: def.id, kind: "api_key", label });
  await logVibaEvent({ userId: userId(req), eventType: "provider_key_deleted", provider: def.id, status: "deleted", message: `${def.label} stored credential removed.` });
  res.json({ ok: true, deleted: result.deleted, provider: def.id, label, rawValuesReturned: false });
});

router.get("/providers/setting/:key", async (req, res): Promise<void> => {
  const key = String(req.params["key"] ?? "");
  if (!key || key.length > 64) { res.status(400).json({ error: "Invalid key" }); return; }
  const value = await getSettingValue(key);
  res.json({ key, value });
});

export default router;
