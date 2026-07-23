import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { deployAdapter } from "./deploy.adapter";
import { diagnoseFailure } from "./diagnosis.service";
import { generateDnsVerificationInstructions } from "./caddy.adapter";
import deploySecurityBoundary from "../../middlewares/deploySecurityBoundary";

const router = Router();
router.use(deploySecurityBoundary);

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function ownerId(req: Request): string {
  const userId = req.session?.userId;
  if (typeof userId !== "number" || userId <= 0) {
    throw new Error("Authenticated deployment owner is unavailable");
  }
  return String(userId);
}

router.post(
  "/projects",
  asyncHandler(async (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const project = await deployAdapter.createProject({ name: name.trim().slice(0, 120), ownerId: ownerId(req) });
    res.status(201).json(project);
  }),
);

router.get(
  "/projects",
  asyncHandler(async (req, res) => {
    res.json(await deployAdapter.listProjects(ownerId(req)));
  }),
);

router.get(
  "/projects/:projectId",
  asyncHandler(async (req, res) => {
    const project = await deployAdapter.getProject(String(req.params.projectId));
    if (!project) { res.status(404).json({ error: "Not found" }); return; }
    res.json(project);
  }),
);

router.delete(
  "/projects/:projectId",
  asyncHandler(async (req, res) => {
    const { confirmed } = req.body as { confirmed?: boolean };
    await deployAdapter.deleteProject(String(req.params.projectId), confirmed === true);
    res.json({ ok: true });
  }),
);

router.post(
  "/projects/:projectId/connect-github",
  asyncHandler(async (req, res) => {
    const { installationId, repositoryId, deployBranch } = req.body as {
      installationId?: string;
      repositoryId?: string;
      deployBranch?: string;
    };
    if (!installationId || !repositoryId) {
      res.status(400).json({ error: "installationId and repositoryId are required" });
      return;
    }
    await deployAdapter.connectRepository({
      projectId: String(req.params.projectId),
      installationId,
      repositoryId,
      deployBranch: deployBranch?.trim() || "main",
      autoDeployEnabled: false,
    });
    res.json({ ok: true, autoDeployEnabled: false });
  }),
);

router.post(
  "/projects/:projectId/deploy",
  asyncHandler(async (req, res) => {
    const dep = await deployAdapter.createDeployment({
      projectId: String(req.params.projectId),
      triggerType: "MANUAL",
    });
    res.status(202).json(dep);
  }),
);

router.post(
  "/projects/:projectId/redeploy",
  asyncHandler(async (req, res) => {
    const dep = await deployAdapter.redeploy(String(req.params.projectId));
    res.status(202).json(dep);
  }),
);

router.get(
  "/projects/:projectId/deployments",
  asyncHandler(async (req, res) => {
    res.json(await deployAdapter.listDeployments(String(req.params.projectId)));
  }),
);

router.get(
  "/deployments/:deploymentId",
  asyncHandler(async (req, res) => {
    const dep = await deployAdapter.getDeploymentStatus(String(req.params.deploymentId));
    if (!dep) { res.status(404).json({ error: "Not found" }); return; }
    res.json(dep);
  }),
);

router.get(
  "/deployments/:deploymentId/logs",
  asyncHandler(async (req, res) => {
    const lines = await deployAdapter.getDeploymentLogs(String(req.params.deploymentId));
    res.json({ lines, diagnosis: diagnoseFailure(lines) });
  }),
);

router.post(
  "/projects/:projectId/rollback",
  asyncHandler(async (req, res) => {
    const { targetDeploymentId, confirmed } = req.body as { targetDeploymentId?: string; confirmed?: boolean };
    if (!targetDeploymentId) {
      res.status(400).json({ error: "targetDeploymentId is required" });
      return;
    }
    if (confirmed !== true) {
      res.status(400).json({ error: "Rollback requires confirmed=true" });
      return;
    }
    const dep = await deployAdapter.rollback({
      projectId: String(req.params.projectId),
      targetDeploymentId,
    });
    res.status(202).json(dep);
  }),
);

router.post(
  "/projects/:projectId/addons/postgres",
  asyncHandler(async (req, res) => {
    if (req.body?.confirmed !== true) {
      res.status(400).json({ error: "Provisioning a paid database requires confirmed=true" });
      return;
    }
    res.status(201).json(await deployAdapter.createPostgresAddon(String(req.params.projectId)));
  }),
);

router.post(
  "/projects/:projectId/addons/redis",
  asyncHandler(async (req, res) => {
    if (req.body?.confirmed !== true) {
      res.status(400).json({ error: "Provisioning a paid Redis service requires confirmed=true" });
      return;
    }
    res.status(201).json(await deployAdapter.createRedisAddon(String(req.params.projectId)));
  }),
);

router.get(
  "/projects/:projectId/addons",
  asyncHandler(async (req, res) => {
    res.json(await deployAdapter.listAddons(String(req.params.projectId)));
  }),
);

router.delete(
  "/addons/:addonId",
  asyncHandler(async (req, res) => {
    const { confirmed } = req.body as { confirmed?: boolean };
    await deployAdapter.deleteAddon(String(req.params.addonId), confirmed === true);
    res.json({ ok: true });
  }),
);

router.get(
  "/projects/:projectId/env",
  asyncHandler(async (req, res) => {
    res.json(await deployAdapter.listEnvVars(String(req.params.projectId)));
  }),
);

router.post(
  "/projects/:projectId/env",
  asyncHandler(async (req, res) => {
    const { key, value } = req.body as { key?: string; value?: string };
    if (!key?.trim() || value === undefined) {
      res.status(400).json({ error: "key and value are required" });
      return;
    }
    const variable = await deployAdapter.setEnvVar({
      projectId: String(req.params.projectId),
      key: key.trim(),
      value,
    });
    res.status(201).json(variable);
  }),
);

router.patch(
  "/projects/:projectId/env/:envId",
  asyncHandler(async (req, res) => {
    const { key, value } = req.body as { key?: string; value?: string };
    if (!key?.trim() || value === undefined) {
      res.status(400).json({ error: "key and value are required" });
      return;
    }
    const variable = await deployAdapter.setEnvVar({
      projectId: String(req.params.projectId),
      key: key.trim(),
      value,
    });
    res.json(variable);
  }),
);

router.delete(
  "/projects/:projectId/env/:envId",
  asyncHandler(async (req, res) => {
    await deployAdapter.deleteEnvVar(String(req.params.envId));
    res.json({ ok: true });
  }),
);

router.post(
  "/projects/:projectId/domains",
  asyncHandler(async (req, res) => {
    const { domain } = req.body as { domain?: string };
    if (!domain?.trim()) {
      res.status(400).json({ error: "domain is required" });
      return;
    }
    const created = await deployAdapter.createDomain({
      projectId: String(req.params.projectId),
      domain: domain.trim().toLowerCase(),
    });
    const instructions = generateDnsVerificationInstructions(created.domain, created.verificationToken!);
    res.status(201).json({ ...created, verificationInstructions: instructions });
  }),
);

router.get(
  "/projects/:projectId/domains",
  asyncHandler(async (req, res) => {
    res.json(await deployAdapter.listDomains(String(req.params.projectId)));
  }),
);

router.post(
  "/domains/:domainId/verify",
  asyncHandler(async (req, res) => {
    res.json(await deployAdapter.verifyDomain(String(req.params.domainId)));
  }),
);

export { router as deployRoutes };
