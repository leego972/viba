/**
 * VIBA Deployment Provider Registry
 *
 * Source of truth for all supported deployment providers.
 * Rules:
 * - Railway is "implemented" — existing Railway connector exists
 * - All others are "adapter_placeholder" or "manual_guided"
 * - No provider claims execution support unless adapter is real
 * - No fake API calls ever
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProviderId =
  | "railway"
  | "render"
  | "digitalocean"
  | "vercel"
  | "sevall"
  | "vastai"
  | "custom";

export type DocsStatus = "implemented" | "manual_guided" | "adapter_placeholder";

export type CredentialKind =
  | "api_key"
  | "access_token"
  | "deploy_token"
  | "oauth_token"
  | "service_token"
  | "endpoint"
  | "project_id"
  | "team_id"
  | "app_id"
  | "site_id"
  | "custom_secret";

export interface DeploymentProvider {
  providerId: ProviderId;
  label: string;
  description: string;
  credentialProvider: string | null;
  requiredCredentialKinds: CredentialKind[];
  supportsEnvRead: boolean;
  supportsEnvWrite: boolean;
  supportsDeployStatus: boolean;
  supportsDeployTrigger: boolean;
  supportsDomainCheck: boolean;
  supportsLogs: boolean;
  supportsBuildLogs: boolean;
  supportsDryRun: boolean;
  requiresApprovalForEnvWrite: boolean;
  requiresApprovalForDeploy: boolean;
  requiresSafeBuildBeforeDeploy: boolean;
  docsStatus: DocsStatus;
  manualGuideAvailable: boolean;
  detectionHints: string[];
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const DEPLOYMENT_PROVIDER_REGISTRY: Record<ProviderId, DeploymentProvider> = {
  railway: {
    providerId: "railway",
    label: "Railway",
    description: "Railway.app — automated deployments from GitHub with built-in Postgres and environment management.",
    credentialProvider: "railway",
    requiredCredentialKinds: ["api_key", "project_id"],
    supportsEnvRead: true,
    supportsEnvWrite: true,
    supportsDeployStatus: true,
    supportsDeployTrigger: true,
    supportsDomainCheck: true,
    supportsLogs: true,
    supportsBuildLogs: true,
    supportsDryRun: false,
    requiresApprovalForEnvWrite: true,
    requiresApprovalForDeploy: true,
    requiresSafeBuildBeforeDeploy: true,
    docsStatus: "implemented",
    manualGuideAvailable: true,
    detectionHints: ["railway.json", "nixpacks.toml", "RAILWAY_TOKEN", "RAILWAY_PROJECT_ID"],
  },

  render: {
    providerId: "render",
    label: "Render",
    description: "Render.com — cloud platform for web services, static sites, and databases. Full REST API integration: deploy trigger, env var management, logs, and deploy history.",
    credentialProvider: "render",
    requiredCredentialKinds: ["api_key", "service_token"],
    supportsEnvRead: true,
    supportsEnvWrite: true,
    supportsDeployStatus: true,
    supportsDeployTrigger: true,
    supportsDomainCheck: false,
    supportsLogs: true,
    supportsBuildLogs: false,
    supportsDryRun: true,
    requiresApprovalForEnvWrite: true,
    requiresApprovalForDeploy: true,
    requiresSafeBuildBeforeDeploy: true,
    docsStatus: "implemented",
    manualGuideAvailable: true,
    detectionHints: ["render.yaml", "render.yml", "RENDER_API_KEY", "RENDER_SERVICE_ID"],
  },

  digitalocean: {
    providerId: "digitalocean",
    label: "DigitalOcean",
    description: "DigitalOcean App Platform or Droplets — flexible cloud infrastructure. Manual-guided until API adapter is implemented.",
    credentialProvider: "digitalocean",
    requiredCredentialKinds: ["access_token", "app_id"],
    supportsEnvRead: false,
    supportsEnvWrite: false,
    supportsDeployStatus: false,
    supportsDeployTrigger: false,
    supportsDomainCheck: false,
    supportsLogs: false,
    supportsBuildLogs: false,
    supportsDryRun: true,
    requiresApprovalForEnvWrite: true,
    requiresApprovalForDeploy: true,
    requiresSafeBuildBeforeDeploy: true,
    docsStatus: "adapter_placeholder",
    manualGuideAvailable: true,
    detectionHints: [".do/app.yaml", ".do/deploy.template.yaml", "DIGITALOCEAN_ACCESS_TOKEN", "DO_APP_ID"],
  },

  vercel: {
    providerId: "vercel",
    label: "Vercel",
    description: "Vercel — frontend cloud platform optimised for Next.js and React. Manual-guided until API adapter is implemented.",
    credentialProvider: "vercel",
    requiredCredentialKinds: ["access_token", "team_id", "project_id"],
    supportsEnvRead: false,
    supportsEnvWrite: false,
    supportsDeployStatus: false,
    supportsDeployTrigger: false,
    supportsDomainCheck: false,
    supportsLogs: false,
    supportsBuildLogs: false,
    supportsDryRun: true,
    requiresApprovalForEnvWrite: true,
    requiresApprovalForDeploy: true,
    requiresSafeBuildBeforeDeploy: true,
    docsStatus: "adapter_placeholder",
    manualGuideAvailable: true,
    detectionHints: ["vercel.json", ".vercelignore", "VERCEL_TOKEN", "VERCEL_TEAM_ID"],
  },

  sevall: {
    providerId: "sevall",
    label: "Sevall",
    description: "Sevall — deployment platform. Manual-guided deployment checklist available. Credentials can be stored in vault.",
    credentialProvider: "sevall",
    requiredCredentialKinds: ["api_key", "endpoint", "custom_secret"],
    supportsEnvRead: false,
    supportsEnvWrite: false,
    supportsDeployStatus: false,
    supportsDeployTrigger: false,
    supportsDomainCheck: false,
    supportsLogs: false,
    supportsBuildLogs: false,
    supportsDryRun: true,
    requiresApprovalForEnvWrite: true,
    requiresApprovalForDeploy: true,
    requiresSafeBuildBeforeDeploy: true,
    docsStatus: "adapter_placeholder",
    manualGuideAvailable: true,
    detectionHints: ["SEVALL_API_KEY", "SEVALL_ENDPOINT"],
  },

  vastai: {
    providerId: "vastai",
    label: "Vast.ai",
    description: "Vast.ai — GPU compute marketplace for renting on-demand instances. Full REST API integration: search offers, rent/start/stop/destroy instances, run constrained commands.",
    credentialProvider: "vastai",
    requiredCredentialKinds: ["api_key"],
    supportsEnvRead: false,
    supportsEnvWrite: false,
    supportsDeployStatus: true,
    supportsDeployTrigger: true,
    supportsDomainCheck: false,
    supportsLogs: false,
    supportsBuildLogs: false,
    supportsDryRun: true,
    requiresApprovalForEnvWrite: true,
    requiresApprovalForDeploy: true,
    requiresSafeBuildBeforeDeploy: false,
    docsStatus: "implemented",
    manualGuideAvailable: true,
    detectionHints: ["VAST_AI_API_KEY"],
  },

  custom: {
    providerId: "custom",
    label: "Custom / Other",
    description: "Custom or unsupported deployment provider. Manual-guided deployment checklist. User enters provider name, dashboard URL, and deploy notes. Credentials can be stored in vault.",
    credentialProvider: "custom_deployment",
    requiredCredentialKinds: ["custom_secret", "endpoint"],
    supportsEnvRead: false,
    supportsEnvWrite: false,
    supportsDeployStatus: false,
    supportsDeployTrigger: false,
    supportsDomainCheck: false,
    supportsLogs: false,
    supportsBuildLogs: false,
    supportsDryRun: true,
    requiresApprovalForEnvWrite: true,
    requiresApprovalForDeploy: true,
    requiresSafeBuildBeforeDeploy: true,
    docsStatus: "manual_guided",
    manualGuideAvailable: true,
    detectionHints: [],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const ALL_PROVIDER_IDS: ProviderId[] = [
  "railway", "render", "digitalocean", "vercel", "sevall", "custom",
];

export function getProviderById(id: string): DeploymentProvider | undefined {
  return DEPLOYMENT_PROVIDER_REGISTRY[id as ProviderId];
}

export function getAllProviders(): DeploymentProvider[] {
  return ALL_PROVIDER_IDS.map((id) => DEPLOYMENT_PROVIDER_REGISTRY[id]);
}

export function isPlaceholderProvider(id: string): boolean {
  const p = getProviderById(id);
  return !p || p.docsStatus === "adapter_placeholder";
}

export function isManualGuidedProvider(id: string): boolean {
  const p = getProviderById(id);
  return !p || p.docsStatus === "manual_guided" || p.docsStatus === "adapter_placeholder";
}

export function canExecuteProvider(id: string): boolean {
  const p = getProviderById(id);
  return !!p && p.docsStatus === "implemented";
}

export function detectProviderFromHints(fileList: string[], envNames: string[]): ProviderId | null {
  for (const pid of ALL_PROVIDER_IDS) {
    if (pid === "custom") continue;
    const provider = DEPLOYMENT_PROVIDER_REGISTRY[pid];
    const allHints = [...fileList, ...envNames];
    if (provider.detectionHints.some((hint) => allHints.some((h) => h.includes(hint)))) {
      return pid;
    }
  }
  return null;
}

/** Generate a human-readable manual deployment guide for a placeholder provider */
export function generateManualGuide(providerId: string, appName: string, publicUrl?: string): string {
  const provider = getProviderById(providerId);
  if (!provider) return "Unknown provider — no guide available.";

  const lines = [
    `# Manual Deployment Guide — ${provider.label}`,
    `App: ${appName}`,
    publicUrl ? `URL: ${publicUrl}` : "",
    "",
    "## Pre-deployment checklist",
    "- [ ] Run safe-build locally and confirm it passes",
    "- [ ] Confirm all required environment variables are set in the provider dashboard",
    "- [ ] Confirm DNS records point to the correct provider",
    "- [ ] Review TLS/SSL certificate status",
    "- [ ] Confirm database migrations are ready",
    "",
    `## ${provider.label} deployment steps`,
  ];

  switch (providerId) {
    case "render":
      lines.push(
        "1. Open your Render dashboard at https://dashboard.render.com",
        "2. Select the service for this app",
        "3. Click 'Manual Deploy' → 'Deploy latest commit'",
        "4. Monitor the deploy log for errors",
        "5. Verify the public URL is responding after deploy",
      );
      break;
    case "digitalocean":
      lines.push(
        "1. Open your DigitalOcean App Platform at https://cloud.digitalocean.com/apps",
        "2. Select the app for this project",
        "3. Click 'Deploy' to trigger a new deployment",
        "4. Monitor build logs",
        "5. Verify the app URL is responding",
      );
      break;
    case "vercel":
      lines.push(
        "1. Open your Vercel dashboard at https://vercel.com/dashboard",
        "2. Select the project",
        "3. Trigger a redeploy from the Deployments tab, or push to the connected branch",
        "4. Monitor the build output",
        "5. Verify the deployment URL",
      );
      break;
    case "vastai":
      lines.push(
        "1. Search for a suitable GPU offer via GET /api/vastai-connector/offers (filter by GPU type, price, region)",
        "2. Rent it via POST /api/vastai-connector/instances with the offer id and a Docker image",
        "3. Poll GET /api/vastai-connector/instances until actual_status is 'running'",
        "4. Connect via SSH using the returned sshHost/sshPort, or run commands via POST /api/vastai-connector/instances/:id/command",
        "5. Stop the instance when idle to pause compute billing (disk storage still bills until destroyed)",
        "6. Destroy the instance via DELETE /api/vastai-connector/instances/:id when done — this is irreversible and deletes all data on it",
      );
      break;
    case "sevall":
      lines.push(
        "1. Log in to your Sevall dashboard",
        "2. Navigate to your project",
        "3. Follow your provider's deployment process",
        "4. Note: Sevall support is available as a manual-guided provider until API integration is confirmed",
        "5. Store your Sevall credentials in VIBA Vault for future automation",
      );
      break;
    case "custom":
      lines.push(
        "1. Log in to your deployment provider's dashboard",
        "2. Follow your provider's standard deployment process",
        "3. Store any credentials in VIBA Vault for tracking",
        "4. Record the public URL in the Production Ops monitor",
      );
      break;
    default:
      lines.push("Follow your provider's deployment documentation.");
  }

  lines.push(
    "",
    "## Post-deployment verification",
    "- [ ] Public URL responds with HTTP 200",
    "- [ ] API health endpoint responds",
    "- [ ] Auth route returns 401 (not 5xx)",
    "- [ ] TLS certificate is valid",
    "- [ ] Run VIBA Production Ops → Check Now",
  );

  return lines.filter((l) => l !== "").join("\n");
}
