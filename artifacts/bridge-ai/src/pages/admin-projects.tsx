import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Database, FolderOpen, RefreshCw, Search, User, Files, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const TOKEN_KEY = "viba_admin_token";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ProjectSummary = {
  id: string;
  user_id: number;
  email: string;
  user_name: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  source: string;
  latest_version: number;
  version_count: number;
  total_bytes: number | string;
  created_at: string;
  updated_at: string;
};

type ProjectFile = {
  relativePath: string;
  sizeBytes: number | string;
  sha256: string;
  mimeType: string | null;
};

type ProjectVersion = {
  id: string;
  version_number: number;
  label: string | null;
  status: string;
  file_count: number;
  total_bytes: number | string;
  manifest_sha256: string | null;
  created_at: string;
  files: ProjectFile[] | null;
};

type ProjectDetail = ProjectSummary & { versions: ProjectVersion[] };

function bytes(value: number | string): string {
  let amount = Number(value || 0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

async function adminRequest(path: string, token: string): Promise<Response> {
  return fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

export default function AdminProjectsPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? "");
  const [inputToken, setInputToken] = useState(token);
  const [search, setSearch] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selected, setSelected] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const totals = useMemo(() => ({
    projects: projects.length,
    users: new Set(projects.map((project) => project.user_id)).size,
    bytes: projects.reduce((sum, project) => sum + Number(project.total_bytes || 0), 0),
    versions: projects.reduce((sum, project) => sum + Number(project.version_count || 0), 0),
  }), [projects]);

  async function loadProjects(nextSearch = search, nextToken = token) {
    setLoading(true);
    setError("");
    try {
      const response = await adminRequest(`/admin/projects?search=${encodeURIComponent(nextSearch)}&limit=500`, nextToken);
      const data = await response.json() as { projects?: ProjectSummary[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Administrator access failed");
      setProjects(data.projects ?? []);
      setSelected(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load projects");
    } finally {
      setLoading(false);
    }
  }

  async function openProject(projectId: string) {
    setLoading(true);
    setError("");
    try {
      const response = await adminRequest(`/admin/projects/${encodeURIComponent(projectId)}`, token);
      const data = await response.json() as { project?: ProjectDetail; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error ?? "Project could not be loaded");
      setSelected(data.project);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load project");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) void loadProjects("", token);
  }, []);

  if (!token) {
    return (
      <main className="min-h-screen bg-background p-4 sm:p-8">
        <Card className="mx-auto mt-20 max-w-md">
          <CardHeader><CardTitle>Admin Project Storage</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Enter the administrator token used by the main admin dashboard.</p>
            <Input type="password" value={inputToken} onChange={(event) => setInputToken(event.target.value)} placeholder="Administrator token" />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" onClick={async () => {
              const candidate = inputToken.trim();
              if (!candidate) return;
              sessionStorage.setItem(TOKEN_KEY, candidate);
              setToken(candidate);
              await loadProjects("", candidate);
            }}>Open project storage</Button>
            <Link href="/admin"><Button variant="outline" className="w-full">Back to admin</Button></Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Database className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-semibold">User Project Storage</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Persistent, tenant-isolated VIBA builds and version manifests.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin"><Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" />Admin dashboard</Button></Link>
            <Button variant="outline" disabled={loading} onClick={() => void loadProjects()}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card><CardContent className="flex items-center gap-3 p-4"><FolderOpen className="h-5 w-5 text-primary" /><div><div className="text-2xl font-semibold">{totals.projects}</div><div className="text-xs text-muted-foreground">Projects</div></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><User className="h-5 w-5 text-primary" /><div><div className="text-2xl font-semibold">{totals.users}</div><div className="text-xs text-muted-foreground">Owners</div></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><Files className="h-5 w-5 text-primary" /><div><div className="text-2xl font-semibold">{totals.versions}</div><div className="text-xs text-muted-foreground">Versions</div></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><HardDrive className="h-5 w-5 text-primary" /><div><div className="text-2xl font-semibold">{bytes(totals.bytes)}</div><div className="text-xs text-muted-foreground">Stored</div></div></CardContent></Card>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex gap-2">
              <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadProjects(); }} placeholder="Search project name or user email" /></div>
              <Button onClick={() => void loadProjects()}>Search</Button>
            </div>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
          <Card>
            <CardHeader><CardTitle className="text-base">All projects</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[850px] text-sm">
                <thead><tr className="border-y bg-muted/40 text-left text-xs text-muted-foreground"><th className="px-4 py-3">Project</th><th className="px-4 py-3">Owner</th><th className="px-4 py-3">Versions</th><th className="px-4 py-3">Storage</th><th className="px-4 py-3">Updated</th><th className="px-4 py-3" /></tr></thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id} className="border-b align-top hover:bg-muted/30">
                      <td className="px-4 py-3"><div className="font-medium">{project.name}</div><div className="text-xs text-muted-foreground">{project.slug} · {project.source}</div></td>
                      <td className="px-4 py-3"><div>{project.email}</div><div className="text-xs text-muted-foreground">User #{project.user_id}{project.user_name ? ` · ${project.user_name}` : ""}</div></td>
                      <td className="px-4 py-3">{project.version_count}</td>
                      <td className="px-4 py-3">{bytes(project.total_bytes)}</td>
                      <td className="px-4 py-3">{new Date(project.updated_at).toLocaleString()}</td>
                      <td className="px-4 py-3"><Button size="sm" variant="outline" onClick={() => void openProject(project.id)}>Inspect</Button></td>
                    </tr>
                  ))}
                  {!projects.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No stored projects found.</td></tr>}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Project detail</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {!selected ? <p className="text-sm text-muted-foreground">Select a project to inspect its immutable versions and file manifests.</p> : (
                <>
                  <div><h2 className="font-semibold">{selected.name}</h2><p className="text-sm text-muted-foreground">{selected.email} · User #{selected.user_id}</p>{selected.description && <p className="mt-2 text-sm">{selected.description}</p>}</div>
                  <div className="flex flex-wrap gap-2"><Badge>{selected.status}</Badge><Badge variant="outline">{selected.source}</Badge><Badge variant="outline">{bytes(selected.total_bytes)}</Badge></div>
                  <div className="max-h-[650px] space-y-3 overflow-y-auto pr-1">
                    {(selected.versions ?? []).map((version) => (
                      <div key={version.id} className="rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-3"><div><div className="font-medium">Version {version.version_number}{version.label ? ` — ${version.label}` : ""}</div><div className="text-xs text-muted-foreground">{new Date(version.created_at).toLocaleString()}</div></div><Badge variant={version.status === "complete" ? "default" : "secondary"}>{version.status}</Badge></div>
                        <div className="mt-2 text-xs text-muted-foreground">{version.file_count} files · {bytes(version.total_bytes)}</div>
                        {version.manifest_sha256 && <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">Manifest: {version.manifest_sha256}</div>}
                        <div className="mt-3 space-y-1">
                          {(version.files ?? []).map((file) => <div key={file.relativePath} className="flex justify-between gap-3 rounded bg-muted/40 px-2 py-1 text-xs"><span className="min-w-0 truncate font-mono">{file.relativePath}</span><span className="shrink-0 text-muted-foreground">{bytes(file.sizeBytes)}</span></div>)}
                          {!version.files?.length && <p className="text-xs text-muted-foreground">No files recorded.</p>}
                        </div>
                      </div>
                    ))}
                    {!selected.versions?.length && <p className="text-sm text-muted-foreground">No project versions yet.</p>}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
