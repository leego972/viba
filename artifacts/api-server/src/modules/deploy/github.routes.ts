import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { db, githubInstallations, githubRepositories, projectGithubConnections } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import {
  buildInstallUrl,
  exchangeCodeForToken,
  listInstallations,
  listInstallationRepos,
  verifyWebhookSignature,
  parsePushWebhook,
  extractBranchFromRef,
  isGitHubAppConfigured,
} from "./github.adapter";
import { createDeployment, runDeploymentPipeline } from "./deploy.service";
import { logger } from "../../lib/logger";
import { isAdminUserId } from "../../lib/adminAccess";

const router = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function assertAdminSession(req: Request, res: Response): Promise<boolean> {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }

  try {
    if (!(await isAdminUserId(userId))) {
      res.status(403).json({ error: "Administrator access required" });
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, userId }, "GitHub deploy admin-session check failed");
    res.status(503).json({ error: "Administrator access could not be verified" });
    return false;
  }
}

router.get(
  "/install",
  asyncHandler(async (req, res) => {
    if (!(await assertAdminSession(req, res))) return;

    if (!isGitHubAppConfigured()) {
      res.status(503).json({ error: "GitHub App not configured. Set GITHUB_APP_* env vars." });
      return;
    }

    const state = crypto.randomBytes(32).toString("hex");
    req.session.githubDeployOauthState = state;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });
    res.redirect(buildInstallUrl(state));
  }),
);

router.get(
  "/callback",
  asyncHandler(async (req, res) => {
    if (!(await assertAdminSession(req, res))) return;

    const { code, installation_id, state } = req.query as Record<string, string>;
    const expectedState = req.session.githubDeployOauthState;

    if (!code) {
      res.status(400).json({ error: "Missing code parameter" });
      return;
    }
    if (!state || !expectedState || !timingSafeEqual(state, expectedState)) {
      res.status(403).json({ error: "Invalid or expired GitHub installation state" });
      return;
    }

    delete req.session.githubDeployOauthState;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });

    const { accessToken } = await exchangeCodeForToken(code);
    const installations = await listInstallations(accessToken);

    for (const inst of installations) {
      const existing = await db
        .select()
        .from(githubInstallations)
        .where(eq(githubInstallations.installationId, inst.installationId))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(githubInstallations).values({
          id: inst.id,
          installationId: inst.installationId,
          accountLogin: inst.accountLogin,
          accountType: inst.accountType,
          targetType: inst.targetType,
        });
        logger.info({ installationId: inst.installationId }, "GitHub installation saved");
      }

      const repos = await listInstallationRepos(inst.installationId);
      for (const repo of repos) {
        const existingRepo = await db
          .select()
          .from(githubRepositories)
          .where(eq(githubRepositories.fullName, repo.fullName))
          .limit(1);
        if (existingRepo.length === 0) {
          await db.insert(githubRepositories).values({
            id: repo.id,
            installationId: String(inst.installationId),
            owner: repo.owner,
            name: repo.name,
            fullName: repo.fullName,
            defaultBranch: repo.defaultBranch,
            private: repo.private,
            htmlUrl: repo.htmlUrl,
          });
        }
      }
    }

    const publicUrl = (process.env.PUBLIC_VIBA_DEPLOY_URL ?? process.env.PUBLIC_ORIGIN ?? "").replace(/\/$/, "");
    const destination = `${publicUrl}/deploy?github_connected=1&installation_id=${encodeURIComponent(installation_id ?? "")}`;
    res.redirect(destination);
  }),
);

/**
 * Webhooks remain publicly reachable, but every payload must pass GitHub's
 * HMAC signature verification before any data is read or changed.
 */
