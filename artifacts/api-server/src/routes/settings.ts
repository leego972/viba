import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { GetSettingsResponse, SaveSettingsBody, SaveSettingsResponse } from "@workspace/api-zod";

const ALLOWED_SETTINGS_KEYS = new Set([
  "FALLBACK_ALERT_THRESHOLD",
  "FALLBACK_ALERT_ENABLED",
  "NOTIFICATION_WEBHOOK_URL",
  "NOTIFICATION_EMAIL",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "PERPLEXITY_API_KEY",
  "MISTRAL_API_KEY",
  "DEEPSEEK_API_KEY",
  "GROQ_API_KEY",
  "VENICE_API_KEY",
  "CUSTOM_API_KEY",
  "GITHUB_TOKEN",
  "VAST_AI_API_KEY",
  "ELEVENLABS_API_KEY",
  "OPENAI_MODEL",
  "ANTHROPIC_MODEL",
  "GEMINI_MODEL",
  "PERPLEXITY_MODEL",
  "MISTRAL_MODEL",
  "DEEPSEEK_MODEL",
  "GROQ_MODEL",
  "VENICE_MODEL",
  "CUSTOM_MODEL",
  "CUSTOM_ENDPOINT",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
]);

const CLEARABLE_NOTIFICATION_KEYS = [
  "NOTIFICATION_WEBHOOK_URL",
  "NOTIFICATION_EMAIL",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "PERPLEXITY_API_KEY",
  "MISTRAL_API_KEY",
  "DEEPSEEK_API_KEY",
  "GROQ_API_KEY",
  "VENICE_API_KEY",
  "CUSTOM_API_KEY",
  "GITHUB_TOKEN",
  "VAST_AI_API_KEY",
  "ELEVENLABS_API_KEY",
];

const PROVIDER_BY_KEY: Record<string, string> = {
  OPENAI_API_KEY: "openai",
  ANTHROPIC_API_KEY: "anthropic",
  GEMINI_API_KEY: "google",
  PERPLEXITY_API_KEY: "perplexity",
  MISTRAL_API_KEY: "mistral",
  DEEPSEEK_API_KEY: "deepseek",
  GROQ_API_KEY: "groq",
  VENICE_API_KEY: "venice",
  CUSTOM_API_KEY: "custom",
};

const MASKED_KEYS = new Set(["SMTP_PASS", "GITHUB_TOKEN", "VAST_AI_API_KEY"]);
const router: IRouter = Router();

function serializeSetting(s: { id: number; key: string; value: string | null; createdAt: Date; updatedAt: Date }) {
  return {
    ...s,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function maskValue(key: string, value: string | null): string | null {
  if (!value) return value;
  if (key.toLowerCase().includes("api_key") || MASKED_KEYS.has(key)) return "***SET***";
  return value;
}

function enabledSettingKey(provider: string): string {
  return `PROVIDER_ENABLED__${provider.toLowerCase()}`;
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

async function setProviderEnabled(provider: string, enabled: boolean): Promise<void> {
  await upsertSetting(enabledSettingKey(provider), String(enabled));
  await deleteSetting(`${provider.toUpperCase()}_ENABLED`);
}

router.get("/settings", async (_req, res): Promise<void> => {
  const settings = await db.select().from(settingsTable);
  const safeSettings = settings.map((s) => serializeSetting({
    ...s,
    value: maskValue(s.key, s.value),
  }));
  res.json(GetSettingsResponse.parse(safeSettings));
});

router.post("/settings", async (req, res): Promise<void> => {
  const parsed = SaveSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const unknownKeys = parsed.data.settings
    .map((s) => s.key)
    .filter((k) => !ALLOWED_SETTINGS_KEYS.has(k));
  if (unknownKeys.length > 0) {
    res.status(400).json({
      error: `Unknown settings key(s): ${unknownKeys.join(", ")}. Only recognised configuration keys are accepted.`,
    });
    return;
  }

  const keyResults: Array<{ key: string; status: "saved" | "skipped" | "deleted" }> = [];

  for (const { key, value } of parsed.data.settings) {
    if (value === "***SET***") {
      keyResults.push({ key, status: "skipped" });
      continue;
    }

    if (value === "" && CLEARABLE_NOTIFICATION_KEYS.includes(key)) {
      await deleteSetting(key);
      const provider = PROVIDER_BY_KEY[key];
      if (provider) await setProviderEnabled(provider, false);
      keyResults.push({ key, status: "deleted" });
      continue;
    }

    if (value === "") {
      keyResults.push({ key, status: "skipped" });
      continue;
    }

    if (key === "FALLBACK_ALERT_THRESHOLD") {
      const n = parseInt(value, 10);
      if (!/^\d+$/.test(value) || isNaN(n) || n < 1) {
        res.status(400).json({ error: "FALLBACK_ALERT_THRESHOLD must be a positive whole number (e.g. 5)." });
        return;
      }
    }

    await upsertSetting(key, value);

    const provider = PROVIDER_BY_KEY[key];
    if (provider) await setProviderEnabled(provider, true);

    keyResults.push({ key, status: "saved" });
  }

  const allSettings = await db.select().from(settingsTable);
  const safeSettings = allSettings.map((s) => serializeSetting({
    ...s,
    value: maskValue(s.key, s.value),
  }));
  res.json(SaveSettingsResponse.parse({ settings: safeSettings, results: keyResults }));
});

export default router;
