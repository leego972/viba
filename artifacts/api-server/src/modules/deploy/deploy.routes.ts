import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { deployAdapter } from "./deploy.adapter";
import { diagnoseFailure } from "./diagnosis.service";
import { generateDnsVerificationInstructions } from "./caddy.adapter";

const router = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function ownerId(req: Request): string {
  return (req as unknown as { user?: { id?: string } }).user?.id ?? "anonymous";
}

router.post(
  "/projects",
  asyncHandler(async (req, res) => {
    const { name } = req.body as { name: string };
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const project = await deployAdapter.createProject({ name: name.trim(), ownerId: ownerId(req) });
    res.status(201).json(project);
  }),
);

router.get(
  "/projects",
  asyncHandler(async (req, res) => {
    const projects = await deployAdapter.listProjects(ownerId(req));
    res.json(projects);
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
    const { installationId, repositoryId, deployBranch, autoDeployEnabled } =
      req.body as {
        installationId: string;
        repositoryId: string;
        deployBranch?: string;
        autoDeployEnabled?: boolean;
      };
    await deployAdapter.connectRepository({
      projectId: String(req.params.projectId),
      installationId,
      repositoryId,
      deployBranch: deployBranch ?? "main",
      autoDeployEnabled: autoDeployEnabled ?? true,
    });
    res.json({ ok: true });
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
    const deps = await deployAdapter.listDeployments(String(req.params.projectId));
    res.json(deps);
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
    const diagnosis = diagnoseFailure(lines);
    res.json({ lines, diagnosis });
  }),
);

router.post(
  "/projects/:projectId/rollback",
  asyncHandler(async (req, res) => {
    const { targetDeploymentId } = req.body as { targetDeploymentId: string };
    if (!targetDeploymentId) {
      res.status(400).json({ error: "targetDeploymentId is required" });
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
    const addon = await deployAdapter.createPostgresAddon(String(req.params.projectId));
    res.status(201).json(addon);
  }),
);

router.post(
  "/projects/:projectId/addons/redis",
  asyncHandler(async (req, res) => {
    const addon = await deployAdapter.createRedisAddon(String(req.params.projectId));
    res.status(201).json(addon);
  }),
);

router.get(
  "/projects/:projectId/addons",
  asyncHandler(async (req, res) => {
    const addons = await deployAdapter.listAddons(String(req.params.projectId));
    res.json(addons);
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
    const vars = await deployAdapter.listEnvVars(String(req.params.projectId));
    res.json(vars);
  }),
);

router.post(
  "/projects/:projectId/env",
  asyncHandler(async (req, res) => {
    const { key, value } = req.body as { key: string; value: string };
    if (!key || value === undefined) {
      res.status(400).json({ error: "key and value are required" });
      return;
    }
    const v = await deployAdapter.setEnvVar({
      projectId: String(req.params.projectId),
      key,
      value,
    });
    res.status(201).json(v);
  }),
);

router.patch(
  "/projects/:projectId/env/:envId",
  asyncHandler(async (req, res) => {
    const { key, value } = req.body as { key: string; value: string };
    const v = await deployAdapter.setEnvVar({
      projectId: String(req.params.projectId),
      key,
      value,
    });
    res.json(v);
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
    const { domain } = req.body as { domain: string };
    if (!domain?.trim()) {
      res.status(400).json({ error: "domain is required" });
      return;
    }
    const d = await deployAdapter.createDomain({
      projectId: String(req.params.projectId),
      domain: domain.trim(),
    });
    const instructions = generateDnsVerificationInstructions(d.domain, d.verificationToken!);
    res.status(201).json({ ...d, verificationInstructions: instructions });
  }),
);

router.get(
  "/projects/:projectId/domains",
  asyncHandler(async (req, res) => {
    const domains = await deployAdapter.listDomains(String(req.params.projectId));
    res.json(domains);
  }),
);

router.post(
  "/domains/:domainId/verify",
  asyncHandler(async (req, res) => {
    const result = await deployAdapter.verifyDomain(String(req.params.domainId));
    res.json(result);
  }),
);

export { router as deployRoutes };
