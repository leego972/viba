import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { saveVibaCredential, resolveVibaCredential, logVibaEvent, listVibaCredentials, deleteVibaCredential } from "../lib/vibaVault";

const router: IRouter = Router();

interface ProviderDef {
  id: string;
  label: string;
  description: string;
  keyEnvVar: string | null;
  modelSettingKey: string | null;
  defaultModel: string;
  modelOptions: string[];
  hasEndpoint: boolean;
  endpointSettingKey: string | null;
  defaultEndpoint: string;
}

const PROVIDER_DEFS: ProviderDef[] = [
  {
    id: "openai",
    label: "OpenAI (ChatGPT)",
    description: "Powers GPT-4, GPT-4o, and o-series models.",
    keyEnvVar: "OPENAI_API_KEY",
    modelSettingKey: "OPENAI_MODEL",
    defaultModel: "gpt-4.1-mini",
    modelOptions: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o", "gpt-4o-mini", "o3-mini", "o1-mini"],
    hasEndpoint: false,
    endpointSettingKey: null,
    defaultEndpoint: "",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    description: "Powers Claude 3.5 Sonnet, Claude 3 Opus, and Haiku.",
    keyEnvVar: "ANTHROPIC_API_KEY",
    modelSettingKey: "ANTHROPIC_MODEL",
    defaultModel: "claude-3-5-sonnet-20241022",
    modelOptions: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
    hasEndpoint: false,
    endpointSettingKey: null,
    defaultEndpoint: "",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Powers Gemini 2.0 Flash and Gemini 1.5 Pro.",
    keyEnvVar: "GEMINI_API_KEY",
    modelSettingKey: "GEMINI_MODEL",
    defaultModel: "gemini-2.0-flash",
    modelOptions: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"],
    hasEndpoint: false,
    endpointSettingKey: null,
    defaultEndpoint: "",
  },
  {
    id: "groq",
    label: "Groq",
    description: "Ultra-fast open-source inference via Groq LPU hardware.",
    keyEnvVar: "GROQ_API_KEY",
    modelSettingKey: "GROQ_MODEL",
    defaultModel: "llama-3.3-70b-versatile",
    modelOptions: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"],
    hasEndpoint: false,
    endpointSettingKey: null,
    defaultEndpoint: "",
  },
  {
    id: "local",
    label: "Local / Self-hosted",
    description: "Ollama or any OpenAI-compatible local server. No API key required.",
    keyEnvVar: null,
    modelSettingKey: "LOCAL_MODEL",
    defaultModel: "llama3",
    modelOptions: [],
    hasEndpoint: true,
    endpointSettingKey: "LOCAL_ENDPOINT",
    defaultEndpoint: "http://localhost:11434",
  },
  {
    id: "custom",
    label: "Custom / Unlisted AI",
    description: "Venice, Together, OpenRouter, or any OpenAI-compatible endpoint.",
    keyEnvVar: "CUSTOM_API_KEY",
    modelSettingKey: "CUSTOM_MODEL",
    defaultModel: "",
    modelOptions: [],
    hasEndpoint: true,
    endpointSettingKey: "CUSTOM_ENDPOINT",
    defaultEndpoint: "",
  },
];

