export type CloudProvider = "github" | "render" | "vercel";

export interface CloudProject {
  id: string;
  name: string;
  provider: CloudProvider;
  url?: string;
  status?: string;
  raw?: unknown;
}

export interface CloudDeployment {
  id: string;
  projectId?: string;
  provider: CloudProvider;
  status?: string;
  url?: string;
  createdAt?: string;
  raw?: unknown;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    const message = typeof body === "string" ? body.slice(0, 500) : JSON.stringify(body).slice(0, 500);
    throw new Error(`Provider request failed (${response.status}): ${message}`);
  }
  return body as T;
}

function githubHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${requiredEnv("GITHUB_TOKEN")}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "VIBA-Universal-Gateway",
  };
}

function renderHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${requiredEnv("RENDER_API_KEY")}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function vercelHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${requiredEnv("VERCEL_TOKEN")}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function withVercelScope(url: URL): URL {
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  if (teamId) url.searchParams.set("teamId", teamId);
  return url;
}

export async function listCloudProjects(provider: CloudProvider): Promise<CloudProject[]> {
  if (provider === "github") {
    const repos = await requestJson<Array<{ id: number; name: string; html_url: string; visibility?: string }>>(
      "https://api.github.com/user/repos?per_page=100&sort=updated",
      { headers: githubHeaders() },
    );
    return repos.map((repo) => ({ id: String(repo.id), name: repo.name, provider, url: repo.html_url, status: repo.visibility, raw: repo }));
  }

  if (provider === "render") {
    const services = await requestJson<Array<{ service?: { id?: string; name?: string; serviceDetails?: { url?: string }; suspended?: string }; id?: string; name?: string }>>(
      "https://api.render.com/v1/services?limit=100",
      { headers: renderHeaders() },
    );
    return services.map((entry) => {
      const service = entry.service ?? entry;
      return {
        id: String(service.id ?? ""),
        name: service.name ?? "Unnamed Render service",
        provider,
        url: service.serviceDetails?.url,
        status: service.suspended,
        raw: entry,
      };
    });
  }

  const url = withVercelScope(new URL("https://api.vercel.com/v9/projects"));
  url.searchParams.set("limit", "100");
  const body = await requestJson<{ projects?: Array<{ id: string; name: string; targets?: { production?: { url?: string } } }> }>(url.toString(), { headers: vercelHeaders() });
  return (body.projects ?? []).map((project) => ({
    id: project.id,
    name: project.name,
    provider,
    url: project.targets?.production?.url ? `https://${project.targets.production.url}` : undefined,
    raw: project,
  }));
}

export async function listCloudDeployments(provider: CloudProvider, projectId?: string): Promise<CloudDeployment[]> {
  if (provider === "github") {
    if (!projectId) throw new Error("projectId must be owner/repository for GitHub workflow runs");
    const body = await requestJson<{ workflow_runs?: Array<{ id: number; status?: string; conclusion?: string; html_url?: string; created_at?: string }> }>(
      `https://api.github.com/repos/${encodeURI(projectId)}/actions/runs?per_page=50`,
      { headers: githubHeaders() },
    );
    return (body.workflow_runs ?? []).map((run) => ({ id: String(run.id), projectId, provider, status: run.conclusion ?? run.status, url: run.html_url, createdAt: run.created_at, raw: run }));
  }

  if (provider === "render") {
    if (!projectId) throw new Error("projectId is required for Render deployments");
    const body = await requestJson<Array<{ id: string; status?: string; createdAt?: string; commit?: { id?: string } }>>(
      `https://api.render.com/v1/services/${encodeURIComponent(projectId)}/deploys?limit=50`,
      { headers: renderHeaders() },
    );
    return body.map((dep) => ({ id: dep.id, projectId, provider, status: dep.status, createdAt: dep.createdAt, raw: dep }));
  }

  const url = withVercelScope(new URL("https://api.vercel.com/v6/deployments"));
  if (projectId) url.searchParams.set("projectId", projectId);
  url.searchParams.set("limit", "50");
  const body = await requestJson<{ deployments?: Array<{ uid: string; name?: string; state?: string; url?: string; created?: number }> }>(url.toString(), { headers: vercelHeaders() });
  return (body.deployments ?? []).map((dep) => ({ id: dep.uid, projectId, provider, status: dep.state, url: dep.url ? `https://${dep.url}` : undefined, createdAt: dep.created ? new Date(dep.created).toISOString() : undefined, raw: dep }));
}

export async function triggerCloudDeployment(provider: CloudProvider, input: { projectId: string; ref?: string; repo?: string }): Promise<CloudDeployment> {
  if (provider === "github") {
    const repo = input.repo ?? input.projectId;
    const workflow = process.env.GITHUB_DEPLOY_WORKFLOW?.trim() || "deploy.yml";
    await requestJson<unknown>(
      `https://api.github.com/repos/${encodeURI(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
      { method: "POST", headers: { ...githubHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ ref: input.ref ?? "main" }) },
    );
    return { id: `github-dispatch-${Date.now()}`, projectId: repo, provider, status: "queued" };
  }

  if (provider === "render") {
    const dep = await requestJson<{ id: string; status?: string; createdAt?: string }>(
      `https://api.render.com/v1/services/${encodeURIComponent(input.projectId)}/deploys`,
      { method: "POST", headers: renderHeaders(), body: JSON.stringify({ clearCache: "do_not_clear" }) },
    );
    return { id: dep.id, projectId: input.projectId, provider, status: dep.status, createdAt: dep.createdAt, raw: dep };
  }

  const url = withVercelScope(new URL("https://api.vercel.com/v13/deployments"));
  const body: Record<string, unknown> = { name: input.projectId, target: "production" };
  if (input.repo) {
    body.gitSource = { type: "github", repo: input.repo, ref: input.ref ?? "main" };
  }
  const dep = await requestJson<{ id: string; status?: string; readyState?: string; url?: string; createdAt?: number }>(
    url.toString(),
    { method: "POST", headers: vercelHeaders(), body: JSON.stringify(body) },
  );
  return {
    id: dep.id,
    projectId: input.projectId,
    provider,
    status: dep.readyState ?? dep.status,
    url: dep.url ? `https://${dep.url}` : undefined,
    createdAt: dep.createdAt ? new Date(dep.createdAt).toISOString() : undefined,
    raw: dep,
  };
}

export function configuredCloudProviders(): Record<CloudProvider, boolean> {
  return {
    github: Boolean(process.env.GITHUB_TOKEN?.trim()),
    render: Boolean(process.env.RENDER_API_KEY?.trim()),
    vercel: Boolean(process.env.VERCEL_TOKEN?.trim()),
  };
}
