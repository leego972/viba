import crypto from "crypto";
import { eq, desc, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  vibaDeployProjects,
  vibaDeployments,
  vibaDeploymentLogs,
  vibaDeployAddons,
  vibaDeployDomains,
  vibaDeployEnvVars,
  projectGithubConnections,
  githubInstallations,
  githubRepositories,
} from "@workspace/db";
import { logger } from "../../lib/logger";
import { encryptSecret, decryptSecret, maskValue, maskSecrets, generateSecurePassword, generateVerificationToken } from "./secrets.service";
import { containerName, imageTag, buildImage, runContainer, stopContainer, runHealthCheck, ensureNetwork, isDockerAvailable } from "./docker.adapter";
import { upsertCaddyRoute } from "./caddy.adapter";
import { diagnoseFailure } from "./diagnosis.service";
import {
  isRenderConfigured,
  createWebService,
  triggerDeploy as renderTriggerDeploy,
  pollDeployUntilDone,
  updateEnvVars as renderUpdateEnvVars,
  createPostgresDatabase,
  createRedisInstance,
  addCustomDomain as renderAddCustomDomain,
  deleteService as renderDeleteService,
  getServiceInfo,
} from "./render.adapter";
import { getInstallationToken, buildCloneUrl } from "./github.adapter";
import type {
  CreateProjectInput,
  ConnectRepositoryInput,
  CreateDeploymentInput,
  CreateAddonInput,
  SetEnvVarInput,
  CreateDomainInput,
  RollbackInput,
  DeployProject,
  Deployment,
  DeployAddon,
  DeployEnvVar,
  DeployDomain,
} from "./deploy.types";

