import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";

const router: IRouter = Router();

function groqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 0);
}

function normalizeAgent(agent: unknown): Record<string, unknown> | null {
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) return null;
  return agent as Record<string, unknown>;
}

function hasGroqAgent(agents: unknown[]): boolean {
  return agents
    .map(normalizeAgent)
    .filter((agent): agent is Record<string, unknown> => Boolean(agent))
    .some((agent) => String(agent.provider ?? "").toLowerCase() === "groq");
}

function groqDefaultAgent() {
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
    configured: groqConfigured(),
    envVar: "GROQ_API_KEY",
    userInputRequired: false,
    behavior: groqConfigured()
      ? "New sessions automatically receive a live Groq-backed VIBA Core agent unless a Groq agent is already supplied."
      : "GROQ_API_KEY is not visible to the backend process. Add it in Railway env vars to enable the default VIBA Core agent.",
  });
});

router.post("/sessions", (req: Request, _res: Response, next: NextFunction): void => {
  if (!groqConfigured()) {
    next();
    return;
  }

  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") {
    next();
    return;
  }

  const incomingAgents = Array.isArray(body.agents) ? body.agents : [];
  if (hasGroqAgent(incomingAgents)) {
    body.agents = incomingAgents;
    next();
    return;
  }

  body.agents = [groqDefaultAgent(), ...incomingAgents];
  next();
});

export default router;
