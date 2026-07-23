import { db, vibaDeployments } from "@workspace/db";
import { eq } from "drizzle-orm";
import type {
  CreateProjectInput,
  ConnectRepositoryInput,
  CreateDeploymentInput,
  SetEnvVarInput,
  CreateDomainInput,
  RollbackInput,
  DeployProject,
  Deployment,
  DeployAddon,
  DeployEnvVar,
  DeployDomain,
  GithubInstallation,
  GithubRepository,
} from "./deploy.types";
import * as svc from "./deploy.service";
import * as gh from "./github.adapter";

export const deployAdapter = {
  async createProject(input: CreateProjectInput): Promise<DeployProject> {
    return svc.createProject(input);
  },

  async getProject(projectId: string): Promise<DeployProject | null> {
    return svc.getProject(projectId);
  },

  async listProjects(ownerId: string): Promise<DeployProject[]> {
    return svc.listProjects(ownerId);
  },

  async deleteProject(projectId: string, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new Error("Deletion requires confirmation=true");
    return svc.deleteProject(projectId);
  },

  async connectRepository(input: ConnectRepositoryInput): Promise<void> {
    return svc.connectGithubRepo({ ...input, autoDeployEnabled: false });
  },

  async createDeployment(input: CreateDeploymentInput): Promise<Deployment> {
    const deployment = await svc.createDeployment(input);
    void svc.runDeploymentPipeline(deployment.id);
    return deployment;
  },

  async getDeploymentStatus(deploymentId: string): Promise<Deployment | null> {
    const [deployment] = await db
      .select()
      .from(vibaDeployments)
      .where(eq(vibaDeployments.id, deploymentId))
      .limit(1);
    return (deployment ?? null) as Deployment | null;
  },

  async getDeploymentLogs(deploymentId: string): Promise<string[]> {
    return svc.getDeploymentLogs(deploymentId);
  },

  async redeploy(projectId: string): Promise<Deployment> {
    const last = await svc.getLastSuccessfulDeployment(projectId);
    const deployment = await svc.createDeployment({
      projectId,
      triggerType: "MANUAL",
      commitSha: last?.commitSha ?? undefined,
      commitMessage: "Manual redeploy",
    });
    void svc.runDeploymentPipeline(deployment.id);
    return deployment;
  },

  async rollback(input: RollbackInput): Promise<Deployment> {
    return svc.rollback(input);
  },

  async listDeployments(projectId: string): Promise<Deployment[]> {
    return svc.listDeployments(projectId);
  },

  async createDomain(input: CreateDomainInput): Promise<DeployDomain> {
    return svc.createDomain(input);
  },

  async listDomains(projectId: string): Promise<DeployDomain[]> {
    return svc.listDomains(projectId);
  },

  async verifyDomain(domainId: string): Promise<{ verified: boolean }> {
    return { verified: await svc.verifyDomain(domainId) };
  },

  async createPostgresAddon(projectId: string): Promise<DeployAddon> {
    return svc.createAddon({ projectId, type: "POSTGRES" });
  },

  async createRedisAddon(projectId: string): Promise<DeployAddon> {
    return svc.createAddon({ projectId, type: "REDIS" });
  },

  async listAddons(projectId: string): Promise<DeployAddon[]> {
    return svc.listAddons(projectId);
  },

  async deleteAddon(addonId: string, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new Error("Deletion requires confirmation=true");
    return svc.deleteAddon(addonId);
  },

  async listEnvVars(projectId: string): Promise<DeployEnvVar[]> {
    return svc.listEnvVars(projectId);
  },

  async setEnvVar(input: SetEnvVarInput): Promise<DeployEnvVar> {
    return svc.setEnvVar(input);
  },

  async deleteEnvVar(envId: string): Promise<void> {
    return svc.deleteEnvVar(envId);
  },

  async listInstallations(accessToken: string): Promise<GithubInstallation[]> {
    return gh.listInstallations(accessToken);
  },

  async listRepos(installationId: number): Promise<GithubRepository[]> {
    return gh.listInstallationRepos(installationId);
  },

  buildInstallUrl(): string {
    return gh.buildInstallUrl();
  },
};
