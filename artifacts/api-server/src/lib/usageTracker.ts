import { pool } from "@workspace/db";
import { logger } from "./logger";

export interface UsageEventInput {
  userId: number;
  sessionId?: number;
  projectId?: string;
  taskType: string;
  executionMethod: string;
  provider?: string;
  model?: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  reportedCostUsd?: number;
  estimatedCostWithoutOptimisation: number;
  estimatedSavingsUsd: number;
  savingsReasons: string[];
  durationMs?: number;
  success: boolean;
  cacheHit: boolean;
  qualityMode: string;
  tokensAvoided: number;
  metadata?: Record<string, unknown>;
}

export interface MonthlySummary {
  totalTasks: number;
  tasksWithoutPremium: number;
  cacheHits: number;
  localToolExecutions: number;
  ruleEngineExecutions: number;
  economyModelExecutions: number;
  premiumModelExecutions: number;
  estimatedSpendUsd: number;
  estimatedSpendWithoutOptimisationUsd: number;
  estimatedSavingsUsd: number;
  tokensAvoided: number;
  duplicateTasksPrevented: number;
  percentageSaved: number;
}

export async function ensureUsageTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_usage_events (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      session_id INTEGER,
      project_id TEXT,
      task_type TEXT NOT NULL DEFAULT 'general',
      execution_method TEXT NOT NULL DEFAULT 'premium_model',
      provider TEXT,
      model TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      reported_cost_usd REAL,
      estimated_cost_without_optimisation REAL NOT NULL DEFAULT 0,
      estimated_savings_usd REAL NOT NULL DEFAULT 0,
      savings_reasons TEXT[] NOT NULL DEFAULT '{}',
      duration_ms INTEGER,
      success BOOLEAN NOT NULL DEFAULT true,
      cache_hit BOOLEAN NOT NULL DEFAULT false,
      quality_mode TEXT NOT NULL DEFAULT 'balanced',
      tokens_avoided INTEGER NOT NULL DEFAULT 0,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage_events (user_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON ai_usage_events (provider, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_optimisation_decisions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      usage_event_id INTEGER,
      task_type TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      execution_method TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      estimated_cost_without_viba REAL NOT NULL DEFAULT 0,
      estimated_savings REAL NOT NULL DEFAULT 0,
      savings_reasons TEXT[] NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL DEFAULT 0,
      quality_mode TEXT NOT NULL DEFAULT 'balanced',
      user_approved BOOLEAN,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_decisions_user ON ai_optimisation_decisions (user_id, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_task_cache (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      project_id TEXT,
      task_fingerprint TEXT NOT NULL,
      prompt_fingerprint TEXT NOT NULL,
      task_type TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      result TEXT NOT NULL,
      result_metadata JSONB,
      confidence REAL NOT NULL DEFAULT 1,
      reuse_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ,
      invalidated BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_cache_fingerprint ON ai_task_cache (user_id, task_fingerprint, invalidated)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_project_memory (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      memory_type TEXT NOT NULL DEFAULT 'general',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'system',
      confidence REAL NOT NULL DEFAULT 1,
      user_confirmed BOOLEAN NOT NULL DEFAULT false,
      pinned BOOLEAN NOT NULL DEFAULT false,
      outdated BOOLEAN NOT NULL DEFAULT false,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_memory_user_project ON ai_project_memory (user_id, project_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_ai_budgets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE,
      monthly_budget_usd REAL,
      warn_threshold_usd REAL,
      hard_limit_usd REAL,
      premium_approval_threshold_usd REAL NOT NULL DEFAULT 0.25,
      require_approval_above_usd REAL NOT NULL DEFAULT 1.0,
      auto_economy_at_percent REAL NOT NULL DEFAULT 80,
      block_premium_at_limit BOOLEAN NOT NULL DEFAULT true,
      allow_multi_model BOOLEAN NOT NULL DEFAULT false,
      quality_mode TEXT NOT NULL DEFAULT 'balanced',
      use_existing_first BOOLEAN NOT NULL DEFAULT true,
      provider_limits JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_ai_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      display_name TEXT NOT NULL,
      monthly_cost_usd REAL NOT NULL DEFAULT 0,
      included_usage_description TEXT,
      renewal_day INTEGER,
      prioritise BOOLEAN NOT NULL DEFAULT false,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, provider)
    )
  `);
}

export async function recordUsageEvent(input: UsageEventInput): Promise<number> {
  try {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO ai_usage_events
         (user_id, session_id, project_id, task_type, execution_method, provider, model,
          prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, reported_cost_usd,
          estimated_cost_without_optimisation, estimated_savings_usd, savings_reasons,
          duration_ms, success, cache_hit, quality_mode, tokens_avoided, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id`,
      [
        input.userId, input.sessionId ?? null, input.projectId ?? null,
        input.taskType, input.executionMethod, input.provider ?? null, input.model ?? null,
        input.promptTokens, input.completionTokens, input.promptTokens + input.completionTokens,
        input.estimatedCostUsd, input.reportedCostUsd ?? null,
        input.estimatedCostWithoutOptimisation, input.estimatedSavingsUsd,
        input.savingsReasons, input.durationMs ?? null,
        input.success, input.cacheHit, input.qualityMode, input.tokensAvoided,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );
    return rows[0]?.id ?? 0;
  } catch (err) {
    logger.error({ err }, "usageTracker: failed to record usage event");
    return 0;
  }
}

export async function getMonthlySummary(
  userId: number,
  opts?: { after?: string; before?: string },
): Promise<MonthlySummary> {
  try {
    const conditions: string[] = ["user_id = $1"];
    const params: unknown[] = [userId];
    let pi = 2;

    if (opts?.after) { conditions.push(`created_at >= $${pi++}`); params.push(opts.after); }
    else { conditions.push(`created_at >= date_trunc('month', NOW())`); }
    if (opts?.before) { conditions.push(`created_at < $${pi++}`); params.push(opts.before); }

    const where = conditions.join(" AND ");

    const { rows } = await pool.query<{
      total_tasks: string;
      tasks_without_premium: string;
      cache_hits: string;
      local_tool_executions: string;
      rule_engine_executions: string;
      economy_model_executions: string;
      premium_model_executions: string;
      estimated_spend_usd: string;
      estimated_spend_without_usd: string;
      estimated_savings_usd: string;
      tokens_avoided: string;
    }>(
      `SELECT
         COUNT(*) AS total_tasks,
         SUM(CASE WHEN execution_method NOT IN ('premium_model','multi_model') THEN 1 ELSE 0 END) AS tasks_without_premium,
         SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END) AS cache_hits,
         SUM(CASE WHEN execution_method = 'local_tool' THEN 1 ELSE 0 END) AS local_tool_executions,
         SUM(CASE WHEN execution_method = 'rule_engine' THEN 1 ELSE 0 END) AS rule_engine_executions,
         SUM(CASE WHEN execution_method = 'economy_model' THEN 1 ELSE 0 END) AS economy_model_executions,
         SUM(CASE WHEN execution_method IN ('premium_model','multi_model') THEN 1 ELSE 0 END) AS premium_model_executions,
         COALESCE(SUM(estimated_cost_usd), 0) AS estimated_spend_usd,
         COALESCE(SUM(estimated_cost_without_optimisation), 0) AS estimated_spend_without_usd,
         COALESCE(SUM(estimated_savings_usd), 0) AS estimated_savings_usd,
         COALESCE(SUM(tokens_avoided), 0) AS tokens_avoided
       FROM ai_usage_events
       WHERE ${where}`,
      params,
    );

    const r = rows[0] ?? {};
    const totalTasks = Number(r.total_tasks ?? 0);
    const estimatedSpendUsd = Number(r.estimated_spend_usd ?? 0);
    const estimatedSpendWithoutOptimisationUsd = Number(r.estimated_spend_without_usd ?? 0);
    const estimatedSavingsUsd = Number(r.estimated_savings_usd ?? 0);

    return {
      totalTasks,
      tasksWithoutPremium: Number(r.tasks_without_premium ?? 0),
      cacheHits: Number(r.cache_hits ?? 0),
      localToolExecutions: Number(r.local_tool_executions ?? 0),
      ruleEngineExecutions: Number(r.rule_engine_executions ?? 0),
      economyModelExecutions: Number(r.economy_model_executions ?? 0),
      premiumModelExecutions: Number(r.premium_model_executions ?? 0),
      estimatedSpendUsd,
      estimatedSpendWithoutOptimisationUsd,
      estimatedSavingsUsd,
      tokensAvoided: Number(r.tokens_avoided ?? 0),
      duplicateTasksPrevented: Number(r.cache_hits ?? 0),
      percentageSaved: estimatedSpendWithoutOptimisationUsd > 0
        ? Math.round((estimatedSavingsUsd / estimatedSpendWithoutOptimisationUsd) * 100)
        : 0,
    };
  } catch (err) {
    logger.error({ err }, "usageTracker: failed to get monthly summary");
    return {
      totalTasks: 0, tasksWithoutPremium: 0, cacheHits: 0, localToolExecutions: 0,
      ruleEngineExecutions: 0, economyModelExecutions: 0, premiumModelExecutions: 0,
      estimatedSpendUsd: 0, estimatedSpendWithoutOptimisationUsd: 0, estimatedSavingsUsd: 0,
      tokensAvoided: 0, duplicateTasksPrevented: 0, percentageSaved: 0,
    };
  }
}

export async function getUserBudget(userId: number): Promise<Record<string, unknown> | null> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM user_ai_budgets WHERE user_id = $1`, [userId],
    );
    return rows[0] ?? null;
  } catch { return null; }
}

export async function checkBudgetStatus(userId: number): Promise<{
  withinBudget: boolean;
  autoEconomy: boolean;
  blockPremium: boolean;
  spentThisMonth: number;
  monthlyBudget: number | null;
  percentUsed: number;
}> {
  const [summary, budget] = await Promise.all([getMonthlySummary(userId), getUserBudget(userId)]);
  const spent = summary.estimatedSpendUsd;
  const monthlyBudget = budget ? Number(budget["monthly_budget_usd"] ?? 0) || null : null;
  const hardLimit = budget ? Number(budget["hard_limit_usd"] ?? 0) || null : null;
  const autoEconomyAt = budget ? Number(budget["auto_economy_at_percent"] ?? 80) : 80;
  const blockPremiumAtLimit = budget ? Boolean(budget["block_premium_at_limit"]) : true;

  const limit = hardLimit ?? monthlyBudget;
  const percentUsed = limit && limit > 0 ? Math.round((spent / limit) * 100) : 0;

  return {
    withinBudget: !limit || spent < limit,
    autoEconomy: limit ? spent >= (limit * autoEconomyAt) / 100 : false,
    blockPremium: blockPremiumAtLimit && limit ? spent >= limit : false,
    spentThisMonth: spent,
    monthlyBudget,
    percentUsed,
  };
}

export function fingerprintPrompt(prompt: string): string {
  const normalised = prompt.trim().toLowerCase().replace(/\s+/g, " ");
  let hash = 0;
  for (let i = 0; i < normalised.length; i++) {
    hash = ((hash << 5) - hash + normalised.charCodeAt(i)) | 0;
  }
  return `fp_${Math.abs(hash).toString(36)}_${normalised.length}`;
}

export async function checkCache(userId: number, taskFingerprint: string): Promise<{
  hit: boolean;
  result?: string;
  cacheId?: number;
}> {
  try {
    const { rows } = await pool.query<{ id: number; result: string }>(
      `SELECT id, result FROM ai_task_cache
       WHERE user_id = $1
         AND task_fingerprint = $2
         AND invalidated = false
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY last_used_at DESC
       LIMIT 1`,
      [userId, taskFingerprint],
    );
    if (!rows[0]) return { hit: false };
    await pool.query(`UPDATE ai_task_cache SET reuse_count = reuse_count + 1, last_used_at = NOW() WHERE id = $1`, [rows[0].id]);
    return { hit: true, result: rows[0].result, cacheId: rows[0].id };
  } catch { return { hit: false }; }
}

export async function storeCache(input: {
  userId: number;
  projectId?: string;
  taskFingerprint: string;
  promptFingerprint: string;
  taskType: string;
  model: string;
  provider: string;
  result: string;
  ttlHours?: number;
}): Promise<void> {
  try {
    const expiresAt = input.ttlHours
      ? new Date(Date.now() + input.ttlHours * 3600 * 1000).toISOString()
      : null;
    await pool.query(
      `INSERT INTO ai_task_cache
         (user_id, project_id, task_fingerprint, prompt_fingerprint, task_type, model, provider, result, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT DO NOTHING`,
      [input.userId, input.projectId ?? null, input.taskFingerprint, input.promptFingerprint,
       input.taskType, input.model, input.provider, input.result, expiresAt],
    );
  } catch (err) {
    logger.error({ err }, "usageTracker: failed to store cache");
  }
}
