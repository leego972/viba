import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  deleteVibaCredential,
  listVibaCredentials,
  logVibaEvent,
  resolveVibaCredential,
  saveVibaCredential,
} from "../lib/vibaVault";
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
  hasEndpoint: boolean;
  endpointSettingKey: string | null;
  defaultEndpoint: string;
  adapterType?: string;
}

interface DynamicProviderMeta {
  id: string;
  label: string;
  description?: string;
  adapterType?: string;
  model?: string;
  endpoint?: string;
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
    adapterType: "openai",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    description: "Powers Claude Sonnet, Opus, and Haiku models.",
    keyEnvVar: "ANTHROPIC_API_KEY",
    modelSettingKey: "ANTHROPIC_MODEL",
    defaultModel: "claude-3-5-sonnet-20241022",
    modelOptions: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
    hasEndpoint: false,
    endpointSettingKey: null,
    defaultEndpoint: "",
    adapterType: "anthropic",
  },
  {
    id: "google",
    label: "Google Gemini",
    description: "Powers Gemini Flash and Pro models.",
    keyEnvVar: "GEMINI_API_KEY",
    modelSettingKey: "GEMINI_MODEL",
    defaultModel: "gemini-2.0-flash",
    modelOptions: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"],
    hasEndpoint: false,
    endpointSettingKey: null,
    defaultEndpoint: "",
    adapterType: "gemini",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    description: "Web-connected research and citation-backed answers.",
    keyEnvVar: "PERPLEXITY_API_KEY",
    modelSettingKey: "PERPLEXITY_MODEL",
    defaultModel: "sonar",
    modelOptions: ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro"],
    hasEndpoint: false,
    endpointSettingKey: null,
    defaultEndpoint: "",
    adapterType: "perplexity",
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
    adapterType: "groq",
  },
  {
    id: "ollama",
    label: "Local / Self-hosted (Ollama)",
    description: "Ollama or any OpenAI-compatible local server.",
    keyEnvVar: null,
    modelSettingKey: "OLLAMA_MODEL",
    defaultModel: "llama3.2",
    modelOptions: [],
    hasEndpoint: true,
    endpointSettingKey: "OLLAMA_BASE_URL",
    defaultEndpoint: "http://localhost:11434",
    adapterType: "ollama",
  },
  {
    id: "venice",
    label: "Venice AI",
    description: "Privacy-first OpenAI-compatible AI provider.",
    keyEnvVar: "VENICE_API_KEY",
    modelSettingKey: "VENICE_MODEL",
    defaultModel: "llama-3.3-70b",
    modelOptions: ["llama-3.3-70b", "llama-3.1-405b", "mistral-31-24b", "venice-uncensored", "qwen-2.5-vl", "deepseek-r1-671b"],
    hasEndpoint: true,
    endpointSettingKey: "VENICE_ENDPOINT",
    defaultEndpoint: "https://api.venice.ai/api/v1",
    adapterType: "openai-compatible",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    description: "Mistral and Codestral build and code-review agents.",
    keyEnvVar: "MISTRAL_API_KEY",
    modelSettingKey: "MISTRAL_MODEL",
    defaultModel: "mistral-large-latest",
    modelOptions: ["mistral-large-latest", "mistral-small-latest", "codestral-latest", "open-mixtral-8x22b", "ministral-8b-latest"],
    hasEndpoint: false,
    endpointSettingKey: null,
    defaultEndpoint: "",
    adapterType: "openai-compatible",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek research, coding and reasoning models.",
    keyEnvVar: "DEEPSEEK_API_KEY",
    modelSettingKey: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-chat",
    modelOptions: ["deepseek-chat", "deepseek-reasoner"],
    hasEndpoint: true,
    endpointSettingKey: "DEEPSEEK_ENDPOINT",
    defaultEndpoint: "https://api.deepseek.com",
    adapterType: "openai-compatible",
  },
  {
    id: "github",
    label: "GitHub",
    description: "Repository, file, pull request and issue access.",
    keyEnvVar: "GITHUB_TOKEN",
    modelSettingKey: null,
    defaultModel: "",
    modelOptions: [],
    hasEndpoint: true,
    endpointSettingKey: "GITHUB_ENDPOINT",
    defaultEndpoint: "https://api.github.com",
    adapterType: "service-token",
  },
  {
    id: "vastai",
    label: "Vast.ai",
    description: "GPU compute marketplace and instance management.",
    keyEnvVar: "VAST_AI_API_KEY",
    modelSettingKey: null,
    defaultModel: "",
    modelOptions: [],
    hasEndpoint: false,
    endpointSettingKey: null,
    defaultEndpoint: "",
    adapterType: "service-token",
  },
  {
    id: "custom",
    label: "Custom / Generic AI",
    description: "Any OpenAI-compatible or custom AI endpoint.",
    keyEnvVar: "CUSTOM_API_KEY",
    modelSettingKey: "CUSTOM_MODEL",
    defaultModel: "",
    modelOptions: [],
    hasEndpoint: true,
    endpointSettingKey: "CUSTOM_ENDPOINT",
    defaultEndpoint: "",
    adapterType: "auto",
  },
];

