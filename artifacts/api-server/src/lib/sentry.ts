/**
 * Sentry server-side initialisation.
 * Imported at the very top of index.ts (before all other imports) so it can
 * instrument all subsequently-loaded modules.
 * No-op when SENTRY_DSN is not set — server starts normally without it.
 */
import * as Sentry from "@sentry/node";
import { logger } from "./logger";

const dsn = process.env.SENTRY_DSN;
const env = process.env.NODE_ENV ?? "development";

if (dsn) {
  Sentry.init({
    dsn,
    environment: env,
    // 10% transaction sampling in production keeps quota low; 100% in dev
    tracesSampleRate: env === "production" ? 0.1 : 1.0,
    sampleRate: 1.0,
    integrations: [
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
    ],
    beforeSend(event) {
      // Strip credentials before they leave the server
      if (event.request?.cookies) delete event.request.cookies;
      if (event.request?.headers?.authorization) delete event.request.headers.authorization;
      if (event.request?.headers?.cookie) delete event.request.headers.cookie;
      return event;
    },
  });
  logger.info(`[Sentry] Initialised — env: ${env}`);
} else {
  logger.info("[Sentry] SENTRY_DSN not set — error reporting disabled");
}

export { Sentry };
