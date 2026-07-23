import { Router, type Request } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  vibaDeployProjects,
  vibaDeployments,
  vibaDeployAddons,
  vibaDeployDomains,
  vibaDeployEnvVars,
} from "@workspace/db";

const router = Router();

function ownerId(req: Request): string | null {
  return typeof req.session?.userId === "number" && req.session.userId > 0
    ? String(req.session.userId)
    : null;
}

function setLegacyUser(req: Request, id: string): void {
  (req as Request & { user?: { id: string } }).user = { id };
}

async function ownsProject(projectId: string, owner: string): Promise<boolean> {
  const [project] = await db
    .select({ id: vibaDeployProjects.id })
    .from(vibaDeployProjects)
    .where(and(eq(vibaDeployProjects.id, projectId), eq(vibaDeployProjects.ownerId, owner)))
    .limit(1);
  return Boolean(project);
}

async function ownsDeployment(deploymentId: string, owner: string): Promise<boolean> {
  const [row] = await db
    .select({ id: vibaDeployments.id })
    .from(vibaDeployments)
    .innerJoin(vibaDeployProjects, eq(vibaDeployProjects.id, vibaDeployments.projectId))
    .where(and(eq(vibaDeployments.id, deploymentId), eq(vibaDeployProjects.ownerId, owner)))
    .limit(1);
  return Boolean(row);
}

async function ownsAddon(addonId: string, owner: string): Promise<boolean> {
  const [row] = await db
    .select({ id: vibaDeployAddons.id })
    .from(vibaDeployAddons)
    .innerJoin(vibaDeployProjects, eq(vibaDeployProjects.id, vibaDeployAddons.projectId))
    .where(and(eq(vibaDeployAddons.id, addonId), eq(vibaDeployProjects.ownerId, owner)))
    .limit(1);
  return Boolean(row);
}

async function ownsDomain(domainId: string, owner: string): Promise<boolean> {
  const [row] = await db
    .select({ id: vibaDeployDomains.id })
    .from(vibaDeployDomains)
    .innerJoin(vibaDeployProjects, eq(vibaDeployProjects.id, vibaDeployDomains.projectId))
    .where(and(eq(vibaDeployDomains.id, domainId), eq(vibaDeployProjects.ownerId, owner)))
    .limit(1);
  return Boolean(row);
}

async function ownsEnvVar(envId: string, projectId: string, owner: string): Promise<boolean> {
  const [row] = await db
    .select({ id: vibaDeployEnvVars.id })
    .from(vibaDeployEnvVars)
    .innerJoin(vibaDeployProjects, eq(vibaDeployProjects.id, vibaDeployEnvVars.projectId))
    .where(and(
      eq(vibaDeployEnvVars.id, envId),
      eq(vibaDeployEnvVars.projectId, projectId),
      eq(vibaDeployProjects.ownerId, owner),
    ))
    .limit(1);
  return Boolean(row);
}

router.use((req, res, next): void => {
  const owner = ownerId(req);
  if (!owner) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  setLegacyUser(req, owner);
  next();
});

router.post("/projects/:projectId/connect-github", (req, res, next): void => {
  if (req.body?.autoDeployEnabled === true) {
    res.status(422).json({
      error: "autonomous_deploy_disabled",
      message: "Push-triggered deployments are disabled. A signed-in user must start each deployment manually.",
    });
    return;
  }
  if (req.body && typeof req.body === "object") req.body.autoDeployEnabled = false;
  next();
});

router.use("/projects/:projectId/env/:envId", async (req, res, next): Promise<void> => {
  try {
    const owner = ownerId(req)!;
    const projectId = String(req.params.projectId);
    const envId = String(req.params.envId);
    if (!(await ownsProject(projectId, owner)) || !(await ownsEnvVar(envId, projectId, owner))) {
      res.status(404).json({ error: "Environment variable not found" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
});

router.use("/projects/:projectId", async (req, res, next): Promise<void> => {
  try {
    if (!(await ownsProject(String(req.params.projectId), ownerId(req)!))) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
});

router.use("/deployments/:deploymentId", async (req, res, next): Promise<void> => {
  try {
    if (!(await ownsDeployment(String(req.params.deploymentId), ownerId(req)!))) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
});

router.use("/addons/:addonId", async (req, res, next): Promise<void> => {
  try {
    if (!(await ownsAddon(String(req.params.addonId), ownerId(req)!))) {
      res.status(404).json({ error: "Add-on not found" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
});

router.use("/domains/:domainId", async (req, res, next): Promise<void> => {
  try {
    if (!(await ownsDomain(String(req.params.domainId), ownerId(req)!))) {
      res.status(404).json({ error: "Domain not found" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
});

export default router;
