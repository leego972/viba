import app from "./app";
import { logger } from "./lib/logger";
import { loadCircuitStateFromDb } from "./lib/adapterRetry";

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

// loadCircuitStateFromDb is best-effort: DB errors are logged as warnings
// and the server starts with a clean (all-circuits-closed) state. The
// .catch here guards against unexpected programming errors only.
loadCircuitStateFromDb()
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Unexpected fatal error during startup");
    process.exit(1);
  });
