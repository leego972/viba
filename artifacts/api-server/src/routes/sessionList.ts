import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

type SessionListRow = {
  id: number;
  userId: number | null;
  goal: string;
  status: string;
  autonomyMode: string;
  mode: string;
  estimatedCost: number | null;
  budgetCapCredits: number | null;
  creditsReserved: number;
  finalOutput: string | null;
  repoUrl: string | null;
  repoBranch: string | null;
  workspaceEnv: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type AgentModeRow = {
  sessionId: number;
  name: string;
  provider: string;
  isMock: boolean;
};

function intQuery(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// GET /sessions — owner-scoped replacement for the legacy list handler.
// Bypass sessions keep the old all-session visibility for the controlled embed;
// authenticated users see only sessions with their own user_id.
router.get("/sessions", async (req, res): Promise<void> => {
  const limit = Math.min(Math.max(intQuery(req.query["limit"], 100), 1), 500);
  const offset = Math.max(intQuery(req.query["offset"], 0), 0);
  const bypass = req.session?.bypass === true;
  const userId = req.session?.userId;

  if (!bypass && typeof userId !== "number") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const sessionSql = `
    SELECT
      id,
      user_id AS "userId",
      goal,
      status,
      autonomy_mode AS "autonomyMode",
      mode,
      estimated_cost AS "estimatedCost",
      budget_cap_credits AS "budgetCapCredits",
      credits_reserved AS "creditsReserved",
      final_output AS "finalOutput",
      repo_url AS "repoUrl",
      repo_branch AS "repoBranch",
      workspace_env AS "workspaceEnv",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM sessions
    ${bypass ? "" : "WHERE user_id = $1"}
    ORDER BY id ASC
    LIMIT ${bypass ? "$1" : "$2"}
    OFFSET ${bypass ? "$2" : "$3"}
  `;

  const params = bypass ? [limit, offset] : [userId, limit, offset];
  const { rows: sessions } = await pool.query<SessionListRow>(sessionSql, params);

  if (sessions.length === 0) {
    res.json([]);
    return;
  }

  const sessionIds = sessions.map((s) => s.id);
  const { rows: agents } = await pool.query<AgentModeRow>(
    `SELECT session_id AS "sessionId", name, provider, is_mock AS "isMock"
       FROM agents
      WHERE session_id = ANY($1::int[])`,
    [sessionIds],
  );

  const agentsBySession = new Map<number, AgentModeRow[]>();
  for (const agent of agents) {
    const list = agentsBySession.get(agent.sessionId) ?? [];
    list.push(agent);
    agentsBySession.set(agent.sessionId, list);
  }

  res.json(sessions.map((session) => ({
    ...session,
    agentModes: (agentsBySession.get(session.id) ?? []).map((agent) => ({
      name: agent.name,
      provider: agent.provider,
      isMock: agent.isMock,
    })),
  })));
});

export default router;