function generateId(): string {
  return crypto.randomUUID();
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const DOCKER_NETWORK = "viba_deploy_network";

export async function createProject(input: CreateProjectInput): Promise<DeployProject> {
  const id = generateId();
  const slug = `${slugify(input.name)}-${id.slice(0, 6)}`;
  const [row] = await db
    .insert(vibaDeployProjects)
    .values({ id, name: input.name, slug, ownerId: input.ownerId })
    .returning();
  logger.info({ id, slug }, "Deploy project created");
  return row as DeployProject;
}

export async function getProject(projectId: string): Promise<DeployProject | null> {
  const [row] = await db
    .select()
    .from(vibaDeployProjects)
    .where(eq(vibaDeployProjects.id, projectId))
    .limit(1);
  return row ? (row as DeployProject) : null;
}

export async function listProjects(ownerId: string): Promise<DeployProject[]> {
  return db
    .select()
    .from(vibaDeployProjects)
    .where(eq(vibaDeployProjects.ownerId, ownerId)) as Promise<DeployProject[]>;
}

export async function deleteProject(projectId: string): Promise<void> {
  await db.delete(vibaDeployProjects).where(eq(vibaDeployProjects.id, projectId));
  logger.info({ projectId }, "Deploy project deleted");
}

export async function connectGithubRepo(input: ConnectRepositoryInput): Promise<void> {
  const existing = await db
    .select()
    .from(projectGithubConnections)
    .where(eq(projectGithubConnections.projectId, input.projectId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(projectGithubConnections)
      .set({
        installationId: input.installationId,
        repositoryId: input.repositoryId,
        deployBranch: input.deployBranch,
        autoDeployEnabled: input.autoDeployEnabled ?? true,
        updatedAt: new Date(),
      })
      .where(eq(projectGithubConnections.projectId, input.projectId));
  } else {
    await db.insert(projectGithubConnections).values({
      id: generateId(),
      projectId: input.projectId,
      installationId: input.installationId,
      repositoryId: input.repositoryId,
      deployBranch: input.deployBranch,
      autoDeployEnabled: input.autoDeployEnabled ?? true,
    });
  }
  logger.info(input, "GitHub repo connected to project");
}

export async function createDeployment(input: CreateDeploymentInput): Promise<Deployment> {
  const id = generateId();
  const [row] = await db
    .insert(vibaDeployments)
    .values({
      id,
      projectId: input.projectId,
      triggerType: input.triggerType,
      status: "QUEUED",
      commitSha: input.commitSha ?? null,
      commitMessage: input.commitMessage ?? null,
      commitAuthor: input.commitAuthor ?? null,
    })
    .returning();
  logger.info({ id, projectId: input.projectId, trigger: input.triggerType }, "Deployment created");
  return row as Deployment;
}

export async function updateDeploymentStatus(
  deploymentId: string,
  status: Deployment["status"],
  extra: { errorCategory?: string; errorSummary?: string; imageTag?: string } = {},
): Promise<void> {
  const now = new Date();
  await db
    .update(vibaDeployments)
    .set({
      status,
      updatedAt: now,
      ...(status === "BUILDING" ? { startedAt: now } : {}),
      ...(["LIVE", "FAILED", "ROLLED_BACK", "CANCELLED"].includes(status)
        ? { finishedAt: now }
        : {}),
      ...extra,
    })
    .where(eq(vibaDeployments.id, deploymentId));
}

export async function appendDeploymentLog(
  deploymentId: string,
  message: string,
  level = "info",
  stream = "stdout",
): Promise<void> {
  await db.insert(vibaDeploymentLogs).values({
    id: generateId(),
    deploymentId,
    level,
    message: maskSecrets(message),
    stream,
  });
}

export async function getDeploymentLogs(deploymentId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(vibaDeploymentLogs)
    .where(eq(vibaDeploymentLogs.deploymentId, deploymentId))
    .orderBy(vibaDeploymentLogs.timestamp);
  return rows.map((r) => `[${r.level.toUpperCase()}] ${r.message}`);
}

export async function listDeployments(projectId: string, limit = 20): Promise<Deployment[]> {
  return db
    .select()
    .from(vibaDeployments)
    .where(eq(vibaDeployments.projectId, projectId))
    .orderBy(desc(vibaDeployments.createdAt))
    .limit(limit) as Promise<Deployment[]>;
}

export async function getLastSuccessfulDeployment(projectId: string): Promise<Deployment | null> {
  const [row] = await db
    .select()
    .from(vibaDeployments)
    .where(
      and(
        eq(vibaDeployments.projectId, projectId),
        eq(vibaDeployments.status, "LIVE"),
      ),
    )
    .orderBy(desc(vibaDeployments.finishedAt))
    .limit(1);
  return row ? (row as Deployment) : null;
}

export async function runDeploymentPipeline(deploymentId: string): Promise<void> {
  const [deployment] = await db
    .select()
    .from(vibaDeployments)
    .where(eq(vibaDeployments.id, deploymentId))
    .limit(1);

  if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

  const log = (msg: string, level = "info") => {
    logger[level as "info"]({ deploymentId }, msg);
    void appendDeploymentLog(deploymentId, msg, level);
  };

  await updateDeploymentStatus(deploymentId, "BUILDING");
  log("Pipeline started");

  const project = await getProject(deployment.projectId);
  if (!project) {
    await updateDeploymentStatus(deploymentId, "FAILED", { errorSummary: "Project not found" });
    return;
  }

  // ── Render-backed pipeline (runs on Render, no Docker needed) ───────────────
  if (isRenderConfigured() && !isDockerAvailable()) {
    await runRenderPipeline(deploymentId, deployment, project, log);
    return;
  }

  // ── Docker-backed pipeline (VPS with Docker installed) ────────────────────
  if (!isDockerAvailable()) {
    log("Neither Docker nor Render API is configured. Cannot run deployment.", "error");
    await updateDeploymentStatus(deploymentId, "FAILED", {
      errorCategory: "no_runtime",
      errorSummary: "Set RENDER_API_KEY to deploy via Render, or run on a VPS with Docker.",
    });
    return;
  }

  try {
    await ensureNetwork(DOCKER_NETWORK);
    log("Docker network ready");

    const envVarRows = await db
      .select()
      .from(vibaDeployEnvVars)
      .where(eq(vibaDeployEnvVars.projectId, project.id));

    const envVars: Record<string, string> = {};
    for (const row of envVarRows) {
      try {
        envVars[row.key] = decryptSecret(row.encryptedValue);
      } catch {
        log(`Warning: could not decrypt env var ${row.key}`, "warn");
      }
    }

    const tag = imageTag(project.id, deploymentId);
    log(`Building image ${tag}`);

    const buildResult = await buildImage(
      `/tmp/viba-builds/${deploymentId}`,
      tag,
      envVars,
      (line) => log(line),
    );

    if (!buildResult.success) {
      const logs = await getDeploymentLogs(deploymentId);
      const diagnosis = diagnoseFailure(logs);
      await updateDeploymentStatus(deploymentId, "FAILED", {
        errorCategory: diagnosis?.category,
        errorSummary: diagnosis?.likelyCause ?? buildResult.error,
      });
      log(`Build failed: ${buildResult.error}`, "error");
      return;
    }

    log("Image built successfully. Stopping previous container...");
    const prevContainer = containerName(project.id, "web");
    await stopContainer(prevContainer);

    await updateDeploymentStatus(deploymentId, "DEPLOYING");
    log("Starting new container...");

    const runResult = await runContainer(
      {
        name: prevContainer,
        image: tag,
        envVars,
        ports: [{ host: 0, container: parseInt(project.envPort ?? "3000") }],
        volumes: [],
        network: DOCKER_NETWORK,
        cpuLimit: project.cpuLimit ?? "0.5",
        memoryLimit: project.memoryLimit ?? "512m",
      },
      (line) => log(line),
    );

    if (!runResult.success) {
      await updateDeploymentStatus(deploymentId, "FAILED", { errorSummary: runResult.error });
      return;
    }

    log("Container started. Running health check...");
    const healthy = await runHealthCheck(prevContainer, parseInt(project.envPort ?? "3000"));

    if (!healthy) {
      log("Health check failed", "error");
      await updateDeploymentStatus(deploymentId, "FAILED", {
        errorCategory: "health_check_timeout",
        errorSummary: "Container started but health check did not pass",
      });
      return;
    }

    await upsertCaddyRoute({
      projectSlug: project.slug,
      domain: project.slug,
      upstreamPort: parseInt(project.envPort ?? "3000"),
      customDomain: project.customDomain ?? undefined,
    });

    await updateDeploymentStatus(deploymentId, "LIVE", { imageTag: tag });
    log("Deployment is LIVE");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Pipeline error: ${msg}`, "error");
    await updateDeploymentStatus(deploymentId, "FAILED", { errorSummary: msg });
  }
}

async function runRenderPipeline(
  deploymentId: string,
  deployment: { projectId: string; commitSha: string | null; commitMessage: string | null },
  project: DeployProject,
  log: (msg: string, level?: string) => void,
): Promise<void> {
  try {
    // Get GitHub connection to find repo details
    const [conn] = await db
      .select()
      .from(projectGithubConnections)
      .where(eq(projectGithubConnections.projectId, project.id))
      .limit(1);

    const [ghInst] = conn
      ? await db
          .select()
          .from(githubInstallations)
          .where(eq(githubInstallations.id, conn.installationId))
          .limit(1)
      : [];

    const [ghRepo] = conn
      ? await db
          .select()
          .from(githubRepositories)
          .where(eq(githubRepositories.id, conn.repositoryId))
          .limit(1)
      : [];

    // Decrypt env vars
    const envVarRows = await db
      .select()
      .from(vibaDeployEnvVars)
      .where(eq(vibaDeployEnvVars.projectId, project.id));

    const envVars: Record<string, string> = {};
    for (const row of envVarRows) {
      try {
        envVars[row.key] = decryptSecret(row.encryptedValue);
      } catch {
        log(`Warning: could not decrypt env var ${row.key}`, "warn");
      }
    }

    let renderServiceId = (project as DeployProject & { renderServiceId?: string | null }).renderServiceId;

    // Create Render service if first deploy
    if (!renderServiceId) {
      log("Creating Render service...");

      const repoUrl = ghRepo
        ? `https://github.com/${ghRepo.fullName}`
        : null;

      if (!repoUrl) {
        await updateDeploymentStatus(deploymentId, "FAILED", {
          errorSummary: "No GitHub repo connected. Connect a repository first.",
        });
        log("No GitHub repo connected to this project.", "error");
        return;
      }

      const branch = conn?.deployBranch ?? ghRepo?.defaultBranch ?? "main";
      const buildCmd = project.buildCommand ?? "npm run build";
      const startCmd = project.startCommand ?? "npm start";

      const svc = await createWebService({
        name: `viba-${project.slug}`,
        repoUrl,
        branch,
        buildCommand: buildCmd,
        startCommand: startCmd,
        envVars,
        plan: (project as DeployProject & { renderPlan?: string | null }).renderPlan ?? "starter",
        region: (project as DeployProject & { renderRegion?: string | null }).renderRegion ?? "oregon",
      });

      renderServiceId = svc.id;

      // Persist renderServiceId on the project
      await db
        .update(vibaDeployProjects)
        .set({ renderServiceId, liveUrl: svc.serviceUrl, updatedAt: new Date() })
        .where(eq(vibaDeployProjects.id, project.id));

      log(`Render service created: ${svc.id} — ${svc.dashboardUrl}`);
    } else {
      // Push latest env vars to existing service
      if (Object.keys(envVars).length > 0) {
        await renderUpdateEnvVars(renderServiceId, envVars);
        log("Env vars synced to Render service");
      }
    }

    log("Triggering Render deploy...");
    await updateDeploymentStatus(deploymentId, "DEPLOYING");

    const { deployId: renderDeployId } = await renderTriggerDeploy(renderServiceId, false);

    // Persist Render deploy ID
    await db
      .update(vibaDeployments)
      .set({ renderDeployId, updatedAt: new Date() } as Record<string, unknown>)
      .where(eq(vibaDeployments.id, deploymentId));

    log(`Render deploy queued: ${renderDeployId}. Polling for completion...`);

    const result = await pollDeployUntilDone(
      renderServiceId,
      renderDeployId,
      (msg) => log(msg),
      600_000,
    );

    if (result === "live") {
      const svcInfo = await getServiceInfo(renderServiceId);
      await db
        .update(vibaDeployProjects)
        .set({ status: "active", liveUrl: svcInfo.serviceUrl, updatedAt: new Date() })
        .where(eq(vibaDeployProjects.id, project.id));

      await updateDeploymentStatus(deploymentId, "LIVE");
      log(`Deployment LIVE at: ${svcInfo.serviceUrl ?? "see Render dashboard"}`);
    } else {
      await updateDeploymentStatus(deploymentId, "FAILED", {
        errorCategory: "render_build_failed",
        errorSummary: `Render deploy finished with status: ${result}`,
      });
      log(`Render deploy finished with status: ${result}`, "error");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Render pipeline error: ${msg}`, "error");
    await updateDeploymentStatus(deploymentId, "FAILED", { errorSummary: msg });
  }
}

export async function rollback(input: RollbackInput): Promise<Deployment> {
  const [target] = await db
    .select()
    .from(vibaDeployments)
    .where(eq(vibaDeployments.id, input.targetDeploymentId))
    .limit(1);

  if (!target || target.projectId !== input.projectId) {
    throw new Error("Target deployment not found or project mismatch");
  }

  const rollbackDeployment = await createDeployment({
    projectId: input.projectId,
    triggerType: "ROLLBACK",
    commitSha: target.commitSha ?? undefined,
    commitMessage: `Rollback to ${target.id}`,
  });

  await db
    .update(vibaDeployments)
    .set({ previousDeploymentId: target.id })
    .where(eq(vibaDeployments.id, rollbackDeployment.id));

  void runDeploymentPipeline(rollbackDeployment.id);

  return rollbackDeployment;
}

export async function createAddon(input: CreateAddonInput): Promise<DeployAddon> {
  const id = generateId();
  const password = generateSecurePassword();
  const cName = containerName(input.projectId, input.type.toLowerCase() as "postgres" | "redis");
  const envVarName = input.type === "POSTGRES" ? "DATABASE_URL" : "REDIS_URL";

  let connectionUrl: string;
  let encryptedUrl: string;

  if (input.type === "POSTGRES") {
    connectionUrl = `postgresql://viba:${password}@${cName}:5432/vibadb`;
  } else {
    connectionUrl = `redis://:${password}@${cName}:6379`;
  }
  encryptedUrl = encryptSecret(connectionUrl);

  const [row] = await db
    .insert(vibaDeployAddons)
    .values({
      id,
      projectId: input.projectId,
      type: input.type,
      status: "PROVISIONING",
      containerName: cName,
      encryptedConnectionUrl: encryptedUrl,
      envVarName,
      volumeName: `viba-vol-${input.projectId}-${input.type.toLowerCase()}`,
      managed: true,
    })
    .returning();

  await setEnvVar({ projectId: input.projectId, key: envVarName, value: connectionUrl, managed: true });

  logger.info({ id, type: input.type, projectId: input.projectId }, "Add-on created");

  if (isDockerAvailable()) {
    void provisionAddonContainer(row as DeployAddon, password);
  } else if (isRenderConfigured()) {
    void provisionRenderAddon(row as DeployAddon, input.projectId);
  } else {
    logger.warn("No runtime available — add-on not provisioned. Set RENDER_API_KEY.");
    await db
      .update(vibaDeployAddons)
      .set({ status: "STOPPED" })
      .where(eq(vibaDeployAddons.id, id));
  }

  return row as DeployAddon;
}

async function provisionRenderAddon(addon: DeployAddon, projectId: string): Promise<void> {
  try {
    const project = await getProject(projectId);
    const baseName = `viba-${project?.slug ?? projectId.slice(0, 8)}`;

    if (addon.type === "POSTGRES") {
      const pg = await createPostgresDatabase({
        name: `${baseName}-postgres`,
        plan: "starter",
      });

      const connUrl = pg.connectionString;
      const encrypted = encryptSecret(connUrl);

      await db
        .update(vibaDeployAddons)
        .set({
          status: "RUNNING",
          renderResourceId: pg.id,
          encryptedConnectionUrl: encrypted,
          updatedAt: new Date(),
        })
        .where(eq(vibaDeployAddons.id, addon.id));

      await setEnvVar({ projectId, key: "DATABASE_URL", value: connUrl, managed: true });
      logger.info({ addonId: addon.id, pgId: pg.id }, "Render Postgres provisioned");
    } else {
      const redis = await createRedisInstance({
        name: `${baseName}-redis`,
        plan: "starter",
      });

      const redisUrl = redis.redisUrl;
      const encrypted = encryptSecret(redisUrl);

      await db
        .update(vibaDeployAddons)
        .set({
          status: "RUNNING",
          renderResourceId: redis.id,
          encryptedConnectionUrl: encrypted,
          updatedAt: new Date(),
        })
        .where(eq(vibaDeployAddons.id, addon.id));

      await setEnvVar({ projectId, key: "REDIS_URL", value: redisUrl, managed: true });
      logger.info({ addonId: addon.id, redisId: redis.id }, "Render Redis provisioned");
    }
  } catch (err) {
    logger.error({ err, addonId: addon.id }, "Render add-on provisioning failed");
    await db
      .update(vibaDeployAddons)
      .set({ status: "FAILED" })
      .where(eq(vibaDeployAddons.id, addon.id));
  }
}

async function provisionAddonContainer(addon: DeployAddon, password: string): Promise<void> {
  try {
    await ensureNetwork(DOCKER_NETWORK);
    if (addon.type === "POSTGRES") {
      await runContainer({
        name: addon.containerName!,
        image: "postgres:16-alpine",
        envVars: { POSTGRES_USER: "viba", POSTGRES_PASSWORD: password, POSTGRES_DB: "vibadb" },
        ports: [],
        volumes: [{ host: addon.volumeName!, container: "/var/lib/postgresql/data" }],
        network: DOCKER_NETWORK,
        cpuLimit: "0.25",
        memoryLimit: "256m",
      });
    } else {
      await runContainer({
        name: addon.containerName!,
        image: "redis:7-alpine",
        envVars: {},
        ports: [],
        volumes: [{ host: addon.volumeName!, container: "/data" }],
        network: DOCKER_NETWORK,
        cpuLimit: "0.1",
        memoryLimit: "128m",
      });
    }
    await db
      .update(vibaDeployAddons)
      .set({ status: "RUNNING" })
      .where(eq(vibaDeployAddons.id, addon.id));
  } catch (err) {
    logger.error({ err, addonId: addon.id }, "Add-on container provisioning failed");
    await db
      .update(vibaDeployAddons)
      .set({ status: "FAILED" })
      .where(eq(vibaDeployAddons.id, addon.id));
  }
}

export async function listAddons(projectId: string): Promise<DeployAddon[]> {
  return db
    .select()
    .from(vibaDeployAddons)
    .where(eq(vibaDeployAddons.projectId, projectId)) as Promise<DeployAddon[]>;
}

export async function deleteAddon(addonId: string): Promise<void> {
  const [addon] = await db
    .select()
    .from(vibaDeployAddons)
    .where(eq(vibaDeployAddons.id, addonId))
    .limit(1);
  if (!addon) return;
  if (addon.containerName && isDockerAvailable()) {
    await stopContainer(addon.containerName);
  }
  await db.delete(vibaDeployAddons).where(eq(vibaDeployAddons.id, addonId));
  logger.info({ addonId }, "Add-on deleted");
}

export async function setEnvVar(input: SetEnvVarInput): Promise<DeployEnvVar> {
  const existing = await db
    .select()
    .from(vibaDeployEnvVars)
    .where(
      and(
        eq(vibaDeployEnvVars.projectId, input.projectId),
        eq(vibaDeployEnvVars.key, input.key),
      ),
    )
    .limit(1);

  const encrypted = encryptSecret(input.value);

  if (existing.length > 0) {
    const [row] = await db
      .update(vibaDeployEnvVars)
      .set({ encryptedValue: encrypted, managed: input.managed ?? false, updatedAt: new Date() })
      .where(eq(vibaDeployEnvVars.id, existing[0].id))
      .returning();
    return { ...row, maskedValue: maskValue(input.value) } as DeployEnvVar;
  }

  const [row] = await db
    .insert(vibaDeployEnvVars)
    .values({
      id: generateId(),
      projectId: input.projectId,
      key: input.key,
      encryptedValue: encrypted,
      managed: input.managed ?? false,
    })
    .returning();
  return { ...row, maskedValue: maskValue(input.value) } as DeployEnvVar;
}

export async function listEnvVars(projectId: string): Promise<DeployEnvVar[]> {
  const rows = await db
    .select()
    .from(vibaDeployEnvVars)
    .where(eq(vibaDeployEnvVars.projectId, projectId));
  return rows.map((r) => ({ ...r, maskedValue: "****" })) as DeployEnvVar[];
}

export async function deleteEnvVar(envId: string): Promise<void> {
  await db.delete(vibaDeployEnvVars).where(eq(vibaDeployEnvVars.id, envId));
}

export async function createDomain(input: CreateDomainInput): Promise<DeployDomain> {
  const token = generateVerificationToken();
  const [row] = await db
    .insert(vibaDeployDomains)
    .values({
      id: generateId(),
      projectId: input.projectId,
      domain: input.domain,
      status: "PENDING",
      verificationToken: token,
    })
    .returning();
  logger.info({ domain: input.domain, projectId: input.projectId }, "Domain created");
  return row as DeployDomain;
}

export async function listDomains(projectId: string): Promise<DeployDomain[]> {
  return db
    .select()
    .from(vibaDeployDomains)
    .where(eq(vibaDeployDomains.projectId, projectId)) as Promise<DeployDomain[]>;
}

export async function verifyDomain(domainId: string): Promise<boolean> {
  const [domain] = await db
    .select()
    .from(vibaDeployDomains)
    .where(eq(vibaDeployDomains.id, domainId))
    .limit(1);
  if (!domain || !domain.verificationToken) return false;

  try {
    const dns = require("dns/promises") as typeof import("dns/promises");
    const records = await dns.resolveTxt(`_viba-deploy.${domain.domain}`);
    const expected = `viba-verify-${domain.verificationToken}`;
    const verified = records.flat().some((r) => r === expected);

    if (verified) {
      await db
        .update(vibaDeployDomains)
        .set({ status: "ACTIVE", verifiedAt: new Date() })
        .where(eq(vibaDeployDomains.id, domainId));
    }
    return verified;
  } catch {
    return false;
  }
}
