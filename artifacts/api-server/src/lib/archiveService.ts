/**
 * Archive Service — GitHub-backed user data archive
 *
 * Free storage via private GitHub repo (leego972/viba-user-archives).
 * On account deletion:
 *   1. Export all user data to JSON
 *   2. Push to GitHub (private repo, one file per user)
 *   3. After 6 months → delete from GitHub + hard-delete from DB
 *
 * Token: VIBA_ARCHIVE_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN
 * Repo:  VIBA_ARCHIVE_REPO (default: leego972/viba-user-archives)
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

const ARCHIVE_REPO =
  process.env["VIBA_ARCHIVE_REPO"] ?? "leego972/viba-user-archives";
const ARCHIVE_TOKEN =
  process.env["VIBA_ARCHIVE_GITHUB_TOKEN"] ??
  process.env["GH_TOKEN"] ??
  process.env["GITHUB_TOKEN"];

// ─── Data export ──────────────────────────────────────────────────────────────

export async function exportUserData(userId: number): Promise<Record<string, unknown>> {
  const { rows: userRows } = await pool.query(
    `SELECT id, email, name, created_at FROM users WHERE id = $1`,
    [userId],
  );
  const user = userRows[0] as
    | { id: number; email: string; name: string | null; created_at: Date }
    | undefined;
  if (!user) throw new Error(`User ${userId} not found`);

  const { rows: sessionRows } = await pool.query(
    `SELECT id, goal, status, mode, created_at FROM sessions WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );

  const sessions = [];
  for (const s of sessionRows as { id: number; goal: string; status: string; mode: string; created_at: Date }[]) {
    const [agentRes, taskRes, msgRes] = await Promise.all([
      pool.query(`SELECT name, provider, role FROM agents WHERE session_id = $1`, [s.id]),
      pool.query(`SELECT title, description, type, status FROM tasks WHERE session_id = $1`, [s.id]),
      pool.query(
        `SELECT role, agent_name, content, created_at FROM messages WHERE session_id = $1 ORDER BY created_at`,
        [s.id],
      ),
    ]);
    sessions.push({
      id: s.id,
      goal: s.goal,
      status: s.status,
      mode: s.mode,
      createdAt: (s.created_at as Date).toISOString(),
      agents: agentRes.rows,
      tasks: taskRes.rows,
      messages: (msgRes.rows as { role: string; agent_name: string | null; content: string; created_at: Date }[]).map(
        (m) => ({
          role: m.role,
          agentName: m.agent_name,
          content: m.content,
          createdAt: (m.created_at as Date).toISOString(),
        }),
      ),
    });
  }

  const { rows: txRows } = await pool.query(
    `SELECT amount, balance_after, reason, created_at FROM credit_transactions WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );

  return {
    exportedAt: new Date().toISOString(),
    userId: user.id,
    email: user.email,
    name: user.name,
    accountCreatedAt: user.created_at.toISOString(),
    sessions,
    creditTransactions: (txRows as { amount: number; balance_after: number; reason: string; created_at: Date }[]).map(
      (t) => ({
        amount: t.amount,
        balanceAfter: t.balance_after,
        reason: t.reason,
        createdAt: (t.created_at as Date).toISOString(),
      }),
    ),
  };
}

// ─── GitHub push ──────────────────────────────────────────────────────────────

export async function archiveUserToGitHub(userId: number): Promise<{
  archiveRepo: string;
  archivePath: string;
  archiveCommitSha: string;
} | null> {
  if (!ARCHIVE_TOKEN) {
    logger.warn({ userId }, "Archive: no GitHub token configured — skipping GitHub archive");
    return null;
  }

  const data = await exportUserData(userId);
  const timestamp = (data["exportedAt"] as string).replace(/[:.]/g, "-");
  const filePath = `archives/user-${userId}/${timestamp}.json`;
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");

  const [owner, repo] = ARCHIVE_REPO.split("/");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${ARCHIVE_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "VIBA-Archive-Service/1.0",
    },
    body: JSON.stringify({
      message: `Archive user ${userId} data — ${data["exportedAt"] as string}`,
      content,
      committer: { name: "VIBA Archive Bot", email: "archive@viba.guru" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error({ userId, status: response.status, errText }, "Archive: GitHub push failed");
    return null;
  }

  const result = (await response.json()) as { commit: { sha: string } };
  logger.info({ userId, filePath, sha: result.commit.sha }, "Archive: user data pushed to GitHub");

  return {
    archiveRepo: ARCHIVE_REPO,
    archivePath: filePath,
    archiveCommitSha: result.commit.sha,
  };
}

// ─── GitHub delete ────────────────────────────────────────────────────────────

async function deleteGitHubArchive(archiveRepo: string, archivePath: string): Promise<void> {
  if (!ARCHIVE_TOKEN) return;

  const [owner, repo] = archiveRepo.split("/");
  const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${archivePath}`;
  const getRes = await fetch(getUrl, {
    headers: {
      Authorization: `Bearer ${ARCHIVE_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "VIBA-Archive-Service/1.0",
    },
  });

  if (!getRes.ok) {
    logger.warn({ archivePath, status: getRes.status }, "Archive: file not found — already purged?");
    return;
  }

  const file = (await getRes.json()) as { sha: string };
  const delRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${archivePath}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${ARCHIVE_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "VIBA-Archive-Service/1.0",
    },
    body: JSON.stringify({
      message: `Purge archive user — 6-month retention expired`,
      sha: file.sha,
      committer: { name: "VIBA Archive Bot", email: "archive@viba.guru" },
    }),
  });

  if (delRes.ok) {
    logger.info({ archivePath }, "Archive: GitHub file deleted");
  } else {
    logger.warn({ archivePath, status: delRes.status }, "Archive: GitHub delete failed");
  }
}

// ─── Hard delete from DB ─────────────────────────────────────────────────────

async function hardDeleteUserData(userId: number): Promise<void> {
  await pool.query(
    `DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)`,
    [userId],
  );
  await pool.query(
    `DELETE FROM tasks WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)`,
    [userId],
  );
  await pool.query(
    `DELETE FROM agents WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)`,
    [userId],
  );
  await pool.query(
    `DELETE FROM approvals WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)`,
    [userId],
  );
  await pool.query(
    `DELETE FROM audit_logs WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)`,
    [userId],
  ).catch(() => {}); // audit_logs may not have session_id FK in all envs
  await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM credit_transactions WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM account_deletion_requests WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  logger.info({ userId }, "Archive: user data hard-deleted from DB");
}

// ─── Retention cleaner ────────────────────────────────────────────────────────

/**
 * Runs on server start and every 24h.
 * Finds accounts past their 6-month retention window and purges them completely.
 */
