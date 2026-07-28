/**
 * Central typed asset registry for the VIBA production asset library.
 *
 * All paths are served from /public/assets (see public/assets/**) and are
 * therefore resolved relative to the Vite base URL at runtime. Use
 * `assetUrl()` when building an <img src> so the app still works if it's
 * ever deployed under a sub-path.
 *
 * Every entry carries its real pixel dimensions so callers can set
 * width/height (or an aspect-ratio box) and avoid layout shift.
 */

export interface AssetRef {
  /** Path under /public, e.g. "/assets/agents/developer.webp" */
  src: string;
  width: number;
  height: number;
}

function asset(src: string, width: number, height: number): AssetRef {
  return { src, width, height };
}

/** Resolve an AssetRef to a URL that respects the configured base path. */
export function assetUrl(ref: AssetRef): string {
  const base = import.meta.env.BASE_URL ?? "/";
  const path = ref.src.startsWith("/") ? ref.src.slice(1) : ref.src;
  return base.endsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

// ── Brand ────────────────────────────────────────────────────────────────
export const brand = {
  vibaLogo: asset("/viba-logo.png", 1536, 1024),
  vibaBrainLogo: asset("/viba-brain-logo.svg", 520, 160),
  vibaMark: asset("/assets/brand/favicon-mark.webp", 255, 255),
  appIcon: asset("/assets/brand/app-icon.webp", 255, 255),
  leegoLogo: asset("/leego-logo-transparent.png", 389, 389),
} as const;

// ── Task execution stage icons ──────────────────────────────────────────
export const execution = {
  plan: asset("/assets/execution/plan.webp", 171, 171),
  decompose: asset("/assets/execution/decompose.webp", 171, 171),
  delegate: asset("/assets/execution/delegate.webp", 171, 171),
  execute: asset("/assets/execution/execute.webp", 171, 171),
  review: asset("/assets/execution/review.webp", 170, 170),
  verify: asset("/assets/execution/verify.webp", 171, 171),
  retry: asset("/assets/execution/retry.webp", 171, 171),
  resume: asset("/assets/execution/resume.webp", 170, 170),
  pause: asset("/assets/execution/pause.webp", 171, 171),
  cancel: asset("/assets/execution/cancel.webp", 170, 170),
  approve: asset("/assets/execution/approve.webp", 171, 171),
} as const;

// ── Agent role / capability icons ───────────────────────────────────────
export const agents = {
  developer: asset("/assets/agents/developer.webp", 115, 115),
  designer: asset("/assets/agents/designer.webp", 115, 115),
  researcher: asset("/assets/agents/researcher.webp", 115, 115),
  reviewer: asset("/assets/agents/reviewer.webp", 115, 115),
  strategist: asset("/assets/agents/strategist.webp", 116, 116),
  coordinator: asset("/assets/agents/coordinator.webp", 116, 116),
  qaAgent: asset("/assets/agents/qa-agent.webp", 115, 115),
  dataAnalyst: asset("/assets/agents/data-analyst.webp", 115, 115),
  copywriter: asset("/assets/agents/copywriter.webp", 115, 115),
  securityAgent: asset("/assets/agents/security-agent.png", 115, 115),
  browserAgent: asset("/assets/agents/browser-agent.webp", 115, 115),
  calendarAgent: asset("/assets/agents/calendar-agent.webp", 115, 115),
  deploymentAgent: asset("/assets/agents/deployment-agent.webp", 115, 115),
  emailAgent: asset("/assets/agents/email-agent.webp", 115, 115),
  fileAgent: asset("/assets/agents/file-agent.webp", 115, 115),
  memoryAgent: asset("/assets/agents/memory-agent.webp", 115, 115),
} as const;

// ── Provider / infrastructure category icons ────────────────────────────
// Used in place of remote brand-mark fetches (e.g. cdn.simpleicons.org).
export const providers = {
  reasoning: asset("/assets/providers/reasoning-provider.webp", 115, 115),
  coding: asset("/assets/providers/coding-provider.webp", 115, 115),
  image: asset("/assets/providers/image-provider.webp", 115, 115),
  video: asset("/assets/providers/video-provider.webp", 115, 115),
  speech: asset("/assets/providers/speech-provider.webp", 115, 115),
  embedding: asset("/assets/providers/embedding-provider.webp", 115, 115),
  research: asset("/assets/providers/research-provider.webp", 116, 116),
  general: asset("/assets/providers/general-ai-provider.webp", 115, 115),
  repositoryHost: asset("/assets/providers/repository-host.webp", 115, 115),
  cloudPlatform: asset("/assets/providers/cloud-platform.webp", 115, 115),
  deploymentService: asset("/assets/providers/deployment-service.webp", 116, 116),
} as const;

// ── Status / feedback icons ─────────────────────────────────────────────
export const status = {
  queued: asset("/assets/status/queued.webp", 110, 110),
  pending: asset("/assets/status/pending.webp", 109, 109),
  working: asset("/assets/status/working.webp", 110, 110),
  complete: asset("/assets/status/complete.webp", 171, 171),
  failed: asset("/assets/status/failed.webp", 109, 109),
  cancelled: asset("/assets/status/cancelled.webp", 110, 110),
  paused: asset("/assets/status/paused.webp", 109, 109),
  retrying: asset("/assets/status/retrying.webp", 109, 109),
  blocked: asset("/assets/status/blocked.webp", 170, 170),
  degraded: asset("/assets/status/degraded.webp", 110, 110),
  healthy: asset("/assets/status/healthy.webp", 110, 110),
  online: asset("/assets/status/online.webp", 109, 109),
  offline: asset("/assets/status/offline.png", 109, 109),
  connected: asset("/assets/status/connected.webp", 109, 109),
  disconnected: asset("/assets/status/disconnected.webp", 110, 110),
  verified: asset("/assets/status/verified.webp", 109, 109),
  unverified: asset("/assets/status/unverified.webp", 110, 110),
  critical: asset("/assets/status/critical.webp", 109, 109),
  warning: asset("/assets/status/warning.webp", 110, 110),
  successful: asset("/assets/status/successful.webp", 109, 109),
} as const;

// ── Empty-state illustrations ───────────────────────────────────────────
export const empty = {
  noAgents: asset("/assets/empty/no-agents.webp", 156, 156),
  noTasks: asset("/assets/empty/no-tasks.webp", 156, 156),
  noProjects: asset("/assets/empty/no-projects.webp", 494, 392),
  noProviders: asset("/assets/empty/no-providers.webp", 156, 156),
  noFiles: asset("/assets/empty/no-files.webp", 155, 155),
  noNotifications: asset("/assets/empty/no-notifications.webp", 155, 155),
  noIntegrations: asset("/assets/empty/no-integrations.webp", 156, 156),
  noRepositories: asset("/assets/empty/no-repositories.webp", 155, 155),
  noAnalytics: asset("/assets/empty/no-analytics.webp", 156, 156),
  noMemory: asset("/assets/empty/no-memory.webp", 155, 155),
  noDeployments: asset("/assets/empty/no-deployments.webp", 155, 155),
  searchReturnedNothing: asset("/assets/empty/search-returned-nothing.webp", 156, 156),
} as const;

// ── Landing-page feature illustrations ──────────────────────────────────
export const features = {
  automatedWorkflows: asset("/assets/features/automated-workflows.webp", 366, 269),
  realTimeAnalytics: asset("/assets/features/real-time-analytics.webp", 366, 268),
  secureByDesign: asset("/assets/features/secure-by-design.webp", 495, 392),
  cloudPowered: asset("/assets/features/cloud-powered.webp", 366, 269),
  customisable: asset("/assets/features/customisable.webp", 366, 269),
  globalIntelligence: asset("/assets/features/global-intelligence.webp", 291, 222),
  parallelExecution: asset("/assets/features/parallel-execution.webp", 171, 171),
  sequentialExecution: asset("/assets/features/sequential-execution.webp", 170, 170),
  oneClickDeployments: asset("/assets/features/one-click-deployments.webp", 366, 269),
  openIntegrations: asset("/assets/features/open-integrations.webp", 366, 268),
  orchestrateEverything: asset("/assets/features/orchestrate-everything.webp", 292, 222),
} as const;

// ── Hero artwork ─────────────────────────────────────────────────────────
export const hero = {
  aiOrchestration: asset("/assets/hero/ai-orchestration.webp", 156, 156),
  orchestrationCommandCentre: asset("/assets/hero/orchestration-command-centre.webp", 495, 392),
  commandCentre: asset("/assets/hero/command-centre.webp", 165, 165),
  builtForImpact: asset("/assets/hero/built-for-impact.webp", 138, 146),
  endlessPossibilities: asset("/assets/hero/endless-possibilities.webp", 291, 222),
  limitlessPlatform: asset("/assets/hero/limitless-platform.webp", 494, 392),
} as const;

// ── Backgrounds, patterns, gradients, overlays and effects ─────────────
export const backgrounds = {
  centralGlow: asset("/assets/backgrounds/central-glow.webp", 127, 131),
  hexNetwork: asset("/assets/backgrounds/hex-network.webp", 138, 146),
  circuitGrid: asset("/assets/backgrounds/circuit-grid.webp", 138, 146),
  deepSpace: asset("/assets/backgrounds/deep-space.webp", 138, 119),
  blueAtmosphere: asset("/assets/backgrounds/blue-atmosphere.webp", 138, 119),
  purpleAtmosphere: asset("/assets/backgrounds/purple-atmosphere.webp", 127, 131),
  topographic: asset("/assets/backgrounds/topographic.webp", 138, 146),
  darkVignette: asset("/assets/backgrounds/dark-vignette.webp", 127, 131),
  gridLines: asset("/assets/backgrounds/grid-lines.png", 112, 146),
  dataMatrix: asset("/assets/backgrounds/data-matrix.webp", 138, 146),
} as const;

/** Maps a session/agent execution status string to its status icon, if any. */
export const executionStatusIcon: Record<string, AssetRef | undefined> = {
  idle: status.pending,
  queued: status.queued,
  working: status.working,
  waiting: status.pending,
  reviewing: status.working,
  complete: status.complete,
  completed: status.complete,
  failed: status.failed,
  error: status.failed,
  paused: status.paused,
  cancelled: status.cancelled,
  canceled: status.cancelled,
  blocked: status.blocked,
  retrying: status.retrying,
};

/** Maps a provider id (as used in providers.tsx) to an infrastructure/category icon. */
export const providerCategoryIcon: Record<string, AssetRef> = {
  openai: providers.reasoning,
  anthropic: providers.reasoning,
  google: providers.reasoning,
  groq: providers.general,
  venice: providers.general,
  mistral: providers.reasoning,
  deepseek: providers.reasoning,
  perplexity: providers.research,
  ollama: providers.general,
  custom: providers.general,
  github: providers.repositoryHost,
  railway: providers.deploymentService,
  render: providers.deploymentService,
  vercel: providers.deploymentService,
  vastai: providers.cloudPlatform,
};
