import { Router, type IRouter } from "express";
import { saveVibaCredential, listVibaCredentials, logVibaEvent } from "../lib/vibaVault";

const router: IRouter = Router();

function userId(req: { session?: { userId?: number } }): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "custom";
}

/**
 * POST /api/custom-ai/save
 *
 * Save any AI provider key to the vault.
 * Body: { name, value, endpoint?, model?, label? }
 *
 * - name: human-readable provider name (e.g. "Mistral", "Together AI")
 * - value: the API key (stored encrypted in vault, never returned)
 * - endpoint: optional base URL (stored encrypted if provided)
 * - model: optional default model (stored as non-secret if provided)
 * - label: optional vault label (defaults to "default")
 *
 * Groq is VIBA's built-in default. This endpoint lets users add any other AI.
 */
router.post("/custom-ai/save", async (req, res): Promise<void> => {
  const body = req.body as {
    name?: unknown;
    value?: unknown;
    endpoint?: unknown;
    model?: unknown;
    label?: unknown;
  };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const value = typeof body.value === "string" ? body.value.trim() : "";
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : null;
  const model = typeof body.model === "string" ? body.model.trim() : null;
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : slugify(name) || "default";

  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!value) {
    res.status(400).json({ error: "value (API key) is required" });
    return;
  }

  const provider = `custom_ai__${slugify(name)}`;
  const uid = userId(req);

  // Save the API key encrypted in the vault
  await saveVibaCredential({ userId: uid, provider, kind: "api_key", value, label });

  // Save optional endpoint encrypted in the vault (it may contain auth tokens)
  if (endpoint) {
    await saveVibaCredential({ userId: uid, provider, kind: "endpoint", value: endpoint, label });
  }

  // Save optional model as a non-sensitive vault entry (model names are not secret)
  if (model) {
    await saveVibaCredential({ userId: uid, provider, kind: "model", value: model, label });
  }

  await logVibaEvent({
    userId: uid,
    eventType: "custom_ai_key_saved",
    provider,
    status: "saved",
    message: `Custom AI provider '${name}' API key saved to vault.`,
    metadata: { name, label, hasEndpoint: Boolean(endpoint), hasModel: Boolean(model) },
  });

  res.json({
    ok: true,
    provider,
    name,
    label,
    hasEndpoint: Boolean(endpoint),
    hasModel: Boolean(model),
    message: "Custom AI key saved encrypted. The secret value is not returned.",
    byokNote: "Groq is included as VIBA's default model. Add your own AI accounts for specialist collaboration. Your provider bills stay with you.",
  });
});

/**
 * GET /api/custom-ai/list
 *
 * List all saved custom AI providers for this user.
 * Never returns raw key values.
 */
router.get("/custom-ai/list", async (req, res): Promise<void> => {
  const uid = userId(req);
  const all = await listVibaCredentials(uid);

  const customEntries = all
    .filter((c) => String(c["provider"] ?? "").startsWith("custom_ai__"))
    .filter((c) => c["kind"] === "api_key")
    .map((c) => ({
      provider: c["provider"],
      name: String(c["provider"]).replace(/^custom_ai__/, "").replace(/_/g, " "),
      label: c["label"],
      status: c["status"],
      scope: c["scope"],
      last_used_at: c["last_used_at"],
      last_validated_at: c["last_validated_at"],
      expires_at: c["expires_at"],
      updated_at: c["updated_at"],
    }));

  res.json({
    customAiProviders: customEntries,
    byokNote: "Groq is VIBA's default model. BYOK keys are stored encrypted and used server-side only.",
  });
});

export default router;
