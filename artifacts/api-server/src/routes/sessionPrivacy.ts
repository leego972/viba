import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

function parseSessionId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function isTestBypass(): boolean {
  return process.env.NODE_ENV === "test" && process.env.TEST_BYPASS_SESSION === "1";
}

function mapSession(row: Record<string, unknown>, agentModes: Array<{ name: string; provider: string; isMock: boolean }>) {
  return {
    id: row["id"],
    userId: row["user_id"],
    goal: row["goal"],
    status: row["status"],
    autonomyMode: row["autonomy_mode"],
    mode: row["mode"],
    estimatedCost: row["estimated_cost"],
    budgetCapCredits: row["budget_cap_credits"],
    creditsReserved: row["credits_reserved"],
    finalOutput: row["final_output"],
    repoUrl: row["repo_url"],
    repoBranch: row["repo_branch"],
    workspaceEnv: row["workspace_env"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
    agentModes,
  };
}

// Secure list endpoint. This is mounted before routes/sessions.ts, so it prevents
// the older list route from returning legacy unowned sessions to normal users.
router.get("/sessions", async (req, res, next): Promise<void> => {
  if (isTestBypass()) {
    next();
    return;
  }

  const userId = req.session?.userId;
  const bypass = req.session?.bypass === true;

  if (!userId && !bypass) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const rawLimit = parseInt(String(req.query.limit ?? "100"), 10);
  const rawOffset = parseInt(String(req.query.offset ?? "0"), 10);
  const limit = Math.min(Number.isNaN(rawLimit) ? 100 : Math.max(1, rawLimit), 500);
  const offset = Number.isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);

  try {
    const sessionQuery = userId
      ? {
          text: `SELECT * FROM sessions WHERE user_id = $1 ORDER BY id ASC LIMIT $2 OFFSET $3`,
          values: [userId, limit, offset],
        }
      : {
          // Bypass/embed sessions are allowed to see only unowned/legacy bypass sessions,
          // never authenticated user-owned sessions.
          text: `SELECT * FROM sessions WHERE user_id IS NULL OR user_id = 0 ORDER BY id ASC LIMIT $1 OFFSET $2`,
          values: [limit, offset],
        };

    const { rows: sessions } = await pool.query<Record<string, unknown>>(sessionQuery.text, sessionQuery.values);
    const sessionIds = sessions.map((s) => Number(s["id"])).filter((id) => Number.isFinite(id));

    let agentsBySession = new Map<number, Array<{ name: string; provider: string; isMock: boolean }>>();
    if (sessionIds.length > 0) {
      const { rows: agents } = await pool.query<{
        session_id: number;
        name: string;
        provider: string;
        is_mock: boolean;
      }>(
        `SELECT session_id, name, provider, is_mock FROM agents WHERE session_id = ANY($1::int[])`,
        [sessionIds],
      );

      agentsBySession = agents.reduce((acc, agent) => {
        const existing = acc.get(agent.session_id) ?? [];
        existing.push({ name: agent.name, provider: agent.provider, isMock: agent.is_mock });
        acc.set(agent.session_id, existing);
        return acc;
      }, new Map<number, Array<{ name: string; provider: string; isMock: boolean }>>());
    }

    res.json(sessions.map((session) => mapSession(session, agentsBySession.get(Number(session["id"])) ?? [])));
  } catch (err) {
    req.log?.error?.({ err }, "secure session list error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Object-level authorization guard for every /api/sessions/:id route.
// Normal users may access only their own sessions. Bypass/embed sessions may
// access only legacy unowned sessions, never another user's owned session.
router.use("/sessions/:id", async (req, res, next): Promise<void> => {
  if (isTestBypass()) {
    next();
    return;
  }

  const sessionId = parseSessionId(req.params.id);
  if (!sessionId) {
    res.status(400).json({ error: "valid session id required" });
    return;
  }

  const userId = req.session?.userId;
  const bypass = req.session?.bypass === true;
  if (!userId && !bypass) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { rows } = await pool.query<{ user_id: number | null }>(
    `SELECT user_id FROM sessions WHERE id = $1 LIMIT 1`,
    [sessionId],
  );

  const owner = rows[0];
  if (!owner) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (typeof userId === "number" && owner.user_id === userId) {
    next();
    return;
  }

  if (typeof userId === "number" && owner.user_id === null && process.env.VIBA_ALLOW_LEGACY_UNOWNED_SESSIONS === "true") {
    await pool.query(`UPDATE sessions SET user_id = $1 WHERE id = $2 AND user_id IS NULL`, [userId, sessionId]);
    next();
    return;
  }

  if (bypass && (owner.user_id === null || owner.user_id === 0)) {
    next();
    return;
  }

  res.status(403).json({ error: "Forbidden: this session belongs to another user." });
});

export default router;
