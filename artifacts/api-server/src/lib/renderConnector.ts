/**
 * Render Connector — live REST API integration for Render.com
 *
 * Capabilities:
 * - GET  /v1/services                        list services
 * - GET  /v1/services/{id}                   service status + deploy state
 * - GET  /v1/services/{id}/deploys           recent deploy list
 * - POST /v1/services/{id}/deploys           trigger a new deploy
 * - GET  /v1/services/{id}/env-vars          read environment variables (keys only — values redacted)
 * - PUT  /v1/services/{id}/env-vars          merge-update env vars (GET → merge → PUT, never replace-all)
 * - GET  /v1/services/{id}/logs              service logs (last N lines)
 *
 * Security invariants:
 * - Auth is read ONLY from server env (RENDER_API_KEY). Never accepted from request bodies.
 * - Raw env var values are NEVER returned to callers — only key lists.
 * - Env var updates always GET-then-merge; never blindly replace-all.
 * - Service ID is read from RENDER_SERVICE_ID env var. Never accepted from request bodies.
 */

import { logger } from "./logger";

const RENDER_API_BASE = "https://api.render.com/v1";
const CONNECT_TIMEOUT_MS = 8000;
const ACTION_TIMEOUT_MS = 20000;

// ── Credentials (server-only) ──────────────────────────────────────────────────

function getApiKey(): string | null {
  return process.env["RENDER_API_KEY"]?.trim() || null;
}

function getServiceId(): string | null {
  return process.env["RENDER_SERVICE_ID"]?.trim() || null;
}

// ── Low-level fetch wrapper ────────────────────────────────────────────────────

async function renderFetch(
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const key = getApiKey();
  if (!key) return { ok: false, status: 401, data: { error: "RENDER_API_KEY not configured" } };

  const url = `${RENDER_API_BASE}${path}`;
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? CONNECT_TIMEOUT_MS),
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

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
    const msg = err instanceof Error ? err.message : "Render API request failed";
    return { ok: false, status: 0, data: { error: msg } };
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RenderConnectorStatus {
  apiAvailable: boolean;
  apiKeyConfigured: boolean;
  serviceIdConfigured: boolean;
  serviceId: string | null;
  serviceName: string | null;
  serviceStatus: string | null;
  serviceType: string | null;
  serviceUrl: string | null;
  lastDeployStatus: string | null;
  lastDeployCreatedAt: string | null;
  error?: string;
}

export interface RenderDeployResult {
  ok: boolean;
  deployId: string | null;
  status: string | null;
  error?: string;
}

export interface RenderEnvVarReadResult {
  ok: boolean;
  keys: string[];
  count: number;
  valuesReturned: false;
  error?: string;
}

export interface RenderEnvVarApplyResult {
  ok: boolean;
  appliedKeys: string[];
  skippedKeys: string[];
  totalEnvVarCount: number;
  valuesReturned: false;
  error?: string;
}

export interface RenderLogResult {
  ok: boolean;
  lines: string[];
  count: number;
  error?: string;
}

export interface RenderServiceListResult {
  ok: boolean;
  services: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    serviceUrl: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  error?: string;
}

// ── Allowed env var keys (allowlist for safety) ───────────────────────────────

export const RENDER_ALLOWED_VARS = new Set([
  "DATABASE_URL",
  "SESSION_SECRET",
  "PUBLIC_ORIGIN",
  "ACCESS_TOKEN",
  "CREDENTIAL_ENCRYPTION_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID",
  "STRIPE_BILLING_SUBSCRIPTION_PRICE_ID",
  "STRIPE_BILLING_PRO_SUBSCRIPTION_PRICE_ID",
  "STRIPE_BILLING_CREDITS_1000_PRICE_ID",
  "STRIPE_BILLING_CREDITS_2000_PRICE_ID",
  "STRIPE_BILLING_CREDITS_3000_PRICE_ID",
  "STRIPE_BILLING_CREDITS_4000_PRICE_ID",
  "STRIPE_BILLING_CREDITS_5000_PRICE_ID",
  "STRIPE_BILLING_CREDITS_6000_PRICE_ID",
  "STRIPE_BILLING_LAUNCH_SETUP_PRICE_ID",
  "CORS_ALLOWED_ORIGINS",
  "NODE_ENV",
  "PORT",
]);

