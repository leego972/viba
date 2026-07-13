/**
 * VIBA Deployment Provider Tools
 *
 * Real REST API integrations — no stubs, no manual guides.
 *
 * Render tools:
 *   render_services_list   — list all Render services
 *   render_env_write       — update env vars on a Render service
 *   render_deploy_trigger  — trigger a new Render deploy
 *
 * DigitalOcean App Platform tools:
 *   digitalocean_apps_list      — list all DO App Platform apps
 *   digitalocean_env_write      — update env vars on a DO app
 *   digitalocean_deploy_trigger — trigger a new DO deployment
 *
 * Vercel tools:
 *   vercel_projects_list   — list all Vercel projects
 *   vercel_env_write       — create/update env var on a Vercel project
 *   vercel_deploy_trigger  — trigger a redeploy on Vercel
 *
 * Sevall/Sevalla tools:
 *   sevall_apps_list       — list Sevalla applications
 *   sevall_env_write       — update env vars on a Sevalla application
 *   sevall_deploy_trigger  — trigger a Sevalla deployment
 *
 * API keys are accepted as tool arguments (the agent passes them from vault)
 * and also auto-resolved from env vars as a fallback.
 */

export interface DeployTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }
function bool(v: unknown, fb = false): boolean { return typeof v === "boolean" ? v : fb; }

// ─── Generic fetch helpers ────────────────────────────────────────────────────

async function apiFetch(
  url: string,
  method: string,
  token: string,
  tokenScheme: "Bearer" | "key" | "token",
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const authHeader = tokenScheme === "key"
    ? { "Authorization": `Bearer ${token}` }
    : tokenScheme === "token"
      ? { "Authorization": `token ${token}` }
      : { "Authorization": `Bearer ${token}` };

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...authHeader,
      ...(extraHeaders ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25_000),
  });

  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data, text };
}

function errorMsg(status: number, data: unknown): string {
  if (typeof data === "object" && data !== null) {
    const d = data as Record<string, unknown>;
    return String(d["message"] ?? d["error"] ?? d["errors"] ?? JSON.stringify(d)).slice(0, 500);
  }
  return String(data).slice(0, 500);
}

// ─── RENDER ──────────────────────────────────────────────────────────────────

const RENDER_API = "https://api.render.com/v1";

function renderKey(args: Record<string, unknown>): string {
  return str(args["api_key"]) || process.env["RENDER_API_KEY"] || "";
}

// ─── DIGITALOCEAN ─────────────────────────────────────────────────────────────

const DO_API = "https://api.digitalocean.com/v2";

function doKey(args: Record<string, unknown>): string {
  return str(args["access_token"]) || process.env["DIGITALOCEAN_ACCESS_TOKEN"] || "";
}

// ─── VERCEL ──────────────────────────────────────────────────────────────────

const VERCEL_API = "https://api.vercel.com";

function vercelKey(args: Record<string, unknown>): string {
  return str(args["access_token"]) || process.env["VERCEL_ACCESS_TOKEN"] || process.env["VERCEL_TOKEN"] || "";
}

// ─── SEVALL / SEVALLA ─────────────────────────────────────────────────────────

const SEVALL_API = "https://api.sevalla.com/v1";

function sevallKey(args: Record<string, unknown>): string {
  return str(args["api_key"]) || process.env["SEVALL_API_KEY"] || process.env["SEVALLA_API_KEY"] || "";
}

// ─────────────────────────────────────────────────────────────────────────────