async function getSettingValue(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function upsertSetting(key: string, value: string): Promise<void> {
  const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (existing) {
    await db.update(settingsTable).set({ value }).where(eq(settingsTable.key, key));
  } else {
    await db.insert(settingsTable).values({ key, value });
  }
}

async function deleteSetting(key: string): Promise<void> {
  await db.delete(settingsTable).where(eq(settingsTable.key, key));
}

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

async function hasKeyConfigured(def: ProviderDef, userId: number | null): Promise<boolean> {
  if (!def.keyEnvVar) return true;
  if (process.env[def.keyEnvVar]) return true;
  const resolved = await resolveVibaCredential({ userId, provider: def.id, kind: "api_key", envNames: [def.keyEnvVar] });
  return resolved.source === "vault";
}

// GET /providers — list all providers with status (never return key values)
router.get("/providers", async (req, res): Promise<void> => {
  const uid = userId(req);
  const allSettings = await db.select().from(settingsTable);
  const settingsMap = new Map(allSettings.map((s) => [s.key, s.value]));

  const providers = await Promise.all(
    PROVIDER_DEFS.map(async (def) => {
      const hasKey = await hasKeyConfigured(def, uid);
      const enabledSetting = settingsMap.get(`${def.id.toUpperCase()}_ENABLED`);
      // If the key is available (env or vault) and no explicit disabled setting exists,
      // default to enabled so Groq (and other env-keyed providers) are ready out of the box.
      const enabled = enabledSetting !== undefined
        ? enabledSetting === "true"
        : hasKey;
      const model = settingsMap.get(def.modelSettingKey ?? "") ?? def.defaultModel;
      const endpoint = def.endpointSettingKey
        ? (settingsMap.get(def.endpointSettingKey) ?? def.defaultEndpoint)
        : undefined;

      let status: "not_configured" | "configured" | "disabled";
      if (!hasKey && def.keyEnvVar !== null) {
        status = "not_configured";
      } else if (!enabled) {
        status = "disabled";
      } else {
        status = "configured";
      }

      return {
        id: def.id,
        label: def.label,
        description: def.description,
        hasKey,
        enabled,
        model,
        endpoint,
        hasEndpoint: def.hasEndpoint,
        defaultModel: def.defaultModel,
        modelOptions: def.modelOptions,
        status,
      };
    }),
  );

  res.json({ providers });
});

// POST /providers — bulk-enable/configure multiple providers in one request
router.post("/providers", async (req, res): Promise<void> => {
  const body = req.body as { providers?: Array<{ id: string; enabled?: boolean; model?: string }> };
  if (!Array.isArray(body.providers)) {
    res.status(400).json({ error: "providers array is required" });
    return;
  }
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const p of body.providers) {
    const def = PROVIDER_DEFS.find((d) => d.id === p.id);
    if (!def) { results.push({ id: p.id, ok: false, error: "Unknown provider" }); continue; }
    if (p.enabled !== undefined) await upsertSetting(`${def.id.toUpperCase()}_ENABLED`, String(p.enabled));
    if (p.model !== undefined && def.modelSettingKey) await upsertSetting(def.modelSettingKey, p.model);
    results.push({ id: p.id, ok: true });
  }
  res.json({ ok: true, results });
});

// PATCH /providers/:provider — update non-secret config + enable/disable + key (key → vault only)
router.patch("/providers/:provider", async (req, res): Promise<void> => {
  const id = String(req.params["provider"] ?? "");
  const def = PROVIDER_DEFS.find((d) => d.id === id);
  if (!def) { res.status(404).json({ error: `Unknown provider: ${id}` }); return; }

  const body = req.body as { enabled?: boolean; model?: string; endpoint?: string; key?: string };

  if (body.enabled !== undefined) {
    await upsertSetting(`${def.id.toUpperCase()}_ENABLED`, String(body.enabled));
  }
  if (body.model !== undefined && def.modelSettingKey) {
    await upsertSetting(def.modelSettingKey, body.model);
  }
  if (body.endpoint !== undefined && def.endpointSettingKey) {
    // Endpoints are non-secret config (URLs, not keys)
    await upsertSetting(def.endpointSettingKey, body.endpoint);
  }
  if (body.key !== undefined && def.keyEnvVar !== null) {
    if (body.key === "") {
      // Clear: remove any old setting-table entry (migration cleanup) and vault entry
      const oldSettingKey = `${def.id.toUpperCase()}_API_KEY`;
      await deleteSetting(oldSettingKey).catch(() => {});
    } else {
      // Route API key to vault — never write raw key to settingsTable
      await saveVibaCredential({ userId: userId(req), provider: def.id, kind: "api_key", value: body.key, label: "default" });
      await logVibaEvent({ userId: userId(req), eventType: "provider_key_saved", provider: def.id, status: "saved", message: `${def.label} API key saved to vault.` });
    }
  }

  res.json({ ok: true, provider: def.id, configured: true });
});

