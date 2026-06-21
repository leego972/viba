import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";

const router: IRouter = Router();

function platformAiConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 0);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasPlatformAgent(agents: unknown[]): boolean {
  return agents
    .map(asRecord)
    .filter((agent): agent is Record<string, unknown> => Boolean(agent))
    .some((agent) => String(agent.provider ?? "").toLowerCase() === "groq");
}

function platformAgent() {
  return {
    name: "VIBA Core",
    provider: "groq",
    role: "builder",
    isMock: false,
    canUseTools: true,
  };
}

router.get("/viba/default-ai", (_req: Request, res: Response): void => {
  res.json({
    app: "VIBA",
    defaultProvider: "groq",
    configured: platformAiConfigured(),
    userInputRequired: false,
    userOverrideAllowed: true,
  });
});

router.post("/sessions", (req: Request, _res: Response, next: NextFunction): void => {
  if (!platformAiConfigured()) { next(); return; }
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") { next(); return; }
  const incomingAgents = Array.isArray(body.agents) ? body.agents : [];
  if (hasPlatformAgent(incomingAgents)) {
    body.agents = incomingAgents;
    next();
    return;
  }
  body.agents = [platformAgent(), ...incomingAgents];
  next();
});

export default router;
