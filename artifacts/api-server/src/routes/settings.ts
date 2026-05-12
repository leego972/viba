import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GetSettingsResponse, SaveSettingsBody, SaveSettingsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// GET /settings
router.get("/settings", async (_req, res): Promise<void> => {
  const settings = await db.select().from(settingsTable);
  // Never return the actual value of sensitive keys (case-insensitive match)
  const safeSettings = settings.map((s) => ({
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

  const results = [];
  for (const { key, value } of parsed.data.settings) {
    // Don't update if value is the masked placeholder
    if (value === "***SET***") continue;

    const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
    if (existing) {
      const [updated] = await db
        .update(settingsTable)
        .set({ value })
        .where(eq(settingsTable.key, key))
        .returning();
      if (updated) results.push(updated);
    } else {
      const [inserted] = await db.insert(settingsTable).values({ key, value }).returning();
      if (inserted) results.push(inserted);
    }
  }

  const allSettings = await db.select().from(settingsTable);
  const safeSettings = allSettings.map((s) => ({
    ...s,
    value: s.key.toLowerCase().includes("api_key") && s.value ? "***SET***" : s.value,
  }));
  res.json(SaveSettingsResponse.parse(safeSettings));
});

export default router;