const FIXED_IDS = new Set<string>(PROVIDER_DEFS.map((provider) => provider.id));

function normalizeProviderId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function displayName(id: string): string {
  return id
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || id;
}

function metaSettingKey(id: string): string {
  return `PROVIDER_META__${id}`;
}

function enabledSettingKey(id: string): string {
  return `PROVIDER_ENABLED__${id}`;
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

function parseMeta(raw: string | undefined): DynamicProviderMeta | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DynamicProviderMeta;
    return parsed && typeof parsed.id === "string" ? parsed : null;
  } catch {
    return null;
  }
}

async function hasFixedKeyConfigured(definition: ProviderDef, uid: number | null): Promise<boolean> {
  if (!definition.keyEnvVar) return true;
  if (process.env[definition.keyEnvVar]) return true;
  const legacySetting = await getSettingValue(definition.keyEnvVar);
  if (legacySetting) return true;
  const resolved = await resolveVibaCredential({
    userId: uid,
    provider: definition.id,
    kind: "api_key",
    envNames: [definition.keyEnvVar],
  });
  return resolved.source === "vault";
}

async function providerExistsInVault(uid: number | null, id: string): Promise<boolean> {
  const entries = await listVibaCredentials(uid);
  return entries.some(
    (entry) => entry.provider === id && entry.kind === "api_key" && entry.status !== "deleted",
  );
}

router.get("/providers", async (req, res): Promise<void> => {
  const uid = userId(req);
  const [allSettings, credentials] = await Promise.all([
    db.select().from(settingsTable),
    listVibaCredentials(uid),
  ]);
  const settingsMap = new Map<string, string>(
    allSettings.map((setting) => [String(setting.key), String(setting.value)]),
  );
  const credentialProviders = new Set<string>(
    credentials
      .filter((entry) => entry.kind === "api_key" && entry.status !== "deleted")
      .map((entry) => String(entry.provider ?? "").trim())
      .filter(Boolean),
  );

  const fixedProviders = await Promise.all(
    PROVIDER_DEFS.map(async (definition) => {
      const hasKey = await hasFixedKeyConfigured(definition, uid);
      const explicitEnabled =
        settingsMap.get(enabledSettingKey(definition.id)) ??
        settingsMap.get(`${definition.id.toUpperCase()}_ENABLED`);
      const enabled = explicitEnabled === undefined ? hasKey : explicitEnabled === "true";
      const model = settingsMap.get(definition.modelSettingKey ?? "") ?? definition.defaultModel;
      const endpoint = definition.endpointSettingKey
        ? settingsMap.get(definition.endpointSettingKey) ?? definition.defaultEndpoint
        : undefined;
      const status: ProviderStatus =
        !hasKey && definition.keyEnvVar !== null
          ? "not_configured"
          : enabled
            ? "configured"
            : "disabled";
      return {
        id: definition.id,
        label: definition.label,
        description: definition.description,
        hasKey,
        enabled,
        model,
        endpoint,
        hasEndpoint: definition.hasEndpoint,
        defaultModel: definition.defaultModel,
        modelOptions: definition.modelOptions,
        adapterType: definition.adapterType,
        status,
      };
    }),
  );

  const dynamicIds = new Set<string>();
  for (const provider of credentialProviders) {
    if (!FIXED_IDS.has(provider)) dynamicIds.add(provider);
  }
  for (const key of settingsMap.keys()) {
    if (!key.startsWith("PROVIDER_META__")) continue;
    const id = key.slice("PROVIDER_META__".length);
    if (id && !FIXED_IDS.has(id)) dynamicIds.add(id);
  }

  const dynamicProviders = [...dynamicIds].map((id) => {
    const meta = parseMeta(settingsMap.get(metaSettingKey(id))) ?? {
      id,
      label: displayName(id),
    };
    const hasKey = credentialProviders.has(id);
    const explicitEnabled = settingsMap.get(enabledSettingKey(id));
    const enabled = explicitEnabled === undefined ? hasKey : explicitEnabled === "true";
    const status: ProviderStatus = !hasKey
      ? "not_configured"
      : enabled
        ? "configured"
        : "disabled";
    return {
      id,
      label: meta.label || displayName(id),
      description: meta.description ?? "User-provided API connection.",
      hasKey,
      enabled,
      model: meta.model ?? "",
      endpoint: meta.endpoint,
      hasEndpoint: Boolean(meta.endpoint),
      defaultModel: meta.model ?? "",
      modelOptions: [] as string[],
      adapterType: meta.adapterType ?? "auto",
      status,
    };
  });

  const providers = [...fixedProviders, ...dynamicProviders].sort((left, right) => {
    if (left.status === "configured" && right.status !== "configured") return -1;
    if (left.status !== "configured" && right.status === "configured") return 1;
    return left.label.localeCompare(right.label);
  });

  res.json({
    providers,
    configuredProviderIds: providers
      .filter((provider) => provider.status === "configured")
      .map((provider) => provider.id),
  });
});

