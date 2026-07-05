export type DeploymentTriggerType = "MANUAL" | "GITHUB_PUSH" | "ROLLBACK";
export type DeploymentStatus =
  | "QUEUED"
  | "BUILDING"
  | "DEPLOYING"
  | "LIVE"
  | "FAILED"
  | "ROLLED_BACK"
  | "CANCELLED";
export type AddonType = "POSTGRES" | "REDIS";
export type AddonStatus =
  | "PROVISIONING"
  | "RUNNING"
  | "STOPPED"
  | "FAILED"
  | "DELETED";

export type FrameworkKind =
  | "vite"
  | "nextjs"
  | "nuxt"
  | "remix"
  | "astro"
  | "sveltekit"
  | "express"
  | "fastify"
  | "nestjs"
  | "static"
  | "unknown";

export type PackageManager = "pnpm" | "yarn" | "npm" | "bun";

export interface FrameworkDetectionResult {
  framework: FrameworkKind;
  packageManager: PackageManager;
  buildCommand: string;
  startCommand: string;
  installCommand: string;
  port: number;
  hasDockerfile: boolean;
  detectedLockfile: string | null;
}

export interface CreateProjectInput {
  name: string;
  ownerId: string;
}

export interface ConnectRepositoryInput {
  projectId: string;
  installationId: string;
  repositoryId: string;
  deployBranch: string;
  autoDeployEnabled?: boolean;
}

export interface CreateDeploymentInput {
  projectId: string;
  triggerType: DeploymentTriggerType;
  commitSha?: string;
  commitMessage?: string;
  commitAuthor?: string;
}

export interface RollbackInput {
  projectId: string;
  targetDeploymentId: string;
}

export interface CreateAddonInput {
  projectId: string;
  type: AddonType;
}

export interface SetEnvVarInput {
  projectId: string;
  key: string;
  value: string;
  managed?: boolean;
}

export interface CreateDomainInput {
  projectId: string;
  domain: string;
}

export interface DeployProject {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  status: string;
  liveUrl: string | null;
  customDomain: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  installCommand: string | null;
  rootDir: string | null;
  envPort: string | null;
  cpuLimit: string | null;
  memoryLimit: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Deployment {
  id: string;
  projectId: string;
  triggerType: DeploymentTriggerType;
  status: DeploymentStatus;
  commitSha: string | null;
  commitMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface DeploymentLog {
  id: string;
  deploymentId: string;
  level: string;
  message: string;
  stream: string;
  timestamp: Date;
}

export interface GithubInstallation {
  id: string;
  installationId: number;
  accountLogin: string;
  accountType: string;
  targetType: string;
}

export interface GithubRepository {
  id: string;
  installationId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
}

export interface DeployAddon {
  id: string;
  projectId: string;
  type: AddonType;
  status: AddonStatus;
  containerName: string | null;
  encryptedConnectionUrl: string | null;
  envVarName: string;
  volumeName: string | null;
  managed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeployEnvVar {
  id: string;
  projectId: string;
  key: string;
  managed: boolean;
  maskedValue: string;
}

export interface DeployDomain {
  id: string;
  projectId: string;
  domain: string;
  status: string;
  verificationToken: string | null;
}

export interface GitHubPushWebhookPayload {
  ref: string;
  after: string;
  repository: {
    full_name: string;
    default_branch: string;
  };
  head_commit: {
    id: string;
    message: string;
    author: { name: string };
  } | null;
  installation: {
    id: number;
  };
}

export interface FailureDiagnosis {
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  likelyCause: string;
  logExcerpt: string;
  recommendedFix: string;
  oneClickFix?: {
    action: string;
    label: string;
    safe: boolean;
  };
}

export interface DockerContainerConfig {
  name: string;
  image: string;
  envVars: Record<string, string>;
  ports: { host: number; container: number }[];
  volumes: { host: string; container: string }[];
  network: string;
  cpuLimit: string;
  memoryLimit: string;
  healthCheck?: {
    path: string;
    port: number;
    intervalSeconds: number;
    timeoutSeconds: number;
    retries: number;
  };
}

export interface CaddyRoute {
  projectSlug: string;
  domain: string;
  upstreamPort: number;
  customDomain?: string;
}
