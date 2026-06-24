import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

interface ProviderDef {
  id: string;
  label: string;
  description: string;
  keyEnvVar: string | null;
  keySettingKey: string | null;
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
    keySettingKey: "OPENAI_API_KEY",
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
    keySettingKey: "ANTHROPIC_API_KEY",
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
    keySettingKey: "GEMINI_API_KEY",
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
    keySettingKey: "GROQ_API_KEY",
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
    keySettingKey: null,
    modelSettingKey: "LOCAL_MODEL",
    defaultModel: "llama3",
    modelOptions: [],
    hasEndpoint: true,
    endpointSettingKey: "LOCAL_ENDPOINT",
    defaultEndpoint: "http://localhost:11434",
  },
  {
    id: "custom",
    label: "Custom HTTP Provider",
    description: "Any OpenAI-compatible HTTP endpoint with optional bearer key.",
    keyEnvVar: null,
    keySettingKey: "CUSTOM_API_KEY",
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

function hasKeyConfigured(def: ProviderDef, settingsMap: Map<string, string | null>): boolean {
  if (!def.keySettingKey && !def.keyEnvVar) return true;
  const fromEnv = def.keyEnvVar ? (process.env[def.keyEnvVar] ?? null) : null;
  const fromDb = def.keySettingKey ? (settingsMap.get(def.keySettingKey) ?? null) : null;
  return !!(fromEnv || fromDb);
}

// GET /providers — list all providers with status (never return key values)
router.get("/providers", async (_req, res): Promise<void> => {
  const allSettings = await db.select().from(settingsTable);
  const settingsMap = new Map(allSettings.map((s) => [s.key, s.value]));

  const providers = PROVIDER_DEFS.map((def) => {
    const hasKey = hasKeyConfigured(def, settingsMap);
    const enabled = settingsMap.get(`${def.id.toUpperCase()}_ENABLED`) === "true";
    const model = settingsMap.get(def.modelSettingKey ?? "") ?? def.defaultModel;
    const endpoint = def.endpointSettingKey
      ? (settingsMap.get(def.endpointSettingKey) ?? def.defaultEndpoint)
      : undefined;

    let status: "not_configured" | "configured" | "disabled";
    if (!hasKey && def.keySettingKey !== null) {
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
  });

  res.json({ providers });
});

// PATCH /providers/:provider — update non-secret config + enable/disable + key
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
    await upsertSetting(def.endpointSettingKey, body.endpoint);
  }
  if (body.key !== undefined && def.keySettingKey) {
    if (body.key === "") {
      await deleteSetting(def.keySettingKey);
    } else {
      await upsertSetting(def.keySettingKey, body.key);
    }
  }

  res.json({ ok: true, provider: def.id });
});

// POST /providers/:provider/test — safe connection test (no paid API calls)
router.post("/providers/:provider/test", async (req, res): Promise<void> => {
  const id = String(req.params["provider"] ?? "");
  const def = PROVIDER_DEFS.find((d) => d.id === id);
  if (!def) { res.status(404).json({ error: `Unknown provider: ${id}` }); return; }

  const allSettings = await db.select().from(settingsTable);
  const settingsMap = new Map(allSettings.map((s) => [s.key, s.value]));
  const hasKey = hasKeyConfigured(def, settingsMap);

  if (!hasKey && def.keySettingKey !== null) {
    res.json({ configured: false, message: "No API key configured. Enter your key and save first." });
    return;
  }

  if (def.id === "local" || def.id === "custom") {
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

export default router;