router.post("/providers", async (req, res): Promise<void> => {
  const body = req.body as {
    providers?: Array<{ id: string; enabled?: boolean; model?: string }>;
  };
  if (!Array.isArray(body.providers)) {
    res.status(400).json({ error: "providers array is required" });
    return;
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const item of body.providers) {
    const id = normalizeProviderId(item.id);
    if (!id) {
      results.push({ id: item.id, ok: false, error: "Invalid provider ID" });
      continue;
    }
    if (item.enabled !== undefined) {
      await upsertSetting(enabledSettingKey(id), String(item.enabled));
    }
    const fixed = PROVIDER_DEFS.find((provider) => provider.id === id);
    if (item.model !== undefined) {
      if (fixed?.modelSettingKey) {
        await upsertSetting(fixed.modelSettingKey, item.model);
      } else {
        const current = parseMeta(
          (await getSettingValue(metaSettingKey(id))) ?? undefined,
        ) ?? { id, label: displayName(id) };
        await upsertSetting(
          metaSettingKey(id),
          JSON.stringify({ ...current, model: item.model }),
        );
      }
    }
    results.push({ id, ok: true });
  }
  res.json({ ok: true, results });
});

router.patch("/providers/:provider", async (req, res): Promise<void> => {
  const id = normalizeProviderId(String(req.params["provider"] ?? ""));
  if (!id) {
    res.status(400).json({ error: "Invalid provider ID" });
    return;
  }

  const fixed = PROVIDER_DEFS.find((provider) => provider.id === id);
  const body = req.body as {
    enabled?: boolean;
    model?: string;
    endpoint?: string;
    key?: string;
    adapterType?: string;
    label?: string;
    description?: string;
  };

  if (body.enabled !== undefined) {
    await upsertSetting(enabledSettingKey(id), String(body.enabled));
  }

  if (fixed) {
    if (body.model !== undefined && fixed.modelSettingKey) {
      await upsertSetting(fixed.modelSettingKey, body.model);
    }
    if (body.endpoint !== undefined && fixed.endpointSettingKey) {
      await upsertSetting(fixed.endpointSettingKey, body.endpoint);
    }
  } else {
    const current = parseMeta(
      (await getSettingValue(metaSettingKey(id))) ?? undefined,
    ) ?? { id, label: body.label?.trim() || displayName(id) };
    const next: DynamicProviderMeta = {
      ...current,
      id,
      label: body.label?.trim() || current.label || displayName(id),
      description: body.description?.trim() || current.description,
      adapterType: body.adapterType?.trim() || current.adapterType || "auto",
      model: body.model?.trim() || current.model,
      endpoint: body.endpoint?.trim() || current.endpoint,
    };
    await upsertSetting(metaSettingKey(id), JSON.stringify(next));
  }

  if (body.key !== undefined) {
    if (body.key.trim() === "") {
      await deleteVibaCredential({
        userId: userId(req),
        provider: id,
        kind: "api_key",
        label: "default",
      });
    } else {
      await saveVibaCredential({
        userId: userId(req),
        provider: id,
        kind: "api_key",
        value: body.key.trim(),
        label: "default",
      });
      await logVibaEvent({
        userId: userId(req),
        eventType: "provider_key_saved",
        provider: id,
        status: "saved",
        message: `${fixed?.label ?? displayName(id)} API key saved to vault.`,
      });
    }
  }

  res.json({
    ok: true,
    provider: id,
    configured:
      (await providerExistsInVault(userId(req), id)) ||
      (fixed ? await hasFixedKeyConfigured(fixed, userId(req)) : false),
  });
});

