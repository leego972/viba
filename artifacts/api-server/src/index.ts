// Sentry must be initialised before all other imports so it can instrument
// every subsequently-loaded module. No-op when SENTRY_DSN is not set.
import "./lib/sentry";

import type { Server } from "http";
import type { AddressInfo } from "net";
import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { loadCircuitStateFromDb, validateCircuitBreakerEnv } from "./lib/adapterRetry";
import { provisionStripeProducts } from "./lib/billing";
import bcrypt from "bcryptjs";

// Fail fast if circuit breaker env vars are set to invalid values.
validateCircuitBreakerEnv();

if (!process.env["DATABASE_URL"]) {
  throw new Error("DATABASE_URL environment variable is required but was not provided.");
}

const rawPort = process.env["PORT"];
if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Idempotent startup migrations.
 * All statements use IF NOT EXISTS / DO $$ guards so they are safe to re-run
 * on every deploy. Never use DROP or ALTER COLUMN TYPE here without a manual
 * migration note — those are destructive and must be run once, by hand.
 */
async function runStartupMigrations(): Promise<void> {
  // ── subscribers table (create if not present) ─────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id                     SERIAL      PRIMARY KEY,
      email                  TEXT        NOT NULL,
      stripe_customer_id     TEXT        UNIQUE,
      stripe_subscription_id TEXT        UNIQUE,
      access_token           TEXT        UNIQUE NOT NULL,
      status                 TEXT        NOT NULL DEFAULT 'pending',
      trial_end              TIMESTAMPTZ,
      current_period_end     TIMESTAMPTZ,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── subscribers: email unique constraint (safe to add if missing) ──────────
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE subscribers ADD CONSTRAINT subscribers_email_unique UNIQUE (email);
    EXCEPTION WHEN duplicate_table OR duplicate_object OR unique_violation THEN
      NULL; -- already exists, skip
    END $$
  `);

  // ── agents: created_at column (added in db-audit, safe additive migration) ─
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agents' AND column_name = 'created_at'
      ) THEN
        ALTER TABLE agents
          ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      END IF;
    END $$
  `);

  // ── memory: created_at column ─────────────────────────────────────────────
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'memory' AND column_name = 'created_at'
      ) THEN
        ALTER TABLE memory
          ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      END IF;
    END $$
  `);

  // ── memory: unique constraint on session_id ───────────────────────────────
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'memory_session_id_unique'
          AND conrelid = 'memory'::regclass
      ) THEN
        ALTER TABLE memory
          ADD CONSTRAINT memory_session_id_unique UNIQUE (session_id);
      END IF;
    END $$
  `);

  // ── approvals: updatedAt, rejectedAt, rejectedReason columns ─────────────
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'approvals' AND column_name = 'updated_at'
      ) THEN
        ALTER TABLE approvals
          ADD COLUMN updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ADD COLUMN rejected_at  TIMESTAMPTZ,
          ADD COLUMN rejected_reason TEXT;
      END IF;
    END $$
  `);

  // ── audit_logs: make session_id nullable (system-level events) ────────────
  // This is a one-time structural change — idempotent because NOT NULL can only
  // be dropped, not added, by this guard pattern.
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'audit_logs'
          AND column_name = 'session_id'
          AND is_nullable = 'NO'
      ) THEN
        ALTER TABLE audit_logs ALTER COLUMN session_id DROP NOT NULL;
      END IF;
    END $$
  `);

  // agents: canUseTools column
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agents' AND column_name = 'can_use_tools'
      ) THEN
        ALTER TABLE agents ADD COLUMN can_use_tools BOOLEAN NOT NULL DEFAULT false;
        UPDATE agents SET can_use_tools = true WHERE provider IN ('replit', 'manus');
      END IF;
    END $$
  `);

  // ── agents: sat_out_reason column (safety voting) ─────────────────────────
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agents' AND column_name = 'sat_out_reason'
      ) THEN
        ALTER TABLE agents ADD COLUMN sat_out_reason TEXT;
      END IF;
    END $$
  `);

  // ── users table (email/password + OAuth accounts) ─────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL      PRIMARY KEY,
      email         TEXT        NOT NULL,
      password_hash TEXT,
      name          TEXT,
      google_id     TEXT        UNIQUE,
      github_id     TEXT        UNIQUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
    EXCEPTION WHEN duplicate_table OR duplicate_object OR unique_violation THEN
      NULL;
    END $$
  `);

  // sessions: workspace context columns — one guard per column
  await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS repo_url TEXT`);
  await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS repo_branch TEXT`);
  await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS workspace_env TEXT`);

  // tasks: tool handoff columns — one guard per column
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS blocked_reason TEXT`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS partial_work TEXT`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tool_requirements TEXT[]`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS dependency_task_id INTEGER`);

  // messages: inter-agent comms columns — one guard per column
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS task_id INTEGER`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'output'`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS to_agent_id INTEGER`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB`);

  // ── users: billing columns ────────────────────────────────────────────────
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'none'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_remaining INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_period_end TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_exhausted_notified_at TIMESTAMPTZ`);

  // Unique constraints for Stripe IDs (skip if already exist)
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE users ADD CONSTRAINT users_stripe_customer_id_unique UNIQUE (stripe_customer_id);
    EXCEPTION WHEN duplicate_table OR duplicate_object OR unique_violation THEN NULL; END $$
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE users ADD CONSTRAINT users_stripe_subscription_id_unique UNIQUE (stripe_subscription_id);
    EXCEPTION WHEN duplicate_table OR duplicate_object OR unique_violation THEN NULL; END $$
  `);

  // ── password_reset_tokens table ───────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         SERIAL      PRIMARY KEY,
      user_id    INTEGER     NOT NULL,
      token      TEXT        NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── credit_transactions table ─────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id            SERIAL      PRIMARY KEY,
      user_id       INTEGER     NOT NULL,
      amount        INTEGER     NOT NULL,
      balance_after INTEGER     NOT NULL,
      reason        TEXT        NOT NULL,
      session_id    INTEGER,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── DB indexes (tables that exist before this point) ─────────────────────
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_session_id ON audit_logs(session_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)`);
  // Performance indexes for core lookup paths
  // Note: sessions table has no user_id column — agents/tasks are indexed by session_id
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agents_session_id ON agents(session_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id)`);

  // ── email_verification_tokens table ───────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id         SERIAL      PRIMARY KEY,
      user_id    INTEGER     NOT NULL,
      token      TEXT        NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Indexes on email_verification_tokens MUST come after table creation above
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens(token)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id)`);

  // ── users: email_verified column ──────────────────────────────────────────
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false`);

  // ── users: low_credits_notified_at column ─────────────────────────────────
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS low_credits_notified_at TIMESTAMPTZ`);

  logger.info("Startup migrations complete");
}

/**
 * Ensures an admin user exists with infinite credits.
 *
 * Requires both ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD env vars to be set.
 * If either is missing the step is skipped — no privileged account is created automatically.
 * On conflict (user already exists) only billing fields are updated; the password is never
 * overwritten so operators can rotate it independently.
 */
async function ensureAdminUser(): Promise<void> {
  const adminEmail = process.env["ADMIN_BOOTSTRAP_EMAIL"]?.trim();
  const adminPassword = process.env["ADMIN_BOOTSTRAP_PASSWORD"];

  if (!adminEmail || !adminPassword) {
    logger.info("Admin bootstrap skipped — ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD not set");
    return;
  }

  const hash = await bcrypt.hash(adminPassword, 12);

  await pool.query(
    `INSERT INTO users (email, password_hash, name, subscription_status, credits_remaining)
     VALUES ($1, $2, 'Admin', 'active', 999999999)
     ON CONFLICT (email) DO UPDATE SET
       subscription_status = 'active',
       credits_remaining   = 999999999,
       updated_at          = NOW()`,
    [adminEmail, hash],
  );
  logger.info({ email: adminEmail }, "Admin user ensured");
}

// Bind the server with one EADDRINUSE retry to survive workflow restart races
// where the previous process has not yet released the port.
function listenWithRetry(attemptNumber: number): void {
  const server: Server = app.listen(port, () => {
    const bound = server.address() as AddressInfo | null;
    logger.info({ port: bound?.port ?? port }, "Server listening");
  });

  server.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && attemptNumber < 2) {
      const delayMs = 2000;
      logger.warn(
        { port, attempt: attemptNumber, delayMs },
        "Port in use — retrying after delay",
      );
      server.close(() => {
        setTimeout(() => listenWithRetry(attemptNumber + 1), delayMs);
      });
    } else {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
  });
}

loadCircuitStateFromDb()
  .then(() => runStartupMigrations())
  .then(() => ensureAdminUser())
  .then(() => provisionStripeProducts())
  .then(() => {
    listenWithRetry(1);

    // Periodic cleanup of expired/used password_reset_tokens (every 6 hours)
    const TOKEN_CLEANUP_MS = 6 * 60 * 60 * 1000;
    setInterval(() => {
      pool.query(
        `DELETE FROM password_reset_tokens
         WHERE expires_at < NOW() - INTERVAL '1 day'
            OR (used_at IS NOT NULL AND used_at < NOW() - INTERVAL '1 day')`
      ).then(({ rowCount }) => {
        if ((rowCount ?? 0) > 0) {
          logger.info({ rowCount }, "Cleaned up expired password_reset_tokens");
        }
      }).catch((err: unknown) => {
        logger.error({ err }, "password_reset_tokens cleanup failed");
      });

      // Also clean up expired email_verification_tokens
      pool.query(
        `DELETE FROM email_verification_tokens
         WHERE expires_at < NOW() - INTERVAL '1 day'
            OR (used_at IS NOT NULL AND used_at < NOW() - INTERVAL '1 day')`
      ).catch((err: unknown) => {
        logger.error({ err }, "email_verification_tokens cleanup failed");
      });
    }, TOKEN_CLEANUP_MS);
  })
  .catch((err) => {
    logger.error({ err }, "Unexpected fatal error during startup");
    process.exit(1);
  });

