import { Router, type IRouter } from "express";
import crypto from "node:crypto";

const router: IRouter = Router();

type BrowserJobStatus =
  | "queued"
  | "running"
  | "waiting_for_user_authorization"
  | "paused"
  | "completed"
  | "failed";

type AuthorizationType = "oauth" | "two_factor" | "email_link" | "passkey" | "manual_approval";

type BrowserTaskTemplate = {
  id: string;
  name: string;
  provider: string;
  description: string;
  requiresLogin: boolean;
  likelyAuthorization: AuthorizationType[];
  outputs: string[];
  destructiveActionsRequireApproval: boolean;
};

type BrowserJob = {
  id: string;
  userId: number | null;
  templateId: string;
  provider: string;
  targetUrl: string | null;
  status: BrowserJobStatus;
  creditState: "consuming" | "paused_waiting_for_user" | "stopped";
  currentStep: string;
  waitingFor: null | { type: AuthorizationType; reason: string; createdAt: string };
  outputs: Array<{ key: string; status: "found" | "pending" | "blocked"; redacted: string }>;
  audit: Array<{ at: string; event: string; detail: string }>;
  createdAt: string;
  updatedAt: string;
};

const templates: BrowserTaskTemplate[] = [
  {
    id: "stripe-billing-setup",
    name: "Stripe billing setup",
    provider: "stripe",
    description: "Navigate Stripe to locate publishable/secret key locations, product price IDs, webhook setup, and signing secret workflow.",
    requiresLogin: true,
    likelyAuthorization: ["oauth", "two_factor", "passkey", "manual_approval"],
    outputs: ["STRIPE_PUBLISHABLE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "Stripe price IDs"],
    destructiveActionsRequireApproval: true,
  },
  {
    id: "railway-env-setup",
    name: "Railway environment setup",
    provider: "railway",
    description: "Navigate Railway project/service/environment screens, find project/service/environment IDs, verify env vars, and prepare Setup Runner apply.",
    requiresLogin: true,
    likelyAuthorization: ["oauth", "two_factor", "manual_approval"],
    outputs: ["Railway project ID", "Railway environment ID", "Railway service ID", "Railway DNS target"],
    destructiveActionsRequireApproval: true,
  },
  {
    id: "godaddy-dns-setup",
    name: "GoDaddy DNS setup",
    provider: "godaddy",
    description: "Navigate GoDaddy DNS management, identify existing root/www records, prepare DNS changes for Railway custom domains, and pause for approval before edits.",
    requiresLogin: true,
    likelyAuthorization: ["two_factor", "email_link", "passkey", "manual_approval"],
    outputs: ["Root DNS records", "www DNS records", "Conflicting A/CNAME records", "Required Railway target records"],
    destructiveActionsRequireApproval: true,
  },
  {
    id: "github-token-setup",
    name: "GitHub repo/token setup",
    provider: "github",
    description: "Guide OAuth/PAT/repo access setup, verify repository permissions, and check deployment-related GitHub configuration.",
    requiresLogin: true,
    likelyAuthorization: ["oauth", "two_factor", "manual_approval"],
    outputs: ["Repository access status", "GitHub token location guidance", "Webhook/install status"],
    destructiveActionsRequireApproval: true,
  },
  {
    id: "smtp-provider-setup",
    name: "SMTP provider setup",
    provider: "smtp",
    description: "Navigate email provider setup screens and collect SMTP host, port, sender identity, and app-password workflow guidance.",
    requiresLogin: true,
    likelyAuthorization: ["two_factor", "email_link", "manual_approval"],
    outputs: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_FROM", "SMTP_PASS workflow"],
    destructiveActionsRequireApproval: false,
  },
];

const jobs = new Map<string, BrowserJob>();

function now() { return new Date().toISOString(); }
function jobId() { return `abo_${crypto.randomBytes(12).toString("hex")}`; }
function actor(req: Parameters<Parameters<IRouter["get"]>[1]>[0]): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}
function audit(job: BrowserJob, event: string, detail: string) {
  job.audit.push({ at: now(), event, detail });
  job.updatedAt = now();
}
function publicJob(job: BrowserJob) {
  return {
    ...job,
    valuesReturned: false,
    passwordStorage: false,
    secretStorage: false,
  };
}

router.get("/browser-operator/templates", (_req, res): void => {
  res.json({
    templates,
    capabilities: {
      chromiumWorkerImplemented: false,
      jobQueueImplemented: true,
      humanAuthorizationPauseImplemented: true,
      creditPauseModelImplemented: true,
      secretStorageAllowed: false,
      passwordStorageAllowed: false,
    },
    safety: [
      "No password storage",
      "No raw secret return",
      "Human authorization required for OAuth/2FA/passkey/manual approval",
      "Credits pause while waiting for user authorization",
      "Destructive actions require explicit approval",
    ],
  });
});