// POST /providers/:provider/test — safe connection test (no paid API calls)
router.post("/providers/:provider/test", async (req, res): Promise<void> => {
  const id = String(req.params["provider"] ?? "");
  const def = PROVIDER_DEFS.find((d) => d.id === id);
  if (!def) { res.status(404).json({ error: `Unknown provider: ${id}` }); return; }

  const hasKey = await hasKeyConfigured(def, userId(req));

  if (!hasKey && def.keyEnvVar !== null) {
    res.json({ configured: false, message: "No API key configured. Enter your key and save first." });
    return;
  }

  if (def.id === "local" || def.id === "custom") {
    const allSettings = await db.select().from(settingsTable);
    const settingsMap = new Map(allSettings.map((s) => [s.key, s.value]));
    const endpoint = def.endpointSettingKey
      ? (settingsMap.get(def.endpointSettingKey) ?? def.defaultEndpoint)
      : def.defaultEndpoint;
    if (!endpoint) {
      res.json({ configured: false, message: "No endpoint URL configured." });
      return;
    }
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(endpoint, { signal: controller.signal }).finally(() => clearTimeout(t));
      res.json({
        configured: true,
        reachable: r.status < 500,
        statusCode: r.status,
        message: `Endpoint responded with HTTP ${r.status}.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.json({ configured: false, reachable: false, message: `Endpoint unreachable: ${msg}` });
    }
    return;
  }

  // Cloud providers — do NOT call paid API automatically
  res.json({
    configured: true,
    requiresManualValidation: true,
    message:
      "API key is present. Live validation requires a real session. No paid calls are made automatically.",
  });
});

// PATCH /providers/:provider — update non-secret config + enable/disable + key (key → vault only)
// Accepts optional `label` to save a key under a named slot (multi-key support).
// Extending here to avoid duplication — the previous PATCH handler is above, this extends the key-save path.

// GET /providers/:provider/keys — list all saved key labels for a provider (values never returned)
router.get("/providers/:provider/keys", async (req, res): Promise<void> => {
  const id = String(req.params["provider"] ?? "");
  const def = PROVIDER_DEFS.find((d) => d.id === id);
  if (!def) { res.status(404).json({ error: `Unknown provider: ${id}` }); return; }

  const all = await listVibaCredentials(userId(req));
  const keys = all
    .filter((c) => c.provider === def.id && c.kind === "api_key")
    .map((c) => ({
      label: c.label,
      status: c.status,
      lastUsedAt: c.last_used_at ?? null,
      updatedAt: c.updated_at,
    }));
  res.json({ provider: def.id, keys });
});

// POST /providers/:provider/keys — save a labeled key to the vault
router.post("/providers/:provider/keys", async (req, res): Promise<void> => {
  const id = String(req.params["provider"] ?? "");
  const def = PROVIDER_DEFS.find((d) => d.id === id);
  if (!def) { res.status(404).json({ error: `Unknown provider: ${id}` }); return; }
  if (def.keyEnvVar === null) { res.status(400).json({ error: "This provider does not use an API key." }); return; }

  const body = req.body as { key?: string; label?: string };
  const rawLabel = typeof body.label === "string" ? body.label.trim().slice(0, 80) : "";
  const label = rawLabel || "default";
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) { res.status(400).json({ error: "key is required" }); return; }

  await saveVibaCredential({ userId: userId(req), provider: def.id, kind: "api_key", value: key, label });
  await logVibaEvent({ userId: userId(req), eventType: "provider_key_saved", provider: def.id, status: "saved", message: `${def.label} API key saved to vault with label "${label}".` });
  res.json({ ok: true, provider: def.id, label });
});

// DELETE /providers/:provider/keys/:label — remove a specific labeled key
router.delete("/providers/:provider/keys/:label", async (req, res): Promise<void> => {
  const id = String(req.params["provider"] ?? "");
  const label = String(req.params["label"] ?? "");
  const def = PROVIDER_DEFS.find((d) => d.id === id);
  if (!def) { res.status(404).json({ error: `Unknown provider: ${id}` }); return; }
  if (!label) { res.status(400).json({ error: "label is required" }); return; }

  const result = await deleteVibaCredential({ userId: userId(req), provider: def.id, kind: "api_key", label });
  await logVibaEvent({ userId: userId(req), eventType: "provider_key_deleted", provider: def.id, status: "deleted", message: `${def.label} API key with label "${label}" removed from vault.` });
  res.json({ ok: true, deleted: result.deleted, provider: def.id, label });
});

// GET /providers/setting/:key — safe single-setting read (non-secret only)
router.get("/providers/setting/:key", async (req, res): Promise<void> => {
  const key = String(req.params["key"] ?? "");
  if (!key || key.length > 64) { res.status(400).json({ error: "Invalid key" }); return; }
  const value = await getSettingValue(key);
  res.json({ key, value });
});

export default router;