export async function runRetentionCleaner(): Promise<void> {
  try {
    const { rows } = await pool.query<{
      id: number;
      user_id: number;
      archive_repo: string | null;
      archive_path: string | null;
    }>(
      `SELECT id, user_id, archive_repo, archive_path
       FROM account_deletion_requests
       WHERE delete_after < NOW() AND deleted_at IS NULL AND status != 'failed'`,
    );

    for (const row of rows) {
      try {
        if (row.archive_repo && row.archive_path) {
          await deleteGitHubArchive(row.archive_repo, row.archive_path);
        }
        await hardDeleteUserData(row.user_id);
        await pool.query(
          `UPDATE account_deletion_requests SET deleted_at = NOW(), status = 'deleted', updated_at = NOW() WHERE id = $1`,
          [row.id],
        );
        logger.info({ userId: row.user_id }, "Retention cleaner: account fully purged");
      } catch (err) {
        logger.error({ err, userId: row.user_id }, "Retention cleaner: failed to purge account");
        await pool.query(
          `UPDATE account_deletion_requests SET status = 'failed', updated_at = NOW() WHERE id = $1`,
          [row.id],
        ).catch(() => {});
      }
    }

    if (rows.length > 0) {
      logger.info({ count: rows.length }, "Retention cleaner: processed deletion requests");
    }
  } catch (err) {
    logger.error({ err }, "Retention cleaner: query failed — table may not exist yet");
  }
}