router.post("/browser-operator/jobs", (req, res): void => {
  const body = req.body as { templateId?: unknown; targetUrl?: unknown };
  const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
  const template = templates.find((item) => item.id === templateId);
  if (!template) { res.status(400).json({ error: "unknown_template" }); return; }
  const id = jobId();
  const createdAt = now();
  const job: BrowserJob = {
    id,
    userId: actor(req),
    templateId: template.id,
    provider: template.provider,
    targetUrl: typeof body.targetUrl === "string" && body.targetUrl.trim() ? body.targetUrl.trim() : null,
    status: "queued",
    creditState: "consuming",
    currentStep: "Job created. Waiting for browser worker assignment.",
    waitingFor: null,
    outputs: template.outputs.map((key) => ({ key, status: "pending", redacted: "PENDING" })),
    audit: [{ at: createdAt, event: "job_created", detail: `Created ${template.name}` }],
    createdAt,
    updatedAt: createdAt,
  };
  jobs.set(id, job);
  res.status(201).json({ job: publicJob(job) });
});

router.get("/browser-operator/jobs/:id", (req, res): void => {
  const job = jobs.get(String(req.params.id));
  if (!job) { res.status(404).json({ error: "job_not_found" }); return; }
  res.json({ job: publicJob(job) });
});

router.post("/browser-operator/jobs/:id/start", (req, res): void => {
  const job = jobs.get(String(req.params.id));
  if (!job) { res.status(404).json({ error: "job_not_found" }); return; }
  if (job.status !== "queued" && job.status !== "paused") { res.status(409).json({ error: "job_not_startable", status: job.status }); return; }
  job.status = "running";
  job.creditState = "consuming";
  job.currentStep = "Browser operator running. It will pause only for required user authorization.";
  audit(job, "job_started", "Job moved to running state");
  res.json({ job: publicJob(job) });
});

router.post("/browser-operator/jobs/:id/waiting-for-user", (req, res): void => {
  const job = jobs.get(String(req.params.id));
  if (!job) { res.status(404).json({ error: "job_not_found" }); return; }
  const body = req.body as { type?: unknown; reason?: unknown };
  const type = typeof body.type === "string" ? body.type : "manual_approval";
  const allowed: AuthorizationType[] = ["oauth", "two_factor", "email_link", "passkey", "manual_approval"];
  if (!allowed.includes(type as AuthorizationType)) { res.status(400).json({ error: "invalid_authorization_type" }); return; }
  const reason = typeof body.reason === "string" && body.reason.trim()
    ? body.reason.trim().slice(0, 500)
    : "User authorization required to continue.";
  job.status = "waiting_for_user_authorization";
  job.creditState = "paused_waiting_for_user";
  job.waitingFor = { type: type as AuthorizationType, reason, createdAt: now() };
  job.currentStep = reason;
  audit(job, "waiting_for_user_authorization", `${type}: ${reason}`);
  res.json({ job: publicJob(job) });
});

router.post("/browser-operator/jobs/:id/authorize", (req, res): void => {
  const job = jobs.get(String(req.params.id));
  if (!job) { res.status(404).json({ error: "job_not_found" }); return; }
  if (job.status !== "waiting_for_user_authorization") {
    res.status(409).json({ error: "job_not_waiting_for_authorization", status: job.status }); return;
  }
  job.status = "running";
  job.creditState = "consuming";
  job.waitingFor = null;
  job.currentStep = "User authorization received. Browser operator resumed.";
  audit(job, "user_authorized_resume", "User authorization received; no raw 2FA/password value stored");
  res.json({ job: publicJob(job) });
});

router.post("/browser-operator/jobs/:id/pause", (req, res): void => {
  const job = jobs.get(String(req.params.id));
  if (!job) { res.status(404).json({ error: "job_not_found" }); return; }
  job.status = "paused";
  job.creditState = "stopped";
  job.currentStep = "Paused by user or system.";
  audit(job, "job_paused", "Job paused outside automatic user-authorization wait");
  res.json({ job: publicJob(job) });
});

router.post("/browser-operator/jobs/:id/complete", (req, res): void => {
  const job = jobs.get(String(req.params.id));
  if (!job) { res.status(404).json({ error: "job_not_found" }); return; }
  job.status = "completed";
  job.creditState = "stopped";
  job.currentStep = "Completed. Review evidence and apply outputs through Setup Runner where required.";
  job.outputs = job.outputs.map((item) => item.status === "pending" ? { ...item, status: "found", redacted: "SET_OR_DOCUMENTED" } : item);
  audit(job, "job_completed", "Job completed with redacted outputs only");
  res.json({ job: publicJob(job) });
});

export default router;
