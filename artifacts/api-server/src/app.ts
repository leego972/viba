import express, { type Express } from "express";
  import cors from "cors";
  import pinoHttp from "pino-http";
  import path from "path";
  import { existsSync } from "fs";
  import router from "./routes";
  import { logger } from "./lib/logger";
  import { createRateLimiter } from "./middlewares/rateLimiter";

  const app: Express = express();

  // General API rate limiter — 300 req per minute per IP
  const apiLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 300,
    message: "Too many requests. Please slow down.",
  });

  // Strict limiter for expensive AI agent execution endpoints
  const agentLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 30,
    message: "Agent execution rate limit reached. Wait before running more steps.",
  });

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Apply strict rate limit to AI session execution paths before the main router
  app.use("/api/sessions", agentLimiter);

  // General rate limit + router for all /api routes
  app.use("/api", apiLimiter, router);

  if (process.env.NODE_ENV === "production") {
    const frontendDist = path.resolve(
      process.cwd(),
      "artifacts/bridge-ai/dist/public",
    );
    if (existsSync(frontendDist)) {
      app.use(express.static(frontendDist));
      app.get("/{*splat}", (_req, res) => {
        res.sendFile(path.join(frontendDist, "index.html"));
      });
    }
  }

  export default app;
  