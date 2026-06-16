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

// Create the subscribers table if it doesn't exist yet.
// This is idempotent — safe to run on every startup.
async function ensureSubscribersTable(): Promise<void> {
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
  logger.info("Subscribers table ready");
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
  .then(() => ensureSubscribersTable())
  .then(() => {
    listenWithRetry(1);
  })
  .catch((err) => {
    logger.error({ err }, "Unexpected fatal error during startup");
    process.exit(1);
  });