// ── Status / health check ──────────────────────────────────────────────────────

export async function getRenderConnectorStatus(): Promise<RenderConnectorStatus> {
  const key = getApiKey();
  const serviceId = getServiceId();

  if (!key) {
    return {
      apiAvailable: false,
      apiKeyConfigured: false,
      serviceIdConfigured: false,
      serviceId: null,
      serviceName: null,
      serviceStatus: null,
      serviceType: null,
      serviceUrl: null,
      lastDeployStatus: null,
      lastDeployCreatedAt: null,
      error: "RENDER_API_KEY not configured",
    };
  }

  if (!serviceId) {
    // Still check if the API key is valid by listing services
    const listRes = await renderFetch("/services?limit=1");
    return {
      apiAvailable: listRes.ok,
      apiKeyConfigured: true,
      serviceIdConfigured: false,
      serviceId: null,
      serviceName: null,
      serviceStatus: null,
      serviceType: null,
      serviceUrl: null,
      lastDeployStatus: null,
      lastDeployCreatedAt: null,
      error: listRes.ok ? "RENDER_SERVICE_ID not set — set it to enable full integration" : `API error: HTTP ${listRes.status}`,
    };
  }

  // Fetch service details and latest deploy in parallel
  const [svcRes, deploysRes] = await Promise.all([
    renderFetch(`/services/${serviceId}`),
    renderFetch(`/services/${serviceId}/deploys?limit=1`),
  ]);

  if (!svcRes.ok) {
    return {
      apiAvailable: false,
      apiKeyConfigured: true,
      serviceIdConfigured: true,
      serviceId,
      serviceName: null,
      serviceStatus: null,
      serviceType: null,
      serviceUrl: null,
      lastDeployStatus: null,
      lastDeployCreatedAt: null,
      error: `Service fetch failed: HTTP ${svcRes.status}`,
    };
  }

  const svc = svcRes.data as Record<string, unknown>;
  const deploys = (deploysRes.data as unknown[]) ?? [];
  const latestDeploy = Array.isArray(deploys) && deploys.length > 0
    ? (deploys[0] as Record<string, unknown>)
    : null;

  const deployObj = latestDeploy?.["deploy"] as Record<string, unknown> | undefined ?? latestDeploy;

  return {
    apiAvailable: true,
    apiKeyConfigured: true,
    serviceIdConfigured: true,
    serviceId,
    serviceName: typeof svc["name"] === "string" ? svc["name"] : null,
    serviceStatus: typeof svc["suspended"] === "string" ? svc["suspended"] : (typeof svc["state"] === "string" ? svc["state"] : null),
    serviceType: typeof svc["type"] === "string" ? svc["type"] : null,
    serviceUrl: typeof svc["serviceDetails"] === "object" && svc["serviceDetails"] !== null
      ? (((svc["serviceDetails"] as Record<string, unknown>)["url"] as string) ?? null)
      : null,
    lastDeployStatus: deployObj && typeof deployObj["status"] === "string" ? deployObj["status"] : null,
    lastDeployCreatedAt: deployObj && typeof deployObj["createdAt"] === "string" ? deployObj["createdAt"] : null,
  };
}

// ── List services ──────────────────────────────────────────────────────────────

export async function listRenderServices(): Promise<RenderServiceListResult> {
  const res = await renderFetch("/services?limit=20", { timeoutMs: CONNECT_TIMEOUT_MS });
  if (!res.ok) {
    return { ok: false, services: [], error: `HTTP ${res.status}` };
  }

  const items = Array.isArray(res.data) ? res.data : [];
  const services = items.map((item) => {
    const s = (item as Record<string, unknown>)["service"] as Record<string, unknown> | undefined
      ?? item as Record<string, unknown>;
    const details = (s["serviceDetails"] as Record<string, unknown>) ?? {};
    return {
      id: String(s["id"] ?? ""),
      name: String(s["name"] ?? ""),
      type: String(s["type"] ?? ""),
      status: String(s["suspended"] ?? s["state"] ?? ""),
      serviceUrl: typeof details["url"] === "string" ? details["url"] : null,
      createdAt: String(s["createdAt"] ?? ""),
      updatedAt: String(s["updatedAt"] ?? ""),
    };
  });

  return { ok: true, services };
}