router.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const event = req.headers["x-github-event"] as string | undefined;
    const rawBody: Buffer = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));

    if (!signature) {
      res.status(401).json({ error: "Missing signature" });
      return;
    }

    if (!verifyWebhookSignature(rawBody, signature)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    if (event === "ping") {
      res.json({ ok: true, message: "pong" });
      return;
    }

    if (event === "installation" || event === "installation_repositories") {
      const body = req.body as {
        action: string;
        installation: { id: number; account: { login: string; type: string }; target_type: string };
        repositories_added?: Array<{ id: number; full_name: string; name: string; private: boolean; default_branch?: string }>;
        repositories_removed?: Array<{ id: number; full_name: string }>;
      };

      if (body.action === "created" || body.action === "added") {
        const inst = body.installation;
        const existingInst = await db
          .select()
          .from(githubInstallations)
          .where(eq(githubInstallations.installationId, inst.id))
          .limit(1);

        if (existingInst.length === 0) {
          await db.insert(githubInstallations).values({
            id: String(inst.id),
            installationId: inst.id,
            accountLogin: inst.account.login,
            accountType: inst.account.type,
            targetType: inst.target_type ?? "Organization",
          });
        }

        for (const repo of body.repositories_added ?? []) {
          const [owner, name] = repo.full_name.split("/");
          const existing = await db
            .select()
            .from(githubRepositories)
            .where(eq(githubRepositories.fullName, repo.full_name))
            .limit(1);
          if (existing.length === 0) {
            await db.insert(githubRepositories).values({
              id: String(repo.id),
              installationId: String(inst.id),
              owner: owner ?? "",
              name: name ?? repo.name,
              fullName: repo.full_name,
              defaultBranch: repo.default_branch ?? "main",
              private: repo.private,
              htmlUrl: `https://github.com/${repo.full_name}`,
            });
          }
        }
      }

      if (body.action === "deleted" || body.action === "removed") {
        for (const repo of body.repositories_removed ?? []) {
          await db.delete(githubRepositories).where(eq(githubRepositories.fullName, repo.full_name));
        }
        if (body.action === "deleted") {
          await db.delete(githubInstallations).where(
            eq(githubInstallations.installationId, body.installation.id),
          );
        }
      }

      res.json({ ok: true });
      return;
    }

    if (event === "push") {
      const payload = parsePushWebhook(req.body);
      if (!payload) {
        res.status(400).json({ error: "Invalid push payload" });
        return;
      }

      const pushedBranch = extractBranchFromRef(payload.ref);
      const repoFullName = payload.repository.full_name;
      const commitSha = payload.after;

      const repoRows = await db
        .select()
        .from(githubRepositories)
        .where(eq(githubRepositories.fullName, repoFullName))
        .limit(1);

      if (repoRows.length === 0) {
        logger.warn({ repoFullName }, "Push webhook: repo not registered, ignoring");
        res.json({ ok: true, ignored: "repo not registered" });
        return;
      }

      const connections = await db
        .select()
        .from(projectGithubConnections)
        .where(eq(projectGithubConnections.repositoryId, repoRows[0].id));

      if (connections.length === 0) {
        res.json({ ok: true, ignored: "no connected project" });
        return;
      }

      const triggered: string[] = [];

      for (const conn of connections) {
        if (!conn.autoDeployEnabled) continue;
        if (conn.deployBranch !== pushedBranch) {
          logger.info(
            { branch: pushedBranch, expected: conn.deployBranch },
            "Push to wrong branch, skipping",
          );
          continue;
        }

        const dep = await createDeployment({
          projectId: conn.projectId,
          triggerType: "GITHUB_PUSH",
          commitSha,
          commitMessage: payload.head_commit?.message ?? "",
          commitAuthor: payload.head_commit?.author?.name ?? "",
        });

        void runDeploymentPipeline(dep.id);
        triggered.push(dep.id);
        logger.info({ deploymentId: dep.id, projectId: conn.projectId }, "Auto-deploy triggered");
      }

      res.json({ ok: true, triggered });
      return;
    }

    res.status(204).send();
  }),
);

router.get(
  "/installations",
  asyncHandler(async (req, res) => {
    if (!(await assertAdminSession(req, res))) return;
    const rows = await db.select().from(githubInstallations);
    res.json(rows);
  }),
);

router.get(
  "/repos",
  asyncHandler(async (req, res) => {
    if (!(await assertAdminSession(req, res))) return;

    const { installationId } = req.query as { installationId?: string };
    if (installationId) {
      const parsedInstallationId = Number.parseInt(installationId, 10);
      if (!Number.isFinite(parsedInstallationId) || parsedInstallationId <= 0) {
        res.status(400).json({ error: "Invalid installationId" });
        return;
      }
      const repos = await listInstallationRepos(parsedInstallationId);
      res.json(repos);
    } else {
      const rows = await db.select().from(githubRepositories);
      res.json(rows);
    }
  }),
);

export { router as githubDeployRoutes };
