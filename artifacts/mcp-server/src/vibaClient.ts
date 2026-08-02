export interface VibaClientOptions {
  apiKey: string;
  baseUrl: string;
}

export class VibaApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "VibaApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Thin wrapper around Viba's real task-intake API. Every call carries the
 * caller's own `viba_live_...` API key as a Bearer token — this client is
 * intentionally stateless and per-request; nothing here is cached or
 * shared across users.
 *
 * Contract source: artifacts/api-server/src/routes/taskIntake.ts,
 * taskIntakeStatus.ts (repo leego972/viba).
 */
export class VibaClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: VibaClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }

    if (!res.ok) {
      const message =
        json && typeof json === "object" && "error" in json
          ? String((json as Record<string, unknown>).error)
          : `Viba API returned ${res.status}`;
      throw new VibaApiError(message, res.status, json);
    }

    return json;
  }

  createMission(request: string): Promise<unknown> {
    return this.request("POST", "/api/task-intake/create", { request });
  }

  getMissionStatus(taskId: number): Promise<unknown> {
    return this.request("GET", `/api/task-intake/${taskId}/status`);
  }

  getMissionPlan(taskId: number): Promise<unknown> {
    return this.request("GET", `/api/task-intake/${taskId}/plan`);
  }

  approveMission(taskId: number): Promise<unknown> {
    return this.request("POST", `/api/task-intake/${taskId}/approve`);
  }

  cancelMission(taskId: number): Promise<unknown> {
    return this.request("POST", `/api/task-intake/${taskId}/cancel`);
  }

  getEvidenceReport(taskId: number): Promise<unknown> {
    return this.request("GET", `/api/task-intake/${taskId}/evidence-report`);
  }
}
