/**
 * Railway Connector — four-layer fallback for applying Railway environment variables.
 *
 * Layer 1: Railway GraphQL public API (variableCollectionUpsert mutation)
 * Layer 2: Railway CLI (if `railway` binary is on PATH)
 * Layer 3: Railway MCP server (if configured)
 * Layer 4: Assisted Browser fallback (creates a browser_operator_job)
 *
 * Security invariants:
 * - Railway auth is read ONLY from server environment (RAILWAY_TOKEN).
 * - Never accept auth values from request bodies.
 * - Never return or log raw auth values.
 * - replace defaults false; skipDeploys defaults true.
 * - variableCollectionUpsert is the API write path.
 * - On API failure, return a fallback recommendation instead of crashing.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getRailwayMcpClient } from "./railwayMcp";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

// ── Allowed variable names ─────────────────────────────────────────────────────

export const ALLOWED_VARS = new Set([
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
]);

export type ConnectorMode = "api" | "cli" | "mcp" | "browser";

export interface ConnectorStatus {
  apiAvailable: boolean;
  cliAvailable: boolean;
  cliVersion: string | null;
  mcpAvailable: boolean;
  browserFallbackAvailable: boolean;
  modeOrder: ConnectorMode[];
  railwayTokenConfigured: boolean;
}

export interface FilterResult {
  acceptedKeys: string[];
  rejectedKeys: string[];
  valuesReturned: false;
  replace: false;
  skipDeploys: true;
}

export interface ApplyResult {
  ok: boolean;
  modeUsed: ConnectorMode | null;
  appliedKeys: string[];
  valuesReturned: false;
  fallbackNeeded: boolean;
  fallbackReason?: string;
  error?: string;
}

export interface FallbackPlan {
  modeOrder: ConnectorMode[];
  recommendation: string;
  browserSteps: string[];
  manualInstructions: string[];
}

// ── Railway token (server-only) ────────────────────────────────────────────────

function getToken(): string | null {
  return process.env["RAILWAY_TOKEN"]?.trim() || null;
}

function getRailwayProjectId(): string | null {
  return process.env["RAILWAY_PROJECT_ID"]?.trim() || null;
}

function getRailwayEnvironmentId(): string | null {
  return process.env["RAILWAY_ENVIRONMENT_ID"]?.trim() || null;
}

// ── Layer 1: Public API ────────────────────────────────────────────────────────

async function checkApiAvailable(): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  try {
    const res = await fetch("https://backboard.railway.app/graphql/v2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query: "{ projects(first: 1) { edges { node { id } } } }" }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function applyViaApi(
  vars: Record<string, string>,
  opts: { replace: boolean; skipDeploys: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const token = getToken();
  if (!token) return { ok: false, error: "RAILWAY_TOKEN not configured" };

  const projectId = getRailwayProjectId();
  const environmentId = getRailwayEnvironmentId();
  if (!projectId || !environmentId) {
    return { ok: false, error: "RAILWAY_PROJECT_ID or RAILWAY_ENVIRONMENT_ID not set" };
  }

  const variables = Object.entries(vars).map(([name, value]) => ({ name, value }));

  const mutation = `
    mutation VibaUpsertVars($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }
  `;

  try {
    const res = await fetch("https://backboard.railway.app/graphql/v2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: {
            projectId,
            environmentId,
            replace: opts.replace,
            skipDeploys: opts.skipDeploys,
            variables,
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data = (await res.json()) as { data?: { variableCollectionUpsert?: boolean }; errors?: unknown[] };
    if (!res.ok || data.errors?.length) {
      return { ok: false, error: `Railway API error: HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Railway API request failed" };
  }
}

// ── Layer 2: Railway CLI ───────────────────────────────────────────────────────

async function checkCliAvailable(): Promise<{ available: boolean; version: string | null }> {
  try {
    const { stdout } = await execFileAsync("railway", ["--version"], { timeout: 5000 });
    const version = stdout.trim().split("\n")[0]?.trim() ?? null;
    return { available: true, version };
  } catch {
    return { available: false, version: null };
  }
}

async function applyViaCli(vars: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  const token = getToken();
  if (!token) return { ok: false, error: "RAILWAY_TOKEN not configured" };

  try {
    for (const [name, value] of Object.entries(vars)) {
      await execFileAsync("railway", ["variables", "set", `${name}=${value}`], {
        timeout: 15000,
        env: { ...process.env, RAILWAY_TOKEN: token },
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Railway CLI failed" };
  }
}

// ── Layer 3: Railway MCP ───────────────────────────────────────────────────────

async function checkMcpAvailable(): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  try {
    const client = getRailwayMcpClient(token);
    if (!client) return false;
    const tools = await client.listTools();
    return tools.some((t) => t.name.toLowerCase().includes("variable") || t.name.toLowerCase().includes("env"));
  } catch {
    return false;
  }
}

async function applyViaMcp(vars: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  const token = getToken();
  if (!token) return { ok: false, error: "RAILWAY_TOKEN not configured" };
  const client = getRailwayMcpClient(token);
  if (!client) return { ok: false, error: "MCP client unavailable" };

  try {
    const projectId = getRailwayProjectId();
    const environmentId = getRailwayEnvironmentId();
    for (const [name, value] of Object.entries(vars)) {
      const result = await client.callTool("variable_upsert", {
        projectId,
        environmentId,
        name,
        value,
      });
      if (result.isError) {
        return { ok: false, error: `MCP variable_upsert failed for ${name}` };
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "MCP apply failed" };
  }
}

// ── Exported functions ─────────────────────────────────────────────────────────

export async function getRailwayConnectorStatus(): Promise<ConnectorStatus> {
  const token = getToken();
  const [apiAvailable, cliInfo, mcpAvailable] = await Promise.all([
    checkApiAvailable(),
    checkCliAvailable(),
    checkMcpAvailable(),
  ]);

  const modeOrder: ConnectorMode[] = [];
  if (apiAvailable) modeOrder.push("api");
  if (cliInfo.available) modeOrder.push("cli");
  if (mcpAvailable) modeOrder.push("mcp");
  modeOrder.push("browser");

  return {
    apiAvailable,
    cliAvailable: cliInfo.available,
    cliVersion: cliInfo.version,
    mcpAvailable,
    browserFallbackAvailable: true,
    modeOrder,
    railwayTokenConfigured: Boolean(token),
  };
}

export function filterRailwayVariables(input: Record<string, string>): FilterResult {
  const acceptedKeys: string[] = [];
  const rejectedKeys: string[] = [];
  for (const key of Object.keys(input)) {
    if (ALLOWED_VARS.has(key)) {
      acceptedKeys.push(key);
    } else {
      rejectedKeys.push(key);
    }
  }
  return { acceptedKeys, rejectedKeys, valuesReturned: false, replace: false, skipDeploys: true };
}

export function redactKeys(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(input)) {
    out[key] = "[REDACTED]";
  }
  return out;
}

export async function applyRailwayVariablesViaApi(
  vars: Record<string, string>,
  opts: { replace?: boolean; skipDeploys?: boolean } = {},
): Promise<ApplyResult> {
  const filtered = filterRailwayVariables(vars);
  const accepted: Record<string, string> = {};
  for (const k of filtered.acceptedKeys) {
    if (vars[k] !== undefined) accepted[k] = vars[k]!;
  }

  if (!filtered.acceptedKeys.length) {
    return {
      ok: false,
      modeUsed: null,
      appliedKeys: [],
      valuesReturned: false,
      fallbackNeeded: false,
      error: "No accepted variable keys after filtering",
    };
  }

  const replace = opts.replace ?? false;
  const skipDeploys = opts.skipDeploys ?? true;

  logger.info({ keys: filtered.acceptedKeys, replace, skipDeploys }, "Railway connector apply via API");

  const result = await applyViaApi(accepted, { replace, skipDeploys });
  if (result.ok) {
    return { ok: true, modeUsed: "api", appliedKeys: filtered.acceptedKeys, valuesReturned: false, fallbackNeeded: false };
  }

  logger.warn({ error: result.error }, "Railway API apply failed — trying CLI");
  const cliResult = await applyViaCli(accepted);
  if (cliResult.ok) {
    return { ok: true, modeUsed: "cli", appliedKeys: filtered.acceptedKeys, valuesReturned: false, fallbackNeeded: false };
  }

  logger.warn({ error: cliResult.error }, "Railway CLI apply failed — trying MCP");
  const mcpResult = await applyViaMcp(accepted);
  if (mcpResult.ok) {
    return { ok: true, modeUsed: "mcp", appliedKeys: filtered.acceptedKeys, valuesReturned: false, fallbackNeeded: false };
  }

  logger.warn("All Railway apply modes failed — browser fallback required");
  return {
    ok: false,
    modeUsed: null,
    appliedKeys: [],
    valuesReturned: false,
    fallbackNeeded: true,
    fallbackReason: `API: ${result.error}; CLI: ${cliResult.error}; MCP: ${mcpResult.error}`,
  };
}

export async function getRailwayFallbackPlan(keysToApply: string[]): Promise<FallbackPlan> {
  const status = await getRailwayConnectorStatus();
  return {
    modeOrder: status.modeOrder,
    recommendation:
      status.apiAvailable
        ? "Use Railway API (recommended — fastest)"
        : status.cliAvailable
          ? "Use Railway CLI (API unavailable)"
          : status.mcpAvailable
            ? "Use Railway MCP (CLI unavailable)"
            : "Use Assisted Browser (all automated paths unavailable)",
    browserSteps: [
      "1. Click 'Start Browser Job' below to create an Assisted Browser job",
      "2. Open railway.app in your browser and log in",
      "3. Navigate to your project → Settings → Variables",
      `4. Add or update: ${keysToApply.join(", ")}`,
      "5. Click 'Save' then return here and click 'Complete Job'",
    ],
    manualInstructions: keysToApply.map((k) => `railway variables set ${k}=<value>`),
  };
}
