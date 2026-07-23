import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GetSettingsResponse, SaveSettingsBody, SaveSettingsResponse } from "@workspace/api-zod";
import { requireOwnerAdmin } from "../middlewares/requireOwnerAdmin";

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

const SECRET_SETTING_KEYS = new Set([
  "NOTIFICATION_WEBHOOK_URL",
  "SMTP_PASS",
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
]);

const PROVIDER_BY_KEY: Record<string, string> = {
  OPENAI_API_KEY: "OPENAI",
  ANTHROPIC_API_KEY: "ANTHROPIC",
  GEMINI_API_KEY: "GOOGLE",
  PERPLEXITY_API_KEY: "PERPLEXITY",
  MISTRAL_API_KEY: "MISTRAL",
  DEEPSEEK_API_KEY: "DEEPSEEK",
  GROQ_API_KEY: "GROQ",
  VENICE_API_KEY: "VENICE",
  CUSTOM_API_KEY: "CUSTOM",
};

const router: IRouter = Router();
router.use(requireOwnerAdmin);

function serializeSetting(setting: { id: number; key: string; value: string | null; createdAt: Date; updatedAt: Date }) {
  return {
    ...setting,
    createdAt: setting.createdAt.toISOString(),
    updatedAt: setting.updatedAt.toISOString(),
  };
}

function maskValue(key: string, value: string | null): string | null {
  if (!value) return value;
  return SECRET_SETTING_KEYS.has(key) ? "***SET***" : value;
}

async function upsertSetting(key: string, value: string): Promise<void> {
  const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (existing) {
    await db.update(settingsTable).set({ value, updatedAt: new Date() }).where(eq(settingsTable.key, key));
  } else {
    await db.insert(settingsTable).values({ key, value });
  }
}

router.get("/settings", async (_req, res): Promise<void> => {
  const settings = await db.select().from(settingsTable);
  const safeSettings = settings.map((setting) => serializeSetting({
    ...setting,
    value: maskValue(setting.key, setting.value),
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
    .map((setting) => setting.key)
    .filter((key) => !ALLOWED_SETTINGS_KEYS.has(key));
  if (unknownKeys.length > 0) {
    res.status(400).json({
      error: `Unknown settings key(s): ${unknownKeys.join(", ")}.`,
    });
    return;
  }

  const plaintextSecret = parsed.data.settings.find(
    ({ key, value }) => SECRET_SETTING_KEYS.has(key) && value !== "" && value !== "***SET***",
  );
  if (plaintextSecret) {
    res.status(400).json({
      error: `${plaintextSecret.key} cannot be stored in the plaintext settings table. Put platform secrets in Render environment variables or customer provider keys in the encrypted VIBA Vault.`,
      code: "PLAINTEXT_SECRET_REJECTED",
    });
    return;
  }

  const keyResults: Array<{ key: string; status: "saved" | "skipped" | "deleted" }> = [];

  for (const { key, value } of parsed.data.settings) {
    if (value === "***SET***") {
      keyResults.push({ key, status: "skipped" });
      continue;
    }

    if (value === "") {
      await db.delete(settingsTable).where(eq(settingsTable.key, key));
      const provider = PROVIDER_BY_KEY[key];
      if (provider) await upsertSetting(`${provider}_ENABLED`, "false");
      keyResults.push({ key, status: "deleted" });
      continue;
    }

    if (key === "FALLBACK_ALERT_THRESHOLD") {
      const threshold = Number.parseInt(value, 10);
      if (!/^\d+$/.test(value) || Number.isNaN(threshold) || threshold < 1) {
        res.status(400).json({ error: "FALLBACK_ALERT_THRESHOLD must be a positive whole number." });
        return;
      }
    }

    await upsertSetting(key, value);
    keyResults.push({ key, status: "saved" });
  }

  const allSettings = await db.select().from(settingsTable);
  const safeSettings = allSettings.map((setting) => serializeSetting({
    ...setting,
    value: maskValue(setting.key, setting.value),
  }));
  res.json(SaveSettingsResponse.parse({ settings: safeSettings, results: keyResults }));
});

export default router;