// ── Trigger a deploy ───────────────────────────────────────────────────────────

export async function triggerRenderDeploy(opts: { clearCache?: boolean } = {}): Promise<RenderDeployResult> {
  const serviceId = getServiceId();
  if (!serviceId) {
    return { ok: false, deployId: null, status: null, error: "RENDER_SERVICE_ID not configured" };
  }

  const body = { clearCache: opts.clearCache ? "clear" : "do_not_clear" };
  const res = await renderFetch(`/services/${serviceId}/deploys`, {
    method: "POST",
    body,
    timeoutMs: ACTION_TIMEOUT_MS,
  });

  if (!res.ok) {
    return { ok: false, deployId: null, status: null, error: `Deploy trigger failed: HTTP ${res.status}` };
  }

  const data = res.data as Record<string, unknown>;
  const deployId = typeof data["id"] === "string" ? data["id"] : null;
  const status = typeof data["status"] === "string" ? data["status"] : null;

  logger.info({ serviceId, deployId, status }, "Render deploy triggered");
  return { ok: true, deployId, status };
}

// ── Get recent deploys ─────────────────────────────────────────────────────────

export async function getRenderDeploys(limit = 5): Promise<{
  ok: boolean;
  deploys: Array<{ id: string; status: string; createdAt: string; finishedAt: string | null; commitMessage: string | null }>;
  error?: string;
}> {
  const serviceId = getServiceId();
  if (!serviceId) {
    return { ok: false, deploys: [], error: "RENDER_SERVICE_ID not configured" };
  }

  const res = await renderFetch(`/services/${serviceId}/deploys?limit=${limit}`);
  if (!res.ok) {
    return { ok: false, deploys: [], error: `HTTP ${res.status}` };
  }

  const items = Array.isArray(res.data) ? res.data : [];
  const deploys = items.map((item) => {
    const d = (item as Record<string, unknown>)["deploy"] as Record<string, unknown> | undefined
      ?? item as Record<string, unknown>;
    return {
      id: String(d["id"] ?? ""),
      status: String(d["status"] ?? ""),
      createdAt: String(d["createdAt"] ?? ""),
      finishedAt: typeof d["finishedAt"] === "string" ? d["finishedAt"] : null,
      commitMessage: typeof d["commit"] === "object" && d["commit"] !== null
        ? (((d["commit"] as Record<string, unknown>)["message"] as string) ?? null)
        : null,
    };
  });

  return { ok: true, deploys };
}

// ── Read env var keys (values never returned) ─────────────────────────────────

export async function getRenderEnvVarKeys(): Promise<RenderEnvVarReadResult> {
  const serviceId = getServiceId();
  if (!serviceId) {
    return { ok: false, keys: [], count: 0, valuesReturned: false, error: "RENDER_SERVICE_ID not configured" };
  }

  const res = await renderFetch(`/services/${serviceId}/env-vars`);
  if (!res.ok) {
    return { ok: false, keys: [], count: 0, valuesReturned: false, error: `HTTP ${res.status}` };
  }

  const items = Array.isArray(res.data) ? res.data : [];
  const keys = items
    .map((item) => {
      const ev = (item as Record<string, unknown>)["envVar"] as Record<string, unknown> | undefined
        ?? item as Record<string, unknown>;
      return typeof ev["key"] === "string" ? ev["key"] : null;
    })
    .filter((k): k is string => k !== null);

  return { ok: true, keys, count: keys.length, valuesReturned: false };
}

// ── Merge-update env vars ──────────────────────────────────────────────────────
// Always GET first, then merge, then PUT. Never blindly replace-all.

