import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { Bot, Copy, Download, FastForward, GitBranch, History, ListChecks, MessageSquare, Play, RefreshCw, RotateCcw, Search, ShieldCheck, Square } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { AttachmentComposer } from "@/components/session/AttachmentComposer";
import { MarkdownContent } from "@/components/MarkdownContent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type SessionRecord = {
  id: number;
  goal: string;
  status: string;
  autonomyMode?: string | null;
  repoUrl?: string | null;
  repoBranch?: string | null;
  workspaceEnv?: string | null;
};

type MessageRecord = {
  id: number;
  role: string;
  content: string;
  agentName?: string | null;
  agentRole?: string | null;
  messageType?: string | null;
  createdAt?: string | null;
};

type TaskRecord = { id: number; title: string; status: string };
type AgentRecord = { id: number; name: string; provider?: string | null; activeModel?: string | null; isMock?: boolean | null };
type AuditRecord = { id: number; eventType?: string | null; description?: string | null; createdAt?: string | null };

async function apiGet<T>(path: string, fallback: T): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) return fallback;
  return (await res.json().catch(() => fallback)) as T;
}

async function apiPost(path: string, body?: unknown): Promise<boolean> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.ok;
}

function formatTime(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusTone(status?: string): string {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "completed") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "paused") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "stopped") return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function shortRepo(url?: string | null): string {
  if (!url) return "No repo set";
  try {
    return new URL(url).pathname.replace(/^\//, "").replace(/\.git$/, "");
  } catch {
    return url;
  }
}

export default function SessionWorkspaceClinical() {
  const { id } = useParams();
  const sessionId = Number.parseInt(id || "0", 10);
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoBranch, setRepoBranch] = useState("");
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRecord[]>([]);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const [sessionData, messageData, taskData, agentData, auditData] = await Promise.all([
        apiGet<SessionRecord | null>(`/api/sessions/${sessionId}`, null),
        apiGet<MessageRecord[]>(`/api/sessions/${sessionId}/messages`, []),
        apiGet<TaskRecord[]>(`/api/sessions/${sessionId}/tasks`, []),
        apiGet<AgentRecord[]>(`/api/sessions/${sessionId}/agents`, []),
        apiGet<AuditRecord[]>(`/api/sessions/${sessionId}/audit-logs`, []),
      ]);
      setSession(sessionData);
      setMessages(Array.isArray(messageData) ? messageData : []);
      setTasks(Array.isArray(taskData) ? taskData : []);
      setAgents(Array.isArray(agentData) ? agentData : []);
      setAuditLogs(Array.isArray(auditData) ? auditData : []);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  const visibleMessages = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => `${m.content} ${m.agentName ?? ""} ${m.agentRole ?? ""} ${m.role}`.toLowerCase().includes(q));
  }, [messages, search]);

  const isActive = session?.status === "active";
  const completedTasks = tasks.filter((task) => task.status === "complete" || task.status === "completed").length;

  const runAction = async (path: string, label: string) => {
    setBusy(true);
    try {
      const ok = await apiPost(path);
      if (!ok) toast({ title: `${label} failed`, variant: "destructive" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const openWorkspace = () => {
    setRepoUrl(session?.repoUrl ?? "");
    setRepoBranch(session?.repoBranch ?? "");
    setWorkspaceOpen(true);
  };

  const saveWorkspace = async () => {
    setBusy(true);
    try {
      const ok = await apiPost(`/api/sessions/${sessionId}/workspace`, { repoUrl: repoUrl.trim(), repoBranch: repoBranch.trim() });
      if (!ok) toast({ title: "Workspace save failed", variant: "destructive" });
      setWorkspaceOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const exportTranscript = () => {
    const lines = [`# ${session?.goal ?? "VIBA session"}`, "", ...messages.map((m) => `## ${m.role === "user" ? "You" : m.agentName || "Agent"}\n${m.content}\n`)];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `viba-session-${sessionId}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyMessage = async (content: string) => {
    await navigator.clipboard.writeText(content);
    toast({ title: "Copied" });
  };

  if (loading) return <AppLayout><Skeleton className="h-[720px] rounded-3xl" /></AppLayout>;
  if (!session) return <AppLayout><div className="rounded-3xl border border-slate-200 bg-white p-8 text-slate-600">Session not found.</div></AppLayout>;

  return (
    <AppLayout>
      <div className="min-h-[calc(100vh-8rem)] rounded-[2rem] border border-slate-200 bg-[#f6f8fb] p-3 text-slate-950 shadow-[0_20px_80px_rgba(15,23,42,0.06)] sm:p-4">
        <div className="grid min-h-[calc(100vh-10rem)] gap-4 xl:grid-cols-[1fr_320px]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
            <header className="border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={statusTone(session.status)}>{session.status}</Badge>
                    <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">{session.autonomyMode ?? "guided"}</Badge>
                    <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">{completedTasks}/{tasks.length} tasks</Badge>
                  </div>
                  <h1 className="mt-2 truncate text-xl font-semibold tracking-tight text-slate-950" title={session.goal}>{session.goal}</h1>
                  <p className="mt-1 text-sm text-slate-500">Agents write what they are doing as they work. Use the command box below to guide them.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={openWorkspace} className="border-slate-200 bg-white"><GitBranch className="mr-2 h-4 w-4" /> Workspace</Button>
                  <Button variant="outline" size="sm" onClick={exportTranscript} className="border-slate-200 bg-white"><Download className="mr-2 h-4 w-4" /> Export</Button>
                  <Link href={`/sessions/new?goal=${encodeURIComponent(session.goal)}`}><Button variant="outline" size="sm" className="border-slate-200 bg-white"><RotateCcw className="mr-2 h-4 w-4" /> Fork</Button></Link>
                  {isActive ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => void runAction(`/api/sessions/${sessionId}/run-next`, "Run next")} disabled={busy} className="border-slate-200 bg-white"><Play className="mr-2 h-4 w-4" /> Next</Button>
                      <Button size="sm" onClick={() => void runAction(`/api/sessions/${sessionId}/run-full`, "Run workflow")} disabled={busy} className="bg-slate-950 text-white hover:bg-slate-800"><FastForward className="mr-2 h-4 w-4" /> Run workflow</Button>
                      <Button variant="outline" size="sm" onClick={() => void runAction(`/api/sessions/${sessionId}/stop`, "Stop")} disabled={busy} className="border-red-200 bg-red-50 text-red-700 hover:bg-red-100"><Square className="mr-2 h-4 w-4" /> Stop</Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => void runAction(`/api/sessions/${sessionId}/reopen`, "Reopen")} disabled={busy} className="border-slate-200 bg-white"><RefreshCw className="mr-2 h-4 w-4" /> Reopen</Button>
                  )}
                </div>
              </div>
            </header>

            <div className="flex items-center gap-2 border-b border-slate-200 bg-[#fbfcfe] px-4 py-2 sm:px-5">
              <Search className="h-4 w-4 text-slate-400" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the live conversation..." className="h-9 border-0 bg-transparent shadow-none focus-visible:ring-0" />
              {busy && <Badge className="border-blue-200 bg-blue-50 text-blue-700">Working</Badge>}
            </div>

            <div className="flex-1 overflow-y-auto bg-[#fbfcfe] px-4 py-5 sm:px-5">
              {visibleMessages.length === 0 ? (
                <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center text-slate-500">
                  <MessageSquare className="mb-3 h-9 w-9 text-slate-300" />
                  <p className="font-medium text-slate-700">No messages yet.</p>
                  <p className="mt-1 max-w-md text-sm">Send an instruction or run the workflow to see agents collaborate here.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {visibleMessages.map((msg) => {
                    const isUser = msg.role === "user";
                    return (
                      <article key={msg.id} className={`max-w-[92%] rounded-3xl border p-4 shadow-sm ${isUser ? "ml-auto border-slate-200 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-950"}`}>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold">{isUser ? "You" : msg.agentName || "Agent"}</span>
                          {!isUser && msg.agentRole && <span className="text-xs text-slate-500">{msg.agentRole}</span>}
                          <span className={`ml-auto text-[11px] ${isUser ? "text-slate-300" : "text-slate-400"}`}>{formatTime(msg.createdAt)}</span>
                          <button type="button" onClick={() => void copyMessage(msg.content)} className={isUser ? "text-slate-300 hover:text-white" : "text-slate-400 hover:text-slate-900"} aria-label="Copy message"><Copy className="h-3.5 w-3.5" /></button>
                        </div>
                        {isUser ? <p className="whitespace-pre-wrap text-sm leading-6">{msg.content}</p> : <MarkdownContent content={msg.content} />}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            <footer className="border-t border-slate-200 bg-white p-3 sm:p-4">
              <AttachmentComposer sessionId={sessionId} disabled={!isActive} running={busy} onStop={() => void runAction(`/api/sessions/${sessionId}/stop`, "Stop")} onComplete={load} placeholder="Tell VIBA what to build, repair, test, research, or change..." />
            </footer>
          </section>

          <aside className="grid gap-4 xl:block xl:space-y-4">
            <SideCard title="Connected agents" icon={<Bot className="h-4 w-4" />} empty="No agents assigned.">{agents.map((agent) => <PanelRow key={agent.id} title={agent.name} detail={`${agent.provider ?? "provider"}${agent.activeModel ? ` · ${agent.activeModel}` : ""}`} />)}</SideCard>
            <SideCard title="Task board" icon={<ListChecks className="h-4 w-4" />} empty="No tasks yet.">{tasks.slice(0, 8).map((task) => <PanelRow key={task.id} title={task.title} detail={task.status} />)}</SideCard>
            <SideCard title="Activity" icon={<History className="h-4 w-4" />} empty="No activity yet.">{auditLogs.slice(-6).reverse().map((log) => <PanelRow key={log.id} title={log.eventType ?? "activity"} detail={log.description ?? ""} />)}</SideCard>
            <Card className="border-slate-200 bg-white shadow-sm"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4" /> Project boundary</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-slate-600"><p><strong className="text-slate-950">Your sandbox:</strong> {shortRepo(session.repoUrl)}</p><p className="text-xs text-slate-500">Users control only their own project workspace. VIBA source controls are admin-only.</p></CardContent></Card>
          </aside>
        </div>
      </div>

      <Dialog open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Workspace context</DialogTitle><DialogDescription>Set the project repo and branch for this user session.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2"><Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="Repository URL" /><Input value={repoBranch} onChange={(e) => setRepoBranch(e.target.value)} placeholder="Branch" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setWorkspaceOpen(false)}>Cancel</Button><Button onClick={() => void saveWorkspace()} disabled={busy}>Save workspace</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function SideCard({ title, icon, empty, children }: { title: string; icon: React.ReactNode; empty: string; children: React.ReactNode }) {
  const list = Array.isArray(children) ? children : [children];
  return <Card className="border-slate-200 bg-white shadow-sm"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm">{icon} {title}</CardTitle></CardHeader><CardContent className="space-y-2">{list.length === 0 || list.every((item) => !item) ? <p className="text-sm text-slate-500">{empty}</p> : children}</CardContent></Card>;
}

function PanelRow({ title, detail }: { title: string; detail?: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><p className="text-sm font-medium leading-5 text-slate-900">{title}</p>{detail && <p className="mt-1 truncate text-xs text-slate-500">{detail}</p>}</div>;
}
