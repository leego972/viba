/**
 * Vast.ai Connector — live REST API integration for renting GPU compute
 *
 * Capabilities:
 * - GET    /bundles/                          search available GPU offers (marketplace)
 * - PUT    /asks/{id}/                        rent an offer, creating a new instance
 * - GET    /instances/                        list this account's instances
 * - PUT    /instances/{id}/                   start/stop an instance
 * - DELETE /instances/{id}/                   destroy an instance (irreversible)
 * - PUT    /instances/command/{id}/           run a constrained remote command on an instance
 *
 * Security invariants:
 * - The API key belongs to whoever configured it in this VIBA instance's own
 *   Settings/Connections page — resolved from env or the settings table, exactly
 *   like every other provider credential. It is never hardcoded, never shared
 *   across installs, and never accepted from a request body.
 * - Destroying an instance is irreversible (deletes all data on it) — the route
 *   layer requires admin + explicit confirmation before calling this.
 */

import { logger } from "./logger";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const VAST_API_BASE = "https://console.vast.ai/api/v0";
const CONNECT_TIMEOUT_MS = 10_000;
const ACTION_TIMEOUT_MS = 30_000;

// ── Credentials ─────────────────────────────────────────────────────────────

async function getApiKey(): Promise<string | null> {
  const fromEnv = process.env["VAST_AI_API_KEY"]?.trim();
  if (fromEnv) return fromEnv;
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "VAST_AI_API_KEY"));
  if (row?.value) return row.value.trim() || null;
  const [legacyRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "vast_ai_api_key"));
  return legacyRow?.value?.trim() || null;
}

// ── Low-level fetch wrapper ────────────────────────────────────────────────

