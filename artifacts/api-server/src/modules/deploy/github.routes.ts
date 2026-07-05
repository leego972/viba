import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { db, githubInstallations, githubRepositories, projectGithubConnections, vibaDeployProjects } from "@workspace/db";
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

const router = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

router.get(
  "/install",
  (req, res) => {
    if (!isGitHubAppConfigured()) {
      res.status(503).json({ error: "GitHub App not configured. Set GITHUB_APP_* env vars." });
      return;
    }
    res.redirect(buildInstallUrl());
  },
);

router.get(
  "/callback",
  asyncHandler(async (req, res) => {
    const { code, installation_id, setup_action } = req.query as Record<string, string>;

    if (!code) {
      res.status(400).json({ error: "Missing code parameter" });
      return;
    }

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

    const publicUrl = process.env.PUBLIC_VIBA_DEPLOY_URL ?? "";
    res.redirect(`${publicUrl}/deploy?github_connected=1&installation_id=${installation_id ?? ""}`);
  }),
);

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

    const valid = verifyWebhookSignature(rawBody, signature);
    if (!valid) {
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
      const installationId = payload.installation?.id;

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
    const rows = await db.select().from(githubInstallations);
    res.json(rows);
  }),
);

router.get(
  "/repos",
  asyncHandler(async (req, res) => {
    const { installationId } = req.query as { installationId?: string };
    if (installationId) {
      const repos = await listInstallationRepos(parseInt(installationId, 10));
      res.json(repos);
    } else {
      const rows = await db.select().from(githubRepositories);
      res.json(rows);
    }
  }),
);

export { router as githubDeployRoutes };