export async function applyRenderEnvVars(
  incoming: Record<string, string>,
): Promise<RenderEnvVarApplyResult> {
  const serviceId = getServiceId();
  if (!serviceId) {
    return {
      ok: false,
      appliedKeys: [],
      skippedKeys: Object.keys(incoming),
      totalEnvVarCount: 0,
      valuesReturned: false,
      error: "RENDER_SERVICE_ID not configured",
    };
  }

  // Filter to allowlist
  const accepted: Record<string, string> = {};
  const skipped: string[] = [];
  for (const [k, v] of Object.entries(incoming)) {
    if (k === "RENDER_API_KEY" || k === "RENDER_SERVICE_ID") {
      skipped.push(k);
      continue;
    }
    if (RENDER_ALLOWED_VARS.has(k)) {
      accepted[k] = v;
    } else {
      skipped.push(k);
    }
  }

  if (Object.keys(accepted).length === 0) {
    return {
      ok: false,
      appliedKeys: [],
      skippedKeys: skipped,
      totalEnvVarCount: 0,
      valuesReturned: false,
      error: "No accepted variable keys after allowlist filtering",
    };
  }

  // GET existing env vars (we need their current values to merge)
  const getRes = await renderFetch(`/services/${serviceId}/env-vars`, { timeoutMs: ACTION_TIMEOUT_MS });
  if (!getRes.ok) {
    return {
      ok: false,
      appliedKeys: [],
      skippedKeys: skipped,
      totalEnvVarCount: 0,
      valuesReturned: false,
      error: `Could not read existing env vars: HTTP ${getRes.status}`,
    };
  }

  // Build merged map: existing vars first, then overlay accepted incoming
  const existing = Array.isArray(getRes.data) ? getRes.data : [];
  const merged: Record<string, string> = {};

  for (const item of existing) {
    const ev = (item as Record<string, unknown>)["envVar"] as Record<string, unknown> | undefined
      ?? item as Record<string, unknown>;
    const k = typeof ev["key"] === "string" ? ev["key"] : null;
    const v = typeof ev["value"] === "string" ? ev["value"] : "";
    if (k) merged[k] = v;
  }

  for (const [k, v] of Object.entries(accepted)) {
    merged[k] = v;
  }

  // PUT the full merged set
  const body = Object.entries(merged).map(([key, value]) => ({ key, value }));
  const putRes = await renderFetch(`/services/${serviceId}/env-vars`, {
    method: "PUT",
    body,
    timeoutMs: ACTION_TIMEOUT_MS,
  });

  if (!putRes.ok) {
    return {
      ok: false,
      appliedKeys: [],
      skippedKeys: skipped,
      totalEnvVarCount: 0,
      valuesReturned: false,
      error: `Env var PUT failed: HTTP ${putRes.status}`,
    };
  }

  logger.info({ serviceId, appliedKeys: Object.keys(accepted) }, "Render env vars applied");

  return {
    ok: true,
    appliedKeys: Object.keys(accepted),
    skippedKeys: skipped,
    totalEnvVarCount: body.length,
    valuesReturned: false,
  };
}

// ── Service logs ───────────────────────────────────────────────────────────────

export async function getRenderLogs(limit = 100): Promise<RenderLogResult> {
  const serviceId = getServiceId();
  if (!serviceId) {
    return { ok: false, lines: [], count: 0, error: "RENDER_SERVICE_ID not configured" };
  }

  const res = await renderFetch(`/services/${serviceId}/logs?limit=${limit}`, {
    timeoutMs: ACTION_TIMEOUT_MS,
  });

  if (!res.ok) {
    return { ok: false, lines: [], count: 0, error: `HTTP ${res.status}` };
  }

  const items = Array.isArray(res.data) ? res.data : [];
  const lines = items
    .map((item) => {
      const entry = item as Record<string, unknown>;
      const ts = typeof entry["timestamp"] === "string" ? entry["timestamp"] : "";
      const msg = typeof entry["message"] === "string" ? entry["message"] : JSON.stringify(entry);
      return ts ? `[${ts}] ${msg}` : msg;
    });

  return { ok: true, lines, count: lines.length };
}

// ── Dry-run helper ────────────────────────────────────────────────────────────

export function filterRenderVariables(input: Record<string, string>): {
  acceptedKeys: string[];
  rejectedKeys: string[];
  valuesReturned: false;
} {
  const acceptedKeys: string[] = [];
  const rejectedKeys: string[] = [];
  for (const key of Object.keys(input)) {
    if (key !== "RENDER_API_KEY" && key !== "RENDER_SERVICE_ID" && RENDER_ALLOWED_VARS.has(key)) {
      acceptedKeys.push(key);
    } else {
      rejectedKeys.push(key);
    }
  }
  return { acceptedKeys, rejectedKeys, valuesReturned: false };
}