async function vastFetch(
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const key = await getApiKey();
  if (!key) return { ok: false, status: 401, data: { error: "VAST_AI_API_KEY not configured" } };

  const url = `${VAST_API_BASE}${path}`;
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? CONNECT_TIMEOUT_MS),
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  try {
    const res = await fetch(url, init);
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Vast.ai API request failed";
    return { ok: false, status: 0, data: { error: msg } };
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface VastConnectorStatus {
  apiAvailable: boolean;
  apiKeyConfigured: boolean;
  instanceCount: number | null;
  error?: string;
}

export interface VastOffer {
  id: number;
  gpuName: string;
  numGpus: number;
  dphTotal: number;
  cudaMaxGood: number | null;
  diskSpace: number;
  reliability: number | null;
  geolocation: string | null;
}

export interface VastOfferSearchResult {
  ok: boolean;
  offers: VastOffer[];
  error?: string;
}

export interface VastInstance {
  id: number;
  actualStatus: string | null;
  gpuName: string | null;
  numGpus: number | null;
  dphTotal: number | null;
  sshHost: string | null;
  sshPort: number | null;
  label: string | null;
  image: string | null;
}

export interface VastInstanceListResult {
  ok: boolean;
  instances: VastInstance[];
  error?: string;
}

export interface VastCreateResult {
  ok: boolean;
  contractId: number | null;
  error?: string;
}

export interface VastActionResult {
  ok: boolean;
  error?: string;
}

export interface VastCommandResult {
  ok: boolean;
  output: string | null;
  error?: string;
}

// ── Status / health check ────────────────────────────────────────────────────

export async function getVastConnectorStatus(): Promise<VastConnectorStatus> {
  const key = await getApiKey();
  if (!key) {
    return { apiAvailable: false, apiKeyConfigured: false, instanceCount: null, error: "VAST_AI_API_KEY not configured" };
  }
  const res = await vastFetch("/instances/");
  if (!res.ok) {
    return { apiAvailable: false, apiKeyConfigured: true, instanceCount: null, error: `API error: HTTP ${res.status}` };
  }
  const data = res.data as { instances?: unknown[] };
  return { apiAvailable: true, apiKeyConfigured: true, instanceCount: Array.isArray(data.instances) ? data.instances.length : 0 };
}

// ── Search offers ─────────────────────────────────────────────────────────────
// query is a Vast.ai search-offers filter object, e.g. { gpu_name: "RTX_4090", num_gpus: { gte: 1 }, rentable: { eq: true } }

export async function searchVastOffers(query: Record<string, unknown>, limit = 20): Promise<VastOfferSearchResult> {
  const q = encodeURIComponent(JSON.stringify(query));
  const res = await vastFetch(`/bundles/?q=${q}`, { timeoutMs: CONNECT_TIMEOUT_MS });
  if (!res.ok) return { ok: false, offers: [], error: `HTTP ${res.status}` };

  const data = res.data as { offers?: unknown[] };
  const items = Array.isArray(data.offers) ? data.offers.slice(0, limit) : [];
  const offers = items.map((item) => {
    const o = item as Record<string, unknown>;
    return {
      id: Number(o["id"] ?? 0),
      gpuName: String(o["gpu_name"] ?? ""),
      numGpus: Number(o["num_gpus"] ?? 0),
      dphTotal: Number(o["dph_total"] ?? 0),
      cudaMaxGood: typeof o["cuda_max_good"] === "number" ? o["cuda_max_good"] : null,
      diskSpace: Number(o["disk_space"] ?? 0),
      reliability: typeof o["reliability2"] === "number" ? o["reliability2"] : null,
      geolocation: typeof o["geolocation"] === "string" ? o["geolocation"] : null,
    };
  });
  return { ok: true, offers };
}

// ── Create instance (rent an offer) ────────────────────────────────────────────

export async function createVastInstance(opts: {
  offerId: number;
  image: string;
  disk?: number;
  onstart?: string;
  env?: Record<string, string>;
}): Promise<VastCreateResult> {
  const body: Record<string, unknown> = { image: opts.image };
  if (opts.disk !== undefined) body["disk"] = opts.disk;
  if (opts.onstart !== undefined) body["onstart"] = opts.onstart;
  if (opts.env !== undefined) body["env"] = opts.env;

  const res = await vastFetch(`/asks/${opts.offerId}/`, { method: "PUT", body, timeoutMs: ACTION_TIMEOUT_MS });
  if (!res.ok) return { ok: false, contractId: null, error: `HTTP ${res.status}` };

  const data = res.data as { success?: boolean; new_contract?: number };
  if (!data.success) return { ok: false, contractId: null, error: "Vast.ai rejected the offer (it may have been taken)" };

  logger.info({ offerId: opts.offerId, contractId: data.new_contract }, "Vast.ai instance created");
  return { ok: true, contractId: data.new_contract ?? null };
}

// ── List instances ─────────────────────────────────────────────────────────────

export async function listVastInstances(): Promise<VastInstanceListResult> {
  const res = await vastFetch("/instances/");
  if (!res.ok) return { ok: false, instances: [], error: `HTTP ${res.status}` };

  const data = res.data as { instances?: unknown[] };
  const items = Array.isArray(data.instances) ? data.instances : [];
  const instances = items.map((item) => {
    const i = item as Record<string, unknown>;
    return {
      id: Number(i["id"] ?? 0),
      actualStatus: typeof i["actual_status"] === "string" ? i["actual_status"] : null,
      gpuName: typeof i["gpu_name"] === "string" ? i["gpu_name"] : null,
      numGpus: typeof i["num_gpus"] === "number" ? i["num_gpus"] : null,
      dphTotal: typeof i["dph_total"] === "number" ? i["dph_total"] : null,
      sshHost: typeof i["ssh_host"] === "string" ? i["ssh_host"] : null,
      sshPort: typeof i["ssh_port"] === "number" ? i["ssh_port"] : null,
      label: typeof i["label"] === "string" ? i["label"] : null,
      image: typeof i["image"] === "string" ? i["image"] : null,
    };
  });
  return { ok: true, instances };
}

// ── Start / stop instance ───────────────────────────────────────────────────────

export async function setVastInstanceState(instanceId: number, state: "running" | "stopped"): Promise<VastActionResult> {
  const res = await vastFetch(`/instances/${instanceId}/`, { method: "PUT", body: { state }, timeoutMs: ACTION_TIMEOUT_MS });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const data = res.data as { success?: boolean };
  if (!data.success) return { ok: false, error: "Vast.ai rejected the state change" };
  logger.info({ instanceId, state }, "Vast.ai instance state changed");
  return { ok: true };
}

// ── Destroy instance (irreversible) ─────────────────────────────────────────────

export async function destroyVastInstance(instanceId: number): Promise<VastActionResult> {
  const res = await vastFetch(`/instances/${instanceId}/`, { method: "DELETE", timeoutMs: ACTION_TIMEOUT_MS });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  logger.info({ instanceId }, "Vast.ai instance destroyed");
  return { ok: true };
}

// ── Run a constrained command on an instance ────────────────────────────────────

export async function runVastCommand(instanceId: number, command: string): Promise<VastCommandResult> {
  const res = await vastFetch(`/instances/command/${instanceId}/`, {
    method: "PUT",
    body: { body: { command } },
    timeoutMs: ACTION_TIMEOUT_MS,
  });
  if (!res.ok) return { ok: false, output: null, error: `HTTP ${res.status}` };
  const data = res.data as { success?: boolean; result?: string; msg?: string };
  if (!data.success) return { ok: false, output: null, error: data.msg ?? "Command execution failed" };
  return { ok: true, output: data.result ?? data.msg ?? null };
}
