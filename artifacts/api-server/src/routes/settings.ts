import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { GetSettingsResponse, SaveSettingsBody, SaveSettingsResponse } from "@workspace/api-zod";

const CLEARABLE_NOTIFICATION_KEYS = [
  "NOTIFICATION_WEBHOOK_URL",
  "NOTIFICATION_EMAIL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "PERPLEXITY_API_KEY",
  "REPLIT_API_KEY",
  "MANUS_API_KEY",
];

const router: IRouter = Router();

function serializeSetting(s: { id: number; key: string; value: string | null; createdAt: Date; updatedAt: Date }) {
  return {
    ...s,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// GET /settings
router.get("/settings", async (_req, res): Promise<void> => {
  const settings = await db.select().from(settingsTable);
  // Never return the actual value of sensitive keys (case-insensitive match)
  const safeSettings = settings.map((s) => serializeSetting({
    ...s,
    value: s.key.toLowerCase().includes("api_key") && s.value ? "***SET***" : s.value,
  }));
  res.json(GetSettingsResponse.parse(safeSettings));
});

// POST /settings
router.post("/settings", async (req, res): Promise<void> => {
  const parsed = SaveSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const keyResults: Array<{ key: string; status: "saved" | "skipped" | "deleted" }> = [];

  for (const { key, value } of parsed.data.settings) {
    // Don't update if value is the masked placeholder
    if (value === "***SET***") {
      keyResults.push({ key, status: "skipped" });
      continue;
    }

    // Clearing a clearable key with an empty string explicitly deletes it
    if (value === "" && CLEARABLE_NOTIFICATION_KEYS.includes(key)) {
      await db.delete(settingsTable).where(eq(settingsTable.key, key));
      keyResults.push({ key, status: "deleted" });
      continue;
    }

    // Non-clearable keys: treat empty string as a no-op to prevent silent data loss
    if (value === "") {
      keyResults.push({ key, status: "skipped" });
      continue;
    }

    // Validate FALLBACK_ALERT_THRESHOLD must be a positive integer
    if (key === "FALLBACK_ALERT_THRESHOLD") {
      const n = parseInt(value, 10);
      if (!/^\d+$/.test(value) || isNaN(n) || n < 1) {
        res.status(400).json({ error: "FALLBACK_ALERT_THRESHOLD must be a positive whole number (e.g. 5)." });
        return;
      }
    }

    const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
    if (existing) {
      await db
        .update(settingsTable)
        .set({ value })
        .where(eq(settingsTable.key, key));
    } else {
      await db.insert(settingsTable).values({ key, value });
    }
    keyResults.push({ key, status: "saved" });
  }

  const allSettings = await db.select().from(settingsTable);
  const safeSettings = allSettings.map((s) => serializeSetting({
    ...s,
    value: s.key.toLowerCase().includes("api_key") && s.value ? "***SET***" : s.value,
  }));
  res.json(SaveSettingsResponse.parse({ settings: safeSettings, results: keyResults }));
});

export default router;
