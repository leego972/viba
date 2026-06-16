import type { Server } from "http";
import type { AddressInfo } from "net";
import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { loadCircuitStateFromDb, validateCircuitBreakerEnv } from "./lib/adapterRetry";

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
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'subscribers_email_unique'
          AND conrelid = 'subscribers'::regclass
      ) THEN
        ALTER TABLE subscribers
          ADD CONSTRAINT subscribers_email_unique UNIQUE (email);
      END IF;
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

  // sessions: workspace context columns
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sessions' AND column_name = 'repo_url'
      ) THEN
        ALTER TABLE sessions
          ADD COLUMN repo_url TEXT,
          ADD COLUMN repo_branch TEXT,
          ADD COLUMN workspace_env TEXT;
      END IF;
    END $$
  `);

  // tasks: tool handoff columns
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tasks' AND column_name = 'blocked_reason'
      ) THEN
        ALTER TABLE tasks
          ADD COLUMN blocked_reason TEXT,
          ADD COLUMN partial_work TEXT,
          ADD COLUMN tool_requirements TEXT[];
      END IF;
    END $$
  `);

  // messages: inter-agent comms columns
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'messages' AND column_name = 'message_type'
      ) THEN
        ALTER TABLE messages
          ADD COLUMN message_type TEXT NOT NULL DEFAULT 'output',
          ADD COLUMN to_agent_id INTEGER,
          ADD COLUMN metadata JSONB;
      END IF;
    END $$
  `);

  logger.info("Startup migrations complete");
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
  .then(() => {
    listenWithRetry(1);
  })
  .catch((err) => {
    logger.error({ err }, "Unexpected fatal error during startup");
    process.exit(1);
  });

// ── Tool-use & inter-agent comms migrations (idempotent) ──────────────────────
  // These run as part of the regular runStartupMigrations() call — appended here
  // to keep migrations self-contained.