router.post("/providers/:provider/test", async (req, res): Promise<void> => {
  const id = normalizeProviderId(String(req.params["provider"] ?? ""));
  const fixed = PROVIDER_DEFS.find((provider) => provider.id === id);
  const configured = fixed
    ? await hasFixedKeyConfigured(fixed, userId(req))
    : await providerExistsInVault(userId(req), id);

  if (!configured && fixed?.keyEnvVar !== null) {
    res.json({
      configured: false,
      message: "No API key configured. Enter your key and save first.",
    });
    return;
  }

  if (id === "github") {
    const token = (
      await resolveVibaCredential({
        userId: userId(req),
        provider: "github",
        kind: "api_key",
        envNames: ["GITHUB_TOKEN"],
      })
    ).value;
    if (!token) {
      res.json({ configured: false, message: "No GitHub token configured." });
      return;
    }
    const result = await validateGithub(token);
    res.json({
      configured: result.ok,
      reachable: result.ok,
      message: result.message,
      details: result.details,
    });
    return;
  }

  if (id === "vastai") {
    const { getVastConnectorStatus } = await import("../lib/vastaiConnector");
    const status = await getVastConnectorStatus();
    res.json({
      configured: status.apiAvailable,
      reachable: status.apiAvailable,
      message: status.apiAvailable
        ? `Vast.ai key is valid. ${status.instanceCount ?? 0} instance(s) on this account.`
        : status.error ?? "Vast.ai API check failed.",
    });
    return;
  }

  res.json({
    configured: true,
    requiresManualValidation: true,
    message: "API key is present. Live validation occurs during a real session; no paid call was made.",
  });
});

router.get("/providers/:provider/keys", async (req, res): Promise<void> => {
  const id = normalizeProviderId(String(req.params["provider"] ?? ""));
  if (!id) {
    res.status(400).json({ error: "Invalid provider ID" });
    return;
  }
  const all = await listVibaCredentials(userId(req));
  const keys = all
    .filter((entry) => entry.provider === id && entry.kind === "api_key")
    .map((entry) => ({
      label: entry.label,
      status: entry.status,
      lastUsedAt: entry.last_used_at ?? null,
      updatedAt: entry.updated_at,
    }));
  res.json({ provider: id, keys });
});

router.post("/providers/:provider/keys", async (req, res): Promise<void> => {
  const id = normalizeProviderId(String(req.params["provider"] ?? ""));
  const body = req.body as { key?: string; label?: string };
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, 80)
      : "default";
  if (!id || !key) {
    res.status(400).json({ error: "provider and key are required" });
    return;
  }
  await saveVibaCredential({
    userId: userId(req),
    provider: id,
    kind: "api_key",
    value: key,
    label,
  });
  await logVibaEvent({
    userId: userId(req),
    eventType: "provider_key_saved",
    provider: id,
    status: "saved",
    message: `${displayName(id)} API key saved with label ${label}.`,
  });
  res.json({ ok: true, provider: id, label });
});

router.delete("/providers/:provider/keys/:label", async (req, res): Promise<void> => {
  const id = normalizeProviderId(String(req.params["provider"] ?? ""));
  const label = String(req.params["label"] ?? "").trim();
  if (!id || !label) {
    res.status(400).json({ error: "provider and label are required" });
    return;
  }
  const result = await deleteVibaCredential({
    userId: userId(req),
    provider: id,
    kind: "api_key",
    label,
  });
  await logVibaEvent({
    userId: userId(req),
    eventType: "provider_key_deleted",
    provider: id,
    status: "deleted",
    message: `${displayName(id)} API key ${label} removed.`,
  });
  res.json({ ok: true, deleted: result.deleted, provider: id, label });
});

router.get("/providers/setting/:key", async (req, res): Promise<void> => {
  const key = String(req.params["key"] ?? "");
  if (!key || key.length > 64 || /KEY|TOKEN|SECRET|PASSWORD/i.test(key)) {
    res.status(400).json({ error: "Invalid or sensitive setting key" });
    return;
  }
  const value = await getSettingValue(key);
  res.json({ key, value });
});

export default router;