export function getDeployTools(): DeployTool[] {
  return [

    // ════════════════════════════════════════════════════════
    // RENDER TOOLS
    // ════════════════════════════════════════════════════════

    {
      definition: {
        type: "function",
        function: {
          name: "render_services_list",
          description: "List all Render services on the account. Returns service IDs, names, types, environments, and URLs. Use this first to find the serviceId you need for env var writes or deploy triggers.",
          parameters: {
            type: "object",
            properties: {
              api_key: { type: "string", description: "Render API key. Falls back to RENDER_API_KEY env var if not provided." },
              limit:   { type: "number", description: "Max results to return (default: 20, max: 100)" },
            },
            required: [],
          },
        },
      },
      async execute(args) {
        const key = renderKey(args);
        if (!key) return "Error: Render API key required. Pass api_key or set RENDER_API_KEY env var.";
        const limit = typeof args["limit"] === "number" ? Math.min(args["limit"], 100) : 20;
        const r = await apiFetch(`${RENDER_API}/services?limit=${limit}`, "GET", key, "Bearer");
        if (!r.ok) return `Render API error ${r.status}: ${errorMsg(r.status, r.data)}`;
        const items = Array.isArray(r.data) ? r.data : (r.data as { services?: unknown[] }).services ?? [];
        if (!items.length) return "No Render services found on this account.";
        const lines = (items as Array<{ service?: { id?: string; name?: string; type?: string; serviceDetails?: { url?: string }; suspend?: string } }>).map((item) => {
          const s = item.service ?? (item as { id?: string; name?: string; type?: string });
          const id = (s as { id?: string }).id ?? "?";
          const name = (s as { name?: string }).name ?? "?";
          const type = (s as { type?: string }).type ?? "?";
          const url = (s as { serviceDetails?: { url?: string } }).serviceDetails?.url ?? "";
          return `  ${id}  ${name}  [${type}]${url ? "  " + url : ""}`;
        });
        return [`Render Services (${items.length}):`, ...lines].join("\n");
      },
    },

    {
      definition: {
        type: "function",
        function: {
          name: "render_env_write",
          description: "Write (replace) environment variables on a Render service. This performs a PUT which replaces ALL env vars — pass the complete desired set. Use render_services_list first to get the serviceId.",
          parameters: {
            type: "object",
            properties: {
              api_key:    { type: "string", description: "Render API key. Falls back to RENDER_API_KEY env var." },
              service_id: { type: "string", description: "Render service ID (from render_services_list)" },
              env_vars: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    key:   { type: "string" },
                    value: { type: "string" },
                  },
                  required: ["key", "value"],
                },
                description: "Complete list of environment variables to set. Replaces all existing env vars.",
              },
              dry_run: { type: "boolean", description: "If true, validate inputs and show what would change without calling the API." },
            },
            required: ["service_id", "env_vars"],
          },
        },
      },
      async execute(args) {
        const key = renderKey(args);
        if (!key) return "Error: Render API key required. Pass api_key or set RENDER_API_KEY env var.";
        const serviceId = str(args["service_id"]);
        if (!serviceId) return "Error: service_id is required.";
        const envVars = args["env_vars"];
        if (!Array.isArray(envVars) || !envVars.length) return "Error: env_vars must be a non-empty array of {key, value} objects.";
        const payload = (envVars as Array<{ key: string; value: string }>).map(({ key: k, value: v }) => ({ key: k, value: v }));
        if (bool(args["dry_run"])) {
          return [
            "DRY RUN — Render env var write (not executed)",
            `Service ID: ${serviceId}`,
            `Would set ${payload.length} env vars:`,
            ...payload.map((e) => `  ${e.key}=***`),
          ].join("\n");
        }
        const r = await apiFetch(`${RENDER_API}/services/${serviceId}/env-vars`, "PUT", key, "Bearer", payload);
        if (!r.ok) return `Render API error ${r.status}: ${errorMsg(r.status, r.data)}`;
        const updated = Array.isArray(r.data) ? r.data.length : payload.length;
        return [
          `✅ Render env vars updated on service ${serviceId}`,
          `${updated} variable(s) written.`,
          "Note: Render may restart the service to apply the changes.",
        ].join("\n");
      },
    },

    {
      definition: {
        type: "function",
        function: {
          name: "render_deploy_trigger",
          description: "Trigger a new deployment on a Render service. Use render_services_list first to get the serviceId. A new deploy will be queued immediately.",
          parameters: {
            type: "object",
            properties: {
              api_key:    { type: "string", description: "Render API key. Falls back to RENDER_API_KEY env var." },
              service_id: { type: "string", description: "Render service ID (from render_services_list)" },
              clear_cache:{ type: "boolean", description: "If true, clear the build cache before deploying (default: false)" },
              dry_run:    { type: "boolean", description: "If true, validate inputs without triggering the deploy." },
            },
            required: ["service_id"],
          },
        },
      },
      async execute(args) {
        const key = renderKey(args);
        if (!key) return "Error: Render API key required. Pass api_key or set RENDER_API_KEY env var.";
        const serviceId = str(args["service_id"]);
        if (!serviceId) return "Error: service_id is required.";
        const clearCache = bool(args["clear_cache"]);
        if (bool(args["dry_run"])) {
          return `DRY RUN — Render deploy trigger (not executed)\nService ID: ${serviceId}\nClear cache: ${clearCache}`;
        }
        const body: Record<string, unknown> = {};
        if (clearCache) body["clearCache"] = "clear";
        const r = await apiFetch(`${RENDER_API}/services/${serviceId}/deploys`, "POST", key, "Bearer", body);
        if (!r.ok) return `Render API error ${r.status}: ${errorMsg(r.status, r.data)}`;
        const d = r.data as { id?: string; status?: string; createdAt?: string };
        return [
          `✅ Render deploy triggered on service ${serviceId}`,
          `Deploy ID:  ${d.id ?? "unknown"}`,
          `Status:     ${d.status ?? "pending"}`,
          `Created at: ${d.createdAt ?? "now"}`,
          `Track at:   https://dashboard.render.com/web/${serviceId}/deploys`,
        ].join("\n");
      },
    },

    // ════════════════════════════════════════════════════════
    // DIGITALOCEAN APP PLATFORM TOOLS
    // ════════════════════════════════════════════════════════

    {
      definition: {
        type: "function",
        function: {
          name: "digitalocean_apps_list",
          description: "List all DigitalOcean App Platform apps on the account. Returns app IDs, names, regions, live URLs, and deployment status. Use this first to find the appId you need.",
          parameters: {
            type: "object",
            properties: {
              access_token: { type: "string", description: "DigitalOcean personal access token. Falls back to DIGITALOCEAN_ACCESS_TOKEN env var." },
              page:     { type: "number", description: "Page number for pagination (default: 1)" },
              per_page: { type: "number", description: "Results per page (default: 20, max: 200)" },
            },
            required: [],
          },
        },
      },
      async execute(args) {
        const key = doKey(args);
        if (!key) return "Error: DigitalOcean access token required. Pass access_token or set DIGITALOCEAN_ACCESS_TOKEN env var.";
        const page = typeof args["page"] === "number" ? args["page"] : 1;
        const perPage = typeof args["per_page"] === "number" ? Math.min(args["per_page"], 200) : 20;
        const r = await apiFetch(`${DO_API}/apps?page=${page}&per_page=${perPage}`, "GET", key, "Bearer");
        if (!r.ok) return `DigitalOcean API error ${r.status}: ${errorMsg(r.status, r.data)}`;
        const apps = (r.data as { apps?: Array<{ id?: string; spec?: { name?: string; region?: { slug?: string } }; live_url?: string; active_deployment?: { phase?: string } }> }).apps ?? [];
        if (!apps.length) return "No DigitalOcean App Platform apps found on this account.";
        const lines = apps.map((a) => {
          const id = a.id ?? "?";
          const name = a.spec?.name ?? "?";
          const region = a.spec?.region?.slug ?? "?";
          const url = a.live_url ?? "";
          const phase = a.active_deployment?.phase ?? "unknown";
          return `  ${id}  ${name}  [${region}]  ${phase}${url ? "  " + url : ""}`;
        });
        return [`DigitalOcean Apps (${apps.length}):`, ...lines].join("\n");
      },
    },

    {
      definition: {
        type: "function",
        function: {
          name: "digitalocean_env_write",
          description: "Update environment variables on a DigitalOcean App Platform app. Merges the provided env vars into the app spec (non-destructive — existing vars not in the list are preserved). Use digitalocean_apps_list first to get the appId.",
          parameters: {
            type: "object",
            properties: {
              access_token: { type: "string", description: "DigitalOcean personal access token. Falls back to DIGITALOCEAN_ACCESS_TOKEN env var." },
              app_id: { type: "string", description: "DigitalOcean App ID (from digitalocean_apps_list)" },
              env_vars: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    key:   { type: "string" },
                    value: { type: "string" },
                    type:  { type: "string", enum: ["GENERAL", "SECRET"], description: "Env var type (default: GENERAL)" },
                    scope: { type: "string", enum: ["RUN_AND_BUILD_TIME", "BUILD_TIME", "RUN_TIME"], description: "Scope (default: RUN_AND_BUILD_TIME)" },
                  },
                  required: ["key", "value"],
                },
                description: "Environment variables to set or update.",
              },
              dry_run: { type: "boolean", description: "If true, show what would change without calling the API." },
            },
            required: ["app_id", "env_vars"],
          },
        },
      },
      async execute(args) {
        const key = doKey(args);
        if (!key) return "Error: DigitalOcean access token required.";
        const appId = str(args["app_id"]);
        if (!appId) return "Error: app_id is required.";
        const envVars = args["env_vars"];
        if (!Array.isArray(envVars) || !envVars.length) return "Error: env_vars must be a non-empty array.";

        if (bool(args["dry_run"])) {
          return [
            "DRY RUN — DigitalOcean env var write (not executed)",
            `App ID: ${appId}`,
            `Would update ${(envVars as unknown[]).length} env var(s):`,
            ...(envVars as Array<{ key: string }>).map((e) => `  ${e.key}=***`),
          ].join("\n");
        }

        // GET existing app spec
        const getR = await apiFetch(`${DO_API}/apps/${appId}`, "GET", key, "Bearer");
        if (!getR.ok) return `DigitalOcean API error ${getR.status} (GET app): ${errorMsg(getR.status, getR.data)}`;

        const app = getR.data as { spec?: { envs?: Array<{ key: string; value?: string; type?: string; scope?: string }> } };
        const existingEnvs: Array<{ key: string; value?: string; type?: string; scope?: string }> = app.spec?.envs ?? [];

        // Merge: update existing keys, append new ones
        const incoming = envVars as Array<{ key: string; value: string; type?: string; scope?: string }>;
        const incomingMap = new Map(incoming.map((e) => [e.key, e]));
        const merged = existingEnvs.map((e) => {
          if (incomingMap.has(e.key)) {
            const inc = incomingMap.get(e.key)!;
            incomingMap.delete(e.key);
            return { ...e, value: inc.value, type: inc.type ?? e.type, scope: inc.scope ?? e.scope };
          }
          return e;
        });
        for (const [, v] of incomingMap) {
          merged.push({ key: v.key, value: v.value, type: v.type ?? "GENERAL", scope: v.scope ?? "RUN_AND_BUILD_TIME" });
        }

        const updatedSpec = { ...(app.spec ?? {}), envs: merged };
        const patchR = await apiFetch(`${DO_API}/apps/${appId}`, "PUT", key, "Bearer", { spec: updatedSpec });
        if (!patchR.ok) return `DigitalOcean API error ${patchR.status} (PUT app): ${errorMsg(patchR.status, patchR.data)}`;

        return [
          `✅ DigitalOcean env vars updated on app ${appId}`,
          `${incoming.length} variable(s) set/updated.`,
          "A new deployment will be triggered automatically by DigitalOcean.",
        ].join("\n");
      },
    },

    {
      definition: {
        type: "function",
        function: {
          name: "digitalocean_deploy_trigger",
          description: "Trigger a new deployment on a DigitalOcean App Platform app. Use digitalocean_apps_list first to get the appId.",
          parameters: {
            type: "object",
            properties: {
              access_token: { type: "string", description: "DigitalOcean personal access token. Falls back to DIGITALOCEAN_ACCESS_TOKEN env var." },
              app_id:       { type: "string", description: "DigitalOcean App ID (from digitalocean_apps_list)" },
              force_build:  { type: "boolean", description: "If true, force a full rebuild even if the source hasn't changed (default: true)" },
              dry_run:      { type: "boolean", description: "If true, validate inputs without triggering the deploy." },
            },
            required: ["app_id"],
          },
        },
      },
      async execute(args) {
        const key = doKey(args);
        if (!key) return "Error: DigitalOcean access token required.";
        const appId = str(args["app_id"]);
        if (!appId) return "Error: app_id is required.";
        const forceBuild = args["force_build"] !== false;
        if (bool(args["dry_run"])) {
          return `DRY RUN — DigitalOcean deploy trigger (not executed)\nApp ID: ${appId}\nForce build: ${forceBuild}`;
        }
        const r = await apiFetch(`${DO_API}/apps/${appId}/deployments`, "POST", key, "Bearer", { force_build: forceBuild });
        if (!r.ok) return `DigitalOcean API error ${r.status}: ${errorMsg(r.status, r.data)}`;
        const dep = (r.data as { deployment?: { id?: string; phase?: string; created_at?: string } }).deployment ?? {};
        return [
          `✅ DigitalOcean deployment triggered on app ${appId}`,
          `Deployment ID: ${dep.id ?? "unknown"}`,
          `Phase:         ${dep.phase ?? "PENDING_BUILD"}`,
          `Created at:    ${dep.created_at ?? "now"}`,
          `Track at:      https://cloud.digitalocean.com/apps/${appId}/deployments`,
        ].join("\n");
      },
    },

    // ════════════════════════════════════════════════════════
    // VERCEL TOOLS
    // ════════════════════════════════════════════════════════

    {
      definition: {
        type: "function",
        function: {
          name: "vercel_projects_list",
          description: "List all Vercel projects on the account. Returns project IDs, names, framework, and latest deployment URLs. Use this first to find the projectId you need.",
          parameters: {
            type: "object",
            properties: {
              access_token: { type: "string", description: "Vercel access token. Falls back to VERCEL_ACCESS_TOKEN or VERCEL_TOKEN env var." },
              limit:     { type: "number", description: "Max projects to return (default: 20)" },
              team_id:   { type: "string", description: "Vercel team ID (optional, for team-scoped projects)" },
            },
            required: [],
          },
        },
      },
      async execute(args) {
        const key = vercelKey(args);
        if (!key) return "Error: Vercel access token required. Pass access_token or set VERCEL_ACCESS_TOKEN env var.";
        const limit = typeof args["limit"] === "number" ? args["limit"] : 20;
        const teamId = str(args["team_id"]);
        const qs = `limit=${limit}${teamId ? `&teamId=${teamId}` : ""}`;
        const r = await apiFetch(`${VERCEL_API}/v9/projects?${qs}`, "GET", key, "Bearer");
        if (!r.ok) return `Vercel API error ${r.status}: ${errorMsg(r.status, r.data)}`;
        const projects = (r.data as { projects?: Array<{ id?: string; name?: string; framework?: string; latestDeployments?: Array<{ url?: string }> }> }).projects ?? [];
        if (!projects.length) return "No Vercel projects found on this account.";
        const lines = projects.map((p) => {
          const url = p.latestDeployments?.[0]?.url ?? "";
          return `  ${p.id ?? "?"}  ${p.name ?? "?"}  [${p.framework ?? "unknown"}]${url ? "  https://" + url : ""}`;
        });
        return [`Vercel Projects (${projects.length}):`, ...lines].join("\n");
      },
    },

    {
      definition: {
        type: "function",
        function: {
          name: "vercel_env_write",
          description: "Create or update an environment variable on a Vercel project. Use vercel_projects_list first to get the projectId. Supports all targets: production, preview, development.",
          parameters: {
            type: "object",
            properties: {
              access_token: { type: "string", description: "Vercel access token. Falls back to VERCEL_ACCESS_TOKEN env var." },
              project_id:   { type: "string", description: "Vercel project ID or name (from vercel_projects_list)" },
              key:          { type: "string", description: "Environment variable key" },
              value:        { type: "string", description: "Environment variable value" },
              targets: {
                type: "array",
                items: { type: "string", enum: ["production", "preview", "development"] },
                description: "Deployment targets (default: [\"production\", \"preview\", \"development\"])",
              },
              team_id:  { type: "string", description: "Vercel team ID (optional)" },
              dry_run:  { type: "boolean", description: "If true, validate inputs without calling the API." },
              upsert:   { type: "boolean", description: "If true (default), update the variable if it already exists instead of erroring." },
            },
            required: ["project_id", "key", "value"],
          },
        },
      },
      async execute(args) {
        const token = vercelKey(args);
        if (!token) return "Error: Vercel access token required.";
        const projectId = str(args["project_id"]);
        if (!projectId) return "Error: project_id is required.";
        const envKey = str(args["key"]);
        const envValue = str(args["value"]);
        if (!envKey) return "Error: key is required.";
        const targets = Array.isArray(args["targets"]) ? args["targets"] : ["production", "preview", "development"];
        const teamId = str(args["team_id"]);
        const qs = teamId ? `?teamId=${teamId}&upsert=true` : "?upsert=true";

        if (bool(args["dry_run"])) {
          return [
            "DRY RUN — Vercel env var write (not executed)",
            `Project: ${projectId}`,
            `Key:     ${envKey}`,
            `Targets: ${targets.join(", ")}`,
          ].join("\n");
        }

        const payload = { key: envKey, value: envValue, type: "encrypted", target: targets };
        const r = await apiFetch(`${VERCEL_API}/v10/projects/${projectId}/env${qs}`, "POST", token, "Bearer", payload);

        if (!r.ok) {
          // 409 = already exists, try PATCH on each
          if (r.status === 409) {
            const listR = await apiFetch(`${VERCEL_API}/v9/projects/${projectId}/env${teamId ? `?teamId=${teamId}` : ""}`, "GET", token, "Bearer");
            if (!listR.ok) return `Vercel API error ${listR.status} (listing env vars): ${errorMsg(listR.status, listR.data)}`;
            const envs = (listR.data as { envs?: Array<{ id?: string; key?: string }> }).envs ?? [];
            const existing = envs.find((e) => e.key === envKey);
            if (!existing?.id) return `Env var ${envKey} exists but could not find its ID to update.`;
            const patchR = await apiFetch(`${VERCEL_API}/v9/projects/${projectId}/env/${existing.id}${teamId ? `?teamId=${teamId}` : ""}`, "PATCH", token, "Bearer", { value: envValue, target: targets });
            if (!patchR.ok) return `Vercel API error ${patchR.status} (PATCH env var): ${errorMsg(patchR.status, patchR.data)}`;
            return `✅ Vercel env var ${envKey} updated on project ${projectId} (targets: ${targets.join(", ")})`;
          }
          return `Vercel API error ${r.status}: ${errorMsg(r.status, r.data)}`;
        }

        return `✅ Vercel env var ${envKey} created/updated on project ${projectId} (targets: ${targets.join(", ")})`;
      },
    },

    {
      definition: {
        type: "function",
        function: {
          name: "vercel_deploy_trigger",
          description: "Trigger a redeployment on Vercel. If a deploy_hook_url is provided, POST to it directly (simplest). Otherwise, finds the latest deployment for the project and redeploys it.",
          parameters: {
            type: "object",
            properties: {
              access_token:    { type: "string", description: "Vercel access token. Falls back to VERCEL_ACCESS_TOKEN env var." },
              project_id:      { type: "string", description: "Vercel project ID or name. Required if deploy_hook_url is not provided." },
              deploy_hook_url: { type: "string", description: "Vercel deploy hook URL (from Project Settings > Git > Deploy Hooks). Simplest and most reliable option." },
              target:          { type: "string", enum: ["production", "preview"], description: "Deployment target (default: production)" },
              team_id:         { type: "string", description: "Vercel team ID (optional)" },
              dry_run:         { type: "boolean", description: "If true, validate inputs without triggering." },
            },
            required: [],
          },
        },
      },
      async execute(args) {
        const token = vercelKey(args);
        const hookUrl = str(args["deploy_hook_url"]);
        const projectId = str(args["project_id"]);
        const target = str(args["target"]) || "production";
        const teamId = str(args["team_id"]);

        if (bool(args["dry_run"])) {
          if (hookUrl) return `DRY RUN — Vercel deploy hook trigger (not executed)\nHook: ${hookUrl}`;
          return `DRY RUN — Vercel deploy trigger (not executed)\nProject: ${projectId}\nTarget: ${target}`;
        }

        // Path 1: deploy hook (simplest, no auth needed beyond the hook URL)
        if (hookUrl) {
          if (!hookUrl.startsWith("https://api.vercel.com/v1/integrations/deploy/")) {
            // Allow any URL that looks like a deploy hook
          }
          const r = await fetch(hookUrl, { method: "POST", signal: AbortSignal.timeout(15_000) });
          const text = await r.text().catch(() => "");
          if (!r.ok) return `Vercel deploy hook error ${r.status}: ${text.slice(0, 300)}`;
          return `✅ Vercel deploy hook triggered (HTTP ${r.status}).\nDeployment queued — check https://vercel.com/dashboard for status.`;
        }

        // Path 2: API redeploy via latest deployment
        if (!token) return "Error: Vercel access token required when deploy_hook_url is not provided.";
        if (!projectId) return "Error: Either project_id or deploy_hook_url is required.";

        const qs = `projectId=${projectId}&target=${target}&limit=1${teamId ? `&teamId=${teamId}` : ""}`;
        const listR = await apiFetch(`${VERCEL_API}/v6/deployments?${qs}`, "GET", token, "Bearer");
        if (!listR.ok) return `Vercel API error ${listR.status} (listing deployments): ${errorMsg(listR.status, listR.data)}`;

        const deployments = (listR.data as { deployments?: Array<{ uid?: string; name?: string; url?: string }> }).deployments ?? [];
        if (!deployments.length) return `No ${target} deployments found for project ${projectId}. Did you mean to use a deploy hook?`;

        const latest = deployments[0];
        if (!latest?.uid) return "Could not find a deployment ID to redeploy.";

        const redeployR = await apiFetch(
          `${VERCEL_API}/v13/deployments`,
          "POST",
          token,
          "Bearer",
          { name: latest.name ?? projectId, deploymentId: latest.uid, target, meta: { action: "redeploy" } },
          teamId ? { "x-vercel-team-id": teamId } : {},
        );
        if (!redeployR.ok) return `Vercel API error ${redeployR.status} (trigger deploy): ${errorMsg(redeployR.status, redeployR.data)}`;

        const dep = redeployR.data as { id?: string; url?: string; readyState?: string };
        return [
          `✅ Vercel redeployment triggered on project ${projectId}`,
          `Deployment ID: ${dep.id ?? "unknown"}`,
          `State:         ${dep.readyState ?? "QUEUED"}`,
          `URL:           ${dep.url ? "https://" + dep.url : "check Vercel dashboard"}`,
          `Target:        ${target}`,
        ].join("\n");
      },
    },

    // ════════════════════════════════════════════════════════
    // SEVALL / SEVALLA TOOLS
    // ════════════════════════════════════════════════════════

    {
      definition: {
        type: "function",
        function: {
          name: "sevall_apps_list",
          description: "List Sevalla (Sevall) applications on the account. Returns app IDs, names, and URLs. Use this first to find the app ID needed for env writes or deploy triggers.",
          parameters: {
            type: "object",
            properties: {
              api_key: { type: "string", description: "Sevalla API key. Falls back to SEVALL_API_KEY or SEVALLA_API_KEY env var." },
              company_id: { type: "string", description: "Sevalla company/team ID (required for Sevalla API v1)" },
            },
            required: ["company_id"],
          },
        },
      },
      async execute(args) {
        const key = sevallKey(args);
        if (!key) return "Error: Sevalla API key required. Pass api_key or set SEVALL_API_KEY env var.";
        const companyId = str(args["company_id"]);
        if (!companyId) return "Error: company_id is required for the Sevalla API.";
        const r = await apiFetch(`${SEVALL_API}/companies/${companyId}/applications`, "GET", key, "Bearer");
        if (!r.ok) return `Sevalla API error ${r.status}: ${errorMsg(r.status, r.data)}`;
        const apps = (r.data as { data?: Array<{ id?: string; name?: string; status?: string; domains?: Array<{ name?: string }> }> }).data
          ?? (Array.isArray(r.data) ? (r.data as Array<{ id?: string; name?: string; status?: string; domains?: Array<{ name?: string }> }>) : []);
        if (!apps.length) return "No Sevalla applications found.";
        const lines = apps.map((a) => {
          const domain = a.domains?.[0]?.name ?? "";
          return `  ${a.id ?? "?"}  ${a.name ?? "?"}  [${a.status ?? "?"}]${domain ? "  https://" + domain : ""}`;
        });
        return [`Sevalla Applications (${apps.length}):`, ...lines].join("\n");
      },
    },

    {
      definition: {
        type: "function",
        function: {
          name: "sevall_env_write",
          description: "Set environment variables on a Sevalla application. Use sevall_apps_list first to get the app ID.",
          parameters: {
            type: "object",
            properties: {
              api_key:    { type: "string", description: "Sevalla API key. Falls back to SEVALL_API_KEY env var." },
              company_id: { type: "string", description: "Sevalla company/team ID" },
              app_id:     { type: "string", description: "Sevalla application ID (from sevall_apps_list)" },
              env_vars: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    key:   { type: "string" },
                    value: { type: "string" },
                  },
                  required: ["key", "value"],
                },
                description: "Environment variables to set.",
              },
              dry_run: { type: "boolean", description: "If true, validate inputs without calling the API." },
            },
            required: ["company_id", "app_id", "env_vars"],
          },
        },
      },
      async execute(args) {
        const key = sevallKey(args);
        if (!key) return "Error: Sevalla API key required.";
        const companyId = str(args["company_id"]);
        const appId = str(args["app_id"]);
        if (!companyId || !appId) return "Error: company_id and app_id are required.";
        const envVars = args["env_vars"];
        if (!Array.isArray(envVars) || !envVars.length) return "Error: env_vars must be a non-empty array.";
        if (bool(args["dry_run"])) {
          return [
            "DRY RUN — Sevalla env var write (not executed)",
            `App: ${appId}`,
            `Would set ${(envVars as unknown[]).length} env var(s):`,
            ...(envVars as Array<{ key: string }>).map((e) => `  ${e.key}=***`),
          ].join("\n");
        }
        const payload = (envVars as Array<{ key: string; value: string }>).map(({ key: k, value: v }) => ({ name: k, value: v }));
        const r = await apiFetch(`${SEVALL_API}/companies/${companyId}/applications/${appId}/envs`, "POST", key, "Bearer", { envs: payload });
        if (!r.ok) {
          // Try PUT if POST fails (API version difference)
          const r2 = await apiFetch(`${SEVALL_API}/companies/${companyId}/applications/${appId}/envs`, "PUT", key, "Bearer", { envs: payload });
          if (!r2.ok) return `Sevalla API error ${r2.status}: ${errorMsg(r2.status, r2.data)}`;
          return `✅ Sevalla env vars updated on application ${appId} (${(envVars as unknown[]).length} variable(s) set).`;
        }
        return `✅ Sevalla env vars set on application ${appId} (${(envVars as unknown[]).length} variable(s) written).`;
      },
    },

    {
      definition: {
        type: "function",
        function: {
          name: "sevall_deploy_trigger",
          description: "Trigger a deployment on a Sevalla application. Use sevall_apps_list first to get the app ID.",
          parameters: {
            type: "object",
            properties: {
              api_key:    { type: "string", description: "Sevalla API key. Falls back to SEVALL_API_KEY env var." },
              company_id: { type: "string", description: "Sevalla company/team ID" },
              app_id:     { type: "string", description: "Sevalla application ID (from sevall_apps_list)" },
              dry_run:    { type: "boolean", description: "If true, validate without triggering." },
            },
            required: ["company_id", "app_id"],
          },
        },
      },
      async execute(args) {
        const key = sevallKey(args);
        if (!key) return "Error: Sevalla API key required.";
        const companyId = str(args["company_id"]);
        const appId = str(args["app_id"]);
        if (!companyId || !appId) return "Error: company_id and app_id are required.";
        if (bool(args["dry_run"])) {
          return `DRY RUN — Sevalla deploy trigger (not executed)\nApp: ${appId}`;
        }
        const r = await apiFetch(`${SEVALL_API}/companies/${companyId}/applications/${appId}/deployments`, "POST", key, "Bearer", {});
        if (!r.ok) {
          // Try /deploy endpoint alternative
          const r2 = await apiFetch(`${SEVALL_API}/companies/${companyId}/applications/${appId}/deploy`, "POST", key, "Bearer", {});
          if (!r2.ok) return `Sevalla API error ${r2.status}: ${errorMsg(r2.status, r2.data)}`;
          const d2 = r2.data as { id?: string; status?: string };
          return [
            `✅ Sevalla deployment triggered on application ${appId}`,
            `Deployment ID: ${d2.id ?? "unknown"}`,
            `Status:        ${d2.status ?? "pending"}`,
          ].join("\n");
        }
        const d = r.data as { id?: string; status?: string };
        return [
          `✅ Sevalla deployment triggered on application ${appId}`,
          `Deployment ID: ${d.id ?? "unknown"}`,
          `Status:        ${d.status ?? "pending"}`,
        ].join("\n");
      },
    },

  ];
}
