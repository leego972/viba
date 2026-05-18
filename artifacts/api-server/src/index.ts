import type { Server } from "http";
import type { AddressInfo } from "net";
import app from "./app";
import { logger } from "./lib/logger";
import { loadCircuitStateFromDb, validateCircuitBreakerEnv } from "./lib/adapterRetry";

// Fail fast if circuit breaker env vars are set to invalid values.
// This must run before any other startup logic so misconfigured deployments
// surface a clear error immediately rather than behaving unpredictably.
validateCircuitBreakerEnv();

if (!process.env["DATABASE_URL"]) {
  throw new Error("DATABASE_URL environment variable is required but was not provided.");
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
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

// loadCircuitStateFromDb is best-effort: DB errors are logged as warnings
// and the server starts with a clean (all-circuits-closed) state. The
// .catch here guards against unexpected programming errors only.
loadCircuitStateFromDb()
  .then(() => {
    listenWithRetry(1);
  })
  .catch((err) => {
    logger.error({ err }, "Unexpected fatal error during startup");
    process.exit(1);
  });
