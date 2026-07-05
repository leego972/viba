import { logger } from "../../lib/logger";
import { maskSecrets } from "./secrets.service";

const RENDER_API_KEY = process.env.RENDER_API_KEY ?? "";
const RENDER_API = "https://api.render.com/v1";
const RENDER_OWNER_ID = process.env.RENDER_OWNER_ID ?? "";

export interface RenderServiceInfo {
  id: string;
  name: string;
  type: string;
  dashboardUrl: string;
  serviceUrl: string | null;
  status: string;
}

export interface RenderDeployResult {
  deployId: string;
  status: string;
  serviceId: string;
}

export function isRenderConfigured(): boolean {
  return !!RENDER_API_KEY;
}

async function renderFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${RENDER_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${RENDER_API_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Render API ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

export async function getOwnerId(): Promise<string> {
  if (RENDER_OWNER_ID) return RENDER_OWNER_ID;
  const data = await renderFetch<{ owner: { id: string } }>("/services?limit=1");
  const services = data as unknown as Array<{ service: { ownerId: string } }>;
  if (services.length > 0) return services[0].service.ownerId;
  throw new Error("Could not determine Render owner ID. Set RENDER_OWNER_ID env var.");
}

export async function createWebService(opts: {
  name: string;
  repoUrl: string;
  branch: string;
  buildCommand: string;
  startCommand: string;
  envVars: Record<string, string>;
  plan?: string;
  region?: string;
}): Promise<RenderServiceInfo> {
  const ownerId = await getOwnerId();
  const payload = {
    type: "web_service",
    name: opts.name,
    ownerId,
    repo: opts.repoUrl,
    branch: opts.branch,
    buildCommand: opts.buildCommand,
    startCommand: opts.startCommand,
    plan: opts.plan ?? "starter",
    region: opts.region ?? "oregon",
    envVars: Object.entries(opts.envVars).map(([key, value]) => ({ key, value })),
    autoDeploy: "no",
    rootDir: null,
    healthCheckPath: "/",
  };

  const data = await renderFetch<{ service: {
    id: string; name: string; type: string; dashboardUrl: string;
    serviceDetails: { url: string | null }; suspended: string;
  } }>("/services", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return {
    id: data.service.id,
    name: data.service.name,
    type: data.service.type,
    dashboardUrl: data.service.dashboardUrl,
    serviceUrl: data.service.serviceDetails?.url ?? null,
    status: data.service.suspended === "not_suspended" ? "live" : "inactive",
  };
}

export async function createStaticSite(opts: {
  name: string;
  repoUrl: string;
  branch: string;
  buildCommand: string;
  publishPath: string;
  envVars: Record<string, string>;
}): Promise<RenderServiceInfo> {
  const ownerId = await getOwnerId();
  const payload = {
    type: "static_site",
    name: opts.name,
    ownerId,
    repo: opts.repoUrl,
    branch: opts.branch,
    buildCommand: opts.buildCommand,
    staticPublishPath: opts.publishPath,
    plan: "starter",
    envVars: Object.entries(opts.envVars).map(([key, value]) => ({ key, value })),
    autoDeploy: "no",
  };

  const data = await renderFetch<{ service: {
    id: string; name: string; type: string; dashboardUrl: string;
    serviceDetails: { url: string | null }; suspended: string;
  } }>("/services", { method: "POST", body: JSON.stringify(payload) });

  return {
    id: data.service.id,
    name: data.service.name,
    type: data.service.type,
    dashboardUrl: data.service.dashboardUrl,
    serviceUrl: data.service.serviceDetails?.url ?? null,
    status: "live",
  };
}

export async function triggerDeploy(serviceId: string, clearCache = false): Promise<RenderDeployResult> {
  const data = await renderFetch<{ id: string; status: string }>(`/services/${serviceId}/deploys`, {
    method: "POST",
    body: JSON.stringify({ clearCache }),
  });
  return { deployId: data.id, status: data.status, serviceId };
}

export async function getDeployStatus(
  serviceId: string,
  deployId: string,
): Promise<{ status: string; createdAt: string; finishedAt: string | null }> {
  const data = await renderFetch<{
    id: string; status: string; createdAt: string; finishedAt: string | null;
  }>(`/services/${serviceId}/deploys/${deployId}`);
  return { status: data.status, createdAt: data.createdAt, finishedAt: data.finishedAt };
}

export async function getDeployLogs(
  serviceId: string,
  deployId: string,
): Promise<string[]> {
  try {
    const data = await renderFetch<Array<{ message: string; timestamp: string }>>(
      `/services/${serviceId}/deploys/${deployId}/logs`,
    );
    return data.map((l) => maskSecrets(`[${l.timestamp}] ${l.message}`));
  } catch {
    return ["[INFO] Log retrieval requires Render paid plan"];
  }
}

export async function updateEnvVars(
  serviceId: string,
  envVars: Record<string, string>,
): Promise<void> {
  const existing = await renderFetch<Array<{ envVar: { key: string; value: string } }>>(
    `/services/${serviceId}/env-vars`,
  );
  const merged = Object.fromEntries(
    existing.map((e) => [e.envVar.key, e.envVar.value]),
  );
  Object.assign(merged, envVars);
  await renderFetch(`/services/${serviceId}/env-vars`, {
    method: "PUT",
    body: JSON.stringify(
      Object.entries(merged).map(([key, value]) => ({ key, value })),
    ),
  });
  logger.info({ serviceId, count: Object.keys(envVars).length }, "Render env vars updated");
}

export async function getServiceInfo(serviceId: string): Promise<RenderServiceInfo> {
  const data = await renderFetch<{ service: {
    id: string; name: string; type: string; dashboardUrl: string;
    serviceDetails: { url: string | null }; suspended: string;
  } }>(`/services/${serviceId}`);
  return {
    id: data.service.id,
    name: data.service.name,
    type: data.service.type,
    dashboardUrl: data.service.dashboardUrl,
    serviceUrl: data.service.serviceDetails?.url ?? null,
    status: data.service.suspended === "not_suspended" ? "live" : "inactive",
  };
}

export async function deleteService(serviceId: string): Promise<void> {
  await renderFetch(`/services/${serviceId}`, { method: "DELETE" });
  logger.info({ serviceId }, "Render service deleted");
}

export async function suspendService(serviceId: string): Promise<void> {
  await renderFetch(`/services/${serviceId}/suspend`, { method: "POST" });
}

export async function resumeService(serviceId: string): Promise<void> {
  await renderFetch(`/services/${serviceId}/resume`, { method: "POST" });
}

export async function createPostgresDatabase(opts: {
  name: string;
  plan?: string;
  region?: string;
}): Promise<{ id: string; connectionString: string; dashboardUrl: string }> {
  const ownerId = await getOwnerId();
  const data = await renderFetch<{
    id: string;
    connectionInfo: { externalConnectionString: string };
    dashboardUrl: string;
  }>("/postgres", {
    method: "POST",
    body: JSON.stringify({
      name: opts.name,
      ownerId,
      plan: opts.plan ?? "starter",
      region: opts.region ?? "oregon",
    }),
  });
  return {
    id: data.id,
    connectionString: data.connectionInfo.externalConnectionString,
    dashboardUrl: data.dashboardUrl,
  };
}

export async function createRedisInstance(opts: {
  name: string;
  plan?: string;
  region?: string;
}): Promise<{ id: string; redisUrl: string; dashboardUrl: string }> {
  const ownerId = await getOwnerId();
  const data = await renderFetch<{
    id: string;
    connectionInfo: { redisUrl: string };
    dashboardUrl: string;
  }>("/redis", {
    method: "POST",
    body: JSON.stringify({
      name: opts.name,
      ownerId,
      plan: opts.plan ?? "starter",
      region: opts.region ?? "oregon",
    }),
  });
  return {
    id: data.id,
    redisUrl: data.connectionInfo.redisUrl,
    dashboardUrl: data.dashboardUrl,
  };
}

export async function addCustomDomain(serviceId: string, domain: string): Promise<void> {
  await renderFetch(`/services/${serviceId}/custom-domains`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
  logger.info({ serviceId, domain }, "Custom domain added to Render service");
}

export async function pollDeployUntilDone(
  serviceId: string,
  deployId: string,
  onLog: (msg: string) => void,
  timeoutMs = 600_000,
): Promise<"live" | "build_failed" | "deactivated" | "canceled" | "unknown"> {
  const deadline = Date.now() + timeoutMs;
  const TERMINAL = new Set(["live", "build_failed", "deactivated", "canceled", "update_failed"]);

  while (Date.now() < deadline) {
    const status = await getDeployStatus(serviceId, deployId);
    onLog(`[deploy] Status: ${status.status}`);

    if (TERMINAL.has(status.status)) {
      return (status.status === "live" ? "live" : status.status) as
        "live" | "build_failed" | "deactivated" | "canceled" | "unknown";
    }

    await new Promise((r) => setTimeout(r, 10_000));
  }

  return "unknown";
}
