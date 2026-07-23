import { pool } from "@workspace/db";

export interface ProviderPreference {
  providerId: string;
  enabled: boolean | null;
  model: string | null;
  endpoint: string | null;
  updatedAt: Date;
}

let ensurePromise: Promise<void> | null = null;

export function ensureProviderPreferences(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS viba_provider_preferences (
        user_id INTEGER NOT NULL,
        provider_id TEXT NOT NULL,
        enabled BOOLEAN,
        model TEXT,
        endpoint TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, provider_id)
      )
    `).then(() => undefined).catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

function validUserId(userId: number | null | undefined): userId is number {
  return typeof userId === "number" && Number.isInteger(userId) && userId > 0;
}

function normalizeProviderId(providerId: string): string {
  return providerId.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 64);
}

function mapRow(row: {
  provider_id: string;
  enabled: boolean | null;
  model: string | null;
  endpoint: string | null;
  updated_at: Date;
}): ProviderPreference {
  return {
    providerId: row.provider_id,
    enabled: row.enabled,
    model: row.model,
    endpoint: row.endpoint,
    updatedAt: row.updated_at,
  };
}

export async function getProviderPreference(
  userId: number | null | undefined,
  providerId: string,
): Promise<ProviderPreference | null> {
  if (!validUserId(userId)) return null;
  const normalized = normalizeProviderId(providerId);
  if (!normalized) return null;
  await ensureProviderPreferences();
  const { rows } = await pool.query<{
    provider_id: string;
    enabled: boolean | null;
    model: string | null;
    endpoint: string | null;
    updated_at: Date;
  }>(
    `SELECT provider_id, enabled, model, endpoint, updated_at
       FROM viba_provider_preferences
      WHERE user_id = $1 AND provider_id = $2
      LIMIT 1`,
    [userId, normalized],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listProviderPreferences(
  userId: number | null | undefined,
): Promise<ProviderPreference[]> {
  if (!validUserId(userId)) return [];
  await ensureProviderPreferences();
  const { rows } = await pool.query<{
    provider_id: string;
    enabled: boolean | null;
    model: string | null;
    endpoint: string | null;
    updated_at: Date;
  }>(
    `SELECT provider_id, enabled, model, endpoint, updated_at
       FROM viba_provider_preferences
      WHERE user_id = $1
      ORDER BY provider_id ASC`,
    [userId],
  );
  return rows.map(mapRow);
}

export async function saveProviderPreference(input: {
  userId: number | null | undefined;
  providerId: string;
  enabled?: boolean;
  model?: string | null;
  endpoint?: string | null;
}): Promise<ProviderPreference> {
  if (!validUserId(input.userId)) {
    throw new Error("A verified user is required to save provider preferences.");
  }
  const providerId = normalizeProviderId(input.providerId);
  if (!providerId) throw new Error("Invalid provider ID.");

  const model = input.model === undefined
    ? undefined
    : input.model?.trim().slice(0, 160) || null;
  const endpoint = input.endpoint === undefined
    ? undefined
    : input.endpoint?.trim().slice(0, 500) || null;

  if (endpoint) {
    const parsed = new URL(endpoint);
    if (!(["https:", "http:"].includes(parsed.protocol))) {
      throw new Error("Provider endpoint must use HTTP or HTTPS.");
    }
  }

  await ensureProviderPreferences();
  const current = await getProviderPreference(input.userId, providerId);
  const enabled = input.enabled ?? current?.enabled ?? null;
  const nextModel = model === undefined ? current?.model ?? null : model;
  const nextEndpoint = endpoint === undefined ? current?.endpoint ?? null : endpoint;

  const { rows } = await pool.query<{
    provider_id: string;
    enabled: boolean | null;
    model: string | null;
    endpoint: string | null;
    updated_at: Date;
  }>(
    `INSERT INTO viba_provider_preferences
       (user_id, provider_id, enabled, model, endpoint, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id, provider_id)
     DO UPDATE SET enabled = EXCLUDED.enabled,
                   model = EXCLUDED.model,
                   endpoint = EXCLUDED.endpoint,
                   updated_at = NOW()
     RETURNING provider_id, enabled, model, endpoint, updated_at`,
    [input.userId, providerId, enabled, nextModel, nextEndpoint],
  );

  return mapRow(rows[0]!);
}
