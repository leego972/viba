import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "include", headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

type Overview = { connections: any[]; apps: any[]; jobs: any[] };

export default function PlayPublisherPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [message, setMessage] = useState("");
  const overview = useQuery({ queryKey: ["play-publisher"], queryFn: () => api<Overview>("/api/play-publisher/overview") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["play-publisher"] });

  const createConnection = useMutation({ mutationFn: (body: any) => api("/api/play-publisher/connections", { method: "POST", body: JSON.stringify(body) }), onSuccess: () => { setMessage("Google Play connection verified and encrypted."); refresh(); }, onError: e => setMessage(e.message) });
  const createApp = useMutation({ mutationFn: (body: any) => api("/api/play-publisher/apps", { method: "POST", body: JSON.stringify(body) }), onSuccess: () => { setMessage("Application added."); refresh(); }, onError: e => setMessage(e.message) });
  const audit = useMutation({ mutationFn: (id: number) => api(`/api/play-publisher/apps/${id}/audit`, { method: "POST" }), onSuccess: () => { setMessage("Readiness audit completed."); refresh(); }, onError: e => setMessage(e.message) });
  const build = useMutation({ mutationFn: (id: number) => api(`/api/play-publisher/apps/${id}/builds`, { method: "POST", body: JSON.stringify({ commands: ["pnpm install", "pnpm run build", "npx cap sync android", "./gradlew bundleRelease"] }) }), onSuccess: () => { setMessage("Build queued for an isolated Android worker."); refresh(); }, onError: e => setMessage(e.message) });

  const stats = useMemo(() => ({ apps: overview.data?.apps.length ?? 0, queued: overview.data?.jobs.filter(j => ["queued", "running"].includes(j.status)).length ?? 0, released: overview.data?.jobs.filter(j => j.kind === "release" && j.status === "completed").length ?? 0 }), [overview.data]);

  return <main className="min-h-screen bg-background text-foreground p-4 md:p-8">
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div><p className="text-xs uppercase tracking-[.25em] text-muted-foreground">Mobile Publishing</p><h1 className="text-3xl font-semibold">VIBA Play Publisher</h1><p className="mt-1 text-sm text-muted-foreground">Audit, build, sign and publish Android applications with controlled approvals.</p></div>
        <a href="/dashboard" className="rounded-md border px-4 py-2 text-sm">Back to dashboard</a>
      </header>

      {message && <div className="rounded-lg border bg-card p-3 text-sm">{message}</div>}

      <section className="grid gap-4 md:grid-cols-3">
        {[['Applications', stats.apps], ['Active jobs', stats.queued], ['Completed releases', stats.released]].map(([label, value]) => <div key={String(label)} className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>)}
      </section>

      <nav className="flex flex-wrap gap-2 border-b pb-3">{['overview','connect','applications','jobs'].map(x => <button key={x} onClick={() => setTab(x)} className={`rounded-md px-4 py-2 text-sm capitalize ${tab===x?'bg-primary text-primary-foreground':'border'}`}>{x}</button>)}</nav>

      {tab === 'overview' && <section className="grid gap-5 lg:grid-cols-2">
        <Panel title="Release safeguards"><ul className="space-y-2 text-sm text-muted-foreground"><li>• Credentials encrypted with AES-256-GCM.</li><li>• Production releases require explicit approval.</li><li>• Artifact SHA-256 is verified before upload.</li><li>• Google Play App Signing remains authoritative.</li><li>• All release commits are audit logged.</li></ul></Panel>
        <Panel title="Required server configuration"><Code>PLAY_PUBLISHER_MASTER_KEY=&lt;strong-random-secret&gt;</Code><p className="mt-3 text-sm text-muted-foreground">Android workers call the build completion endpoint after uploading the signed AAB to secure object storage.</p></Panel>
      </section>}

      {tab === 'connect' && <ConnectionForm busy={createConnection.isPending} submit={body => createConnection.mutate(body)} />}
      {tab === 'applications' && <section className="space-y-5"><AppForm connections={overview.data?.connections ?? []} busy={createApp.isPending} submit={body => createApp.mutate(body)} />
        <div className="grid gap-4">{overview.data?.apps.map(app => <div key={app.id} className="rounded-xl border bg-card p-5"><div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><h3 className="font-semibold">{app.name}</h3><p className="text-sm text-muted-foreground">{app.package_name} · {app.framework} · {app.branch}</p><p className="mt-1 text-xs uppercase tracking-wide">Status: {app.status}</p></div><div className="flex gap-2"><button className="rounded-md border px-3 py-2 text-sm" onClick={() => audit.mutate(app.id)}>Run audit</button><button className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => build.mutate(app.id)}>Queue build</button></div></div></div>)}</div>
      </section>}

      {tab === 'jobs' && <Panel title="Build and release history"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">ID</th><th>App</th><th>Type</th><th>Status</th><th>Track</th><th>Created</th></tr></thead><tbody>{overview.data?.jobs.map(j => <tr key={j.id} className="border-b"><td className="p-2">#{j.id}</td><td>{j.app_id}</td><td>{j.kind}</td><td>{j.status}</td><td>{j.requested_track ?? '—'}</td><td>{new Date(j.created_at).toLocaleString()}</td></tr>)}</tbody></table></div></Panel>}
    </div>
  </main>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-xl border bg-card p-5"><h2 className="mb-4 text-lg font-semibold">{title}</h2>{children}</section>; }
function Code({ children }: { children: React.ReactNode }) { return <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{children}</pre>; }
function Field(props: React.InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />; }

function ConnectionForm({ submit, busy }: { submit: (v:any)=>void; busy:boolean }) {
  const [name,setName]=useState('Google Play'); const [serviceAccountJson,setJson]=useState('');
  return <Panel title="Connect Google Play service account"><div className="space-y-3"><Field value={name} onChange={e=>setName(e.target.value)} placeholder="Connection name"/><textarea value={serviceAccountJson} onChange={e=>setJson(e.target.value)} className="min-h-56 w-full rounded-md border bg-background p-3 font-mono text-xs" placeholder="Paste service-account JSON"/><button disabled={busy} onClick={()=>submit({name,serviceAccountJson})} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy?'Verifying…':'Verify and connect'}</button></div></Panel>;
}

