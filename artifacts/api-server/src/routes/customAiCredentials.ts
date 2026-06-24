import { Router, type IRouter } from "express";
import { listVibaCredentials, logVibaEvent, saveVibaCredential } from "../lib/vibaVault";

const router: IRouter = Router();

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function slug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

router.post("/custom-ai/save", async (req, res): Promise<void> => {
  const body = req.body as { name?: unknown; value?: unknown; endpoint?: unknown; model?: unknown; label?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const value = typeof body.value === "string" ? body.value.trim() : "";
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const aiSlug = slug(name);
  const label = typeof body.label === "string" && body.label.trim() ? slug(body.label) : aiSlug;

  if (!name || !aiSlug) { res.status(400).json({ error: "AI name is required" }); return; }
  if (!value) { res.status(400).json({ error: "Credential value is required" }); return; }

  await saveVibaCredential({ userId: userId(req), provider: "custom_ai", kind: "api_key", value, label });
  if (endpoint) await saveVibaCredential({ userId: userId(req), provider: "custom_ai", kind: "endpoint", value: endpoint, label });
  if (model) await saveVibaCredential({ userId: userId(req), provider: "custom_ai", kind: "model", value: model, label });

  await logVibaEvent({
    userId: userId(req),
    eventType: "custom_ai_saved",
    provider: "custom_ai",
    subject: label,
    status: "saved",
    message: `${name} saved as a custom BYOK AI provider.`,
    metadata: { name, label, hasEndpoint: Boolean(endpoint), hasModel: Boolean(model) },
  });

  res.json({
    ok: true,
    provider: "custom_ai",
    name,
    label,
    configured: true,
    rawValueReturned: false,
    message: `${name} was saved in the encrypted vault and can be used server-side for authorized tasks.`,
  });
});

router.get("/custom-ai/list", async (req, res): Promise<void> => {
  const saved = await listVibaCredentials(userId(req));
  const items = saved
    .filter((item) => item.provider === "custom_ai")
    .map((item) => ({
      provider: item.provider,
      kind: item.kind,
      label: item.label,
      status: item.status,
      last_validated_at: item.last_validated_at,
      updated_at: item.updated_at,
    }));
  res.json({ customAi: items, rawValuesReturned: false });
});

export default router;