function AppForm({ connections, submit, busy }: { connections:any[]; submit:(v:any)=>void; busy:boolean }) {
  const [v,setV]=useState({name:'',packageName:'',repositoryUrl:'',branch:'main',projectPath:'.',framework:'capacitor',targetSdk:35,privacyPolicyUrl:'',connectionId:''});
  const set=(k:string,x:any)=>setV({...v,[k]:x});
  return <Panel title="Add Android application"><div className="grid gap-3 md:grid-cols-2"><Field placeholder="App name" value={v.name} onChange={e=>set('name',e.target.value)}/><Field placeholder="Package name" value={v.packageName} onChange={e=>set('packageName',e.target.value)}/><Field placeholder="Repository URL" value={v.repositoryUrl} onChange={e=>set('repositoryUrl',e.target.value)}/><Field placeholder="Branch" value={v.branch} onChange={e=>set('branch',e.target.value)}/><Field placeholder="Project path" value={v.projectPath} onChange={e=>set('projectPath',e.target.value)}/><Field placeholder="Privacy policy URL" value={v.privacyPolicyUrl} onChange={e=>set('privacyPolicyUrl',e.target.value)}/><select className="rounded-md border bg-background px-3 py-2 text-sm" value={v.connectionId} onChange={e=>set('connectionId',e.target.value)}><option value="">Select Google Play connection</option>{connections.map(c=><option key={c.id} value={c.id}>{c.name} — {c.service_account_email}</option>)}</select><button disabled={busy} onClick={()=>submit({...v,connectionId:Number(v.connectionId)||null})} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy?'Adding…':'Add application'}</button></div></Panel>;
}
