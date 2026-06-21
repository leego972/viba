import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FastForward,
  GitBranch,
  History,
  ListChecks,
  MessageSquare,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Square,
} from "lucide-react";
import {
  getGetSessionQueryKey,
  getListAgentsQueryKey,
  getListApprovalsQueryKey,
  getListAuditLogsQueryKey,
  getListMessagesQueryKey,
  getListTasksQueryKey,
  useAnswerQuestion,
  useApproveAction,
  useGetSession,
  useListAgents,
  useListApprovals,
  useListAuditLogs,
  useListMessages,
  useListTasks,
  useRunFullWorkflow,
  useRunNextStep,
  useStopSession,
  useUpdateSession,
} from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { MarkdownContent } from "@/components/MarkdownContent";
import { AttachmentComposer } from "@/components/session/AttachmentComposer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

function formatTime(value?: string | Date | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : format(date, "HH:mm:ss");
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
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, "").replace(/\.git$/, "");
  } catch {
    return url;
  }
}

export default function SessionWorkspaceClinical() {
  const { id } = useParams();
  const sessionId = Number.parseInt(id || "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoBranch, setRepoBranch] = useState("");
  const [workspaceEnv, setWorkspaceEnv] = useState("none");
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [rejectText, setRejectText] = useState("");

  const { data: session, isLoading } = useGetSession(sessionId, { query: { enabled: !!sessionId, queryKey: getGetSessionQueryKey(sessionId) } });
  const { data: messages = [] } = useListMessages(sessionId, undefined, { query: { enabled: !!sessionId, queryKey: getListMessagesQueryKey(sessionId) } });
  const { data: tasks = [] } = useListTasks(sessionId, { query: { enabled: !!sessionId, queryKey: getListTasksQueryKey(sessionId) } });
  const { data: agents = [] } = useListAgents(sessionId, { query: { enabled: !!sessionId, queryKey: getListAgentsQueryKey(sessionId) } });
  const { data: approvals = [] } = useListApprovals(sessionId, { query: { enabled: !!sessionId, queryKey: getListApprovalsQueryKey(sessionId) } });
  const { data: auditLogs = [] } = useListAuditLogs(sessionId, { query: { enabled: !!sessionId, queryKey: getListAuditLogsQueryKey(sessionId) } });

  const runNext = useRunNextStep();
  const runFull = useRunFullWorkflow();
  const stopSession = useStopSession();
  const approve = useApproveAction();
  const updateSession = useUpdateSession();
  const answerQuestion = useAnswerQuestion();

  const isRunning = runNext.isPending || runFull.isPending;
  const isActive = session?.status === "active";
  const pendingApproval = approvals.find((item) => item.status === "pending") ?? null;
  const completedTasks = tasks.filter((task) => task.status === "complete").length;

  const visibleMessages = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((message) => [message.content, message.agentName, message.agentRole, message.role].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [messages, search]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(sessionId) });
    queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(sessionId) });
    queryClient.invalidateQueries({ queryKey: getListApprovalsQueryKey(sessionId) });
    queryClient.invalidateQueries({ queryKey: getListAuditLogsQueryKey(sessionId) });
  };

  const openWorkspaceEditor = () => {
    setRepoUrl(session?.repoUrl ?? "");
    setRepoBranch(session?.repoBranch ?? "");
    setWorkspaceEnv(session?.workspaceEnv ?? "none");
    setWorkspaceOpen(true);
  };

  const saveWorkspace = () => {
    updateSession.mutate({ id: sessionId, data: { repoUrl: repoUrl.trim() || null, repoBranch: repoBranch.trim() || null, workspaceEnv: workspaceEnv === "none" ? null : workspaceEnv } }, {
      onSuccess: () => {
        setWorkspaceOpen(false);
        invalidateAll();
        toast({ title: "Workspace saved", description: "Project context updated." });
      },
      onError: (error: unknown) => toast({ title: "Save failed", description: error instanceof Error ? error.message : "Unable to save workspace context.", variant: "destructive" }),
    });
  };

  const handleRunNext = () => runNext.mutate({ id: sessionId }, { onSuccess: invalidateAll });
  const handleRunFull = () => runFull.mutate({ id: sessionId }, { onSuccess: invalidateAll });
  const handleStop = () => stopSession.mutate({ id: sessionId }, { onSuccess: invalidateAll });

  const handleReopen = async () => {
    const response = await fetch(`/api/sessions/${sessionId}/reopen`, { method: "POST", credentials: "include" });
    if (!response.ok) {
      toast({ title: "Reopen failed", description: "Session could not be reopened.", variant: "destructive" });
      return;
    }
    invalidateAll();
  };

  const handleApprove = () => {
    if (!pendingApproval) return;
    approve.mutate({ id: sessionId, data: { approvalId: pendingApproval.id } }, { onSuccess: invalidateAll });
  };

  const handleReject = async () => {
    if (!pendingApproval) return;
    const response = await fetch(`/api/sessions/${sessionId}/reject-approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ approvalId: pendingApproval.id, rejectedReason: rejectText }),
    });
    if (!response.ok) {
      toast({ title: "Reject failed", description: "Approval could not be rejected.", variant: "destructive" });
      return;
    }
    setRejectText("");
    invalidateAll();
  };

  const handleReply = (messageId: number) => {
    if (!replyText.trim()) return;
    answerQuestion.mutate({ id: sessionId, messageId, data: { content: replyText.trim() } }, {
      onSuccess: () => {
        setReplyText("");
        setReplyingTo(null);
        invalidateAll();
      },
    });
  };

  const copyMessage = async (content: string) => {
    await navigator.clipboard.writeText(content);
    toast({ title: "Copied" });
  };

  const exportTranscript = () => {
    if (!session) return;
    const lines = [`# ${session.goal}`, "", `Status: ${session.status}`, "", "## Conversation", ""];
    for (const msg of messages) {
      lines.push(`### ${msg.role === "user" ? "You" : msg.agentName || "System"} ${formatTime(msg.createdAt)}`);
      lines.push(msg.content || "");
      lines.push("");
    }
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

  if (isLoading || !session) {
    return <AppLayout><Skeleton className="h-[720px] rounded-3xl" /></AppLayout>;
  }

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
                    <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">{session.autonomyMode}</Badge>
                    <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">{completedTasks}/{tasks.length} tasks</Badge>
                  </div>
                  <h1 className="mt-2 truncate text-xl font-semibold tracking-tight text-slate-950" title={session.goal}>{session.goal}</h1>
                  <p className="mt-1 text-sm text-slate-500">Agents write what they are doing as they work. Use the command box below to guide them.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={openWorkspaceEditor} className="border-slate-200 bg-white"><GitBranch className="mr-2 h-4 w-4" /> Workspace</Button>
                  <Button variant="outline" size="sm" onClick={exportTranscript} className="border-slate-200 bg-white"><Download className="mr-2 h-4 w-4" /> Export</Button>
                  <Link href={`/sessions/new?goal=${encodeURIComponent(session.goal)}`}><Button variant="outline" size="sm" className="border-slate-200 bg-white"><RotateCcw className="mr-2 h-4 w-4" /> Fork</Button></Link>
                  {isActive ? (
                    <>
                      <Button variant="outline" size="sm" onClick={handleRunNext} disabled={runNext.isPending || !!pendingApproval} className="border-slate-200 bg-white"><Play className="mr-2 h-4 w-4" /> Next</Button>
                      <Button size="sm" onClick={handleRunFull} disabled={runFull.isPending || !!pendingApproval} className="bg-slate-950 text-white hover:bg-slate-800"><FastForward className="mr-2 h-4 w-4" /> Run workflow</Button>
                      <Button variant="outline" size="sm" onClick={handleStop} disabled={stopSession.isPending} className="border-red-200 bg-red-50 text-red-700 hover:bg-red-100"><Square className="mr-2 h-4 w-4" /> Stop</Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => void handleReopen()} className="border-slate-200 bg-white"><RefreshCw className="mr-2 h-4 w-4" /> Reopen</Button>
                  )}
                </div>
              </div>
            </header>

            {pendingApproval && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 sm:px-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-800"><AlertTriangle className="h-4 w-4" /> Approval required</div>
                    <p className="mt-1 text-sm text-amber-700">{pendingApproval.description}</p>
                    <Textarea value={rejectText} onChange={(event) => setRejectText(event.target.value)} placeholder="Optional rejection reason..." className="mt-2 min-h-[52px] border-amber-200 bg-white text-sm" />
                  </div>
                  <div className="flex gap-2 lg:pt-6">
                    <Button variant="outline" className="border-amber-300 bg-white text-amber-800" onClick={() => void handleReject()}>Reject</Button>
                    <Button className="bg-amber-700 text-white hover:bg-amber-800" onClick={handleApprove}>Approve</Button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 border-b border-slate-200 bg-[#fbfcfe] px-4 py-2 sm:px-5">
              <Search className="h-4 w-4 text-slate-400" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the live conversation..." className="h-9 border-0 bg-transparent shadow-none focus-visible:ring-0" />
              {isRunning && <Badge className="border-blue-200 bg-blue-50 text-blue-700">Agents working</Badge>}
            </div>

            <div className="flex-1 overflow-y-auto bg-[#fbfcfe] px-4 py-5 sm:px-5">
              {visibleMessages.length === 0 ? (
                <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center text-slate-500">
                  <MessageSquare className="mb-3 h-9 w-9 text-slate-300" />
                  <p className="font-medium text-slate-700">No messages yet.</p>
                  <p className="mt-1 max-w-md text-sm">Send an instruction or run the workflow to see the agents collaborate here.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {visibleMessages.map((msg) => {
                    const isUser = msg.role === "user";
                    const isQuestionForUser = (msg.messageType ?? "output") === "question" && !isUser && !msg.toAgentId;
                    return (
                      <article key={msg.id} className={`group max-w-[92%] rounded-3xl border p-4 shadow-sm ${isUser ? "ml-auto border-slate-200 bg-slate-950 text-white" : isQuestionForUser ? "border-violet-200 bg-violet-50 text-slate-950" : "border-slate-200 bg-white text-slate-950"}`}>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold">{isUser ? "You" : msg.agentName || "System"}</span>
                          {!isUser && msg.agentRole && <span className="text-xs text-slate-500">{msg.agentRole}</span>}
                          {msg.toAgentName && <Badge variant="outline" className="border-slate-200 bg-white text-slate-500">to {msg.toAgentName}</Badge>}
                          {isQuestionForUser && <Badge className="border-violet-200 bg-violet-100 text-violet-800">Needs your input</Badge>}
                          <span className={`ml-auto text-[11px] ${isUser ? "text-slate-300" : "text-slate-400"}`}>{formatTime(msg.createdAt)}</span>
                          <button type="button" onClick={() => void copyMessage(msg.content || "")} className={isUser ? "text-slate-300 hover:text-white" : "text-slate-400 hover:text-slate-900"} aria-label="Copy message"><Copy className="h-3.5 w-3.5" /></button>
                        </div>
                        {isUser ? <p className="whitespace-pre-wrap text-sm leading-6">{msg.content}</p> : <MarkdownContent content={msg.content || ""} />}
                        {isQuestionForUser && (
                          <div className="mt-3 border-t border-violet-200 pt-3">
                            {replyingTo === msg.id ? (
                              <div className="space-y-2">
                                <Textarea value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder="Reply to this agent question..." className="min-h-[64px] border-violet-200 bg-white" />
                                <div className="flex justify-end gap-2">
                                  <Button variant="outline" size="sm" onClick={() => { setReplyingTo(null); setReplyText(""); }}>Cancel</Button>
                                  <Button size="sm" onClick={() => handleReply(msg.id)}><Send className="mr-2 h-4 w-4" /> Reply</Button>
                                </div>
                              </div>
                            ) : (
                              <Button variant="outline" size="sm" className="border-violet-200 bg-white text-violet-800" onClick={() => setReplyingTo(msg.id)}><Send className="mr-2 h-4 w-4" /> Reply to question</Button>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            <footer className="border-t border-slate-200 bg-white p-3 sm:p-4">
              <AttachmentComposer
                sessionId={sessionId}
                disabled={!isActive}
                running={isRunning}
                onStop={handleStop}
                onComplete={invalidateAll}
                placeholder="Tell VIBA what to build, repair, test, research, or change..."
              />
            </footer>
          </section>

          <aside className="grid gap-4 xl:block xl:space-y-4">
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Bot className="h-4 w-4" /> Connected agents</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {agents.length === 0 ? <p className="text-sm text-slate-500">No agents assigned.</p> : agents.map((agent) => (
                  <div key={agent.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{agent.name}</p>
                      <Badge variant="outline" className={agent.isMock ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>{agent.isMock ? "Sim" : "Live"}</Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">{agent.provider}{agent.activeModel ? ` · ${agent.activeModel}` : ""}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><ListChecks className="h-4 w-4" /> Task board</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {tasks.length === 0 ? <p className="text-sm text-slate-500">No tasks yet.</p> : tasks.slice(0, 8).map((task) => (
                  <div key={task.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-5 text-slate-900">{task.title}</p>
                      <Badge variant="outline" className="border-slate-200 bg-white text-[10px] text-slate-500">{task.status}</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><History className="h-4 w-4" /> Activity</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {auditLogs.length === 0 ? <p className="text-sm text-slate-500">No activity yet.</p> : auditLogs.slice(-6).reverse().map((log) => (
                  <div key={log.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    <div className="flex items-center gap-2 font-medium text-slate-800"><CheckCircle2 className="h-3.5 w-3.5 text-teal-600" /> {log.eventType}</div>
                    <p className="mt-1 text-slate-500">{log.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4" /> Project boundary</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-600">
                <p><strong className="text-slate-950">Your sandbox:</strong> {shortRepo(session.repoUrl)}</p>
                {session.repoUrl && <a href={session.repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-700 hover:underline">Open repo <ExternalLink className="h-3.5 w-3.5" /></a>}
                <p className="text-xs text-slate-500">Users control only their own project workspace. VIBA source controls are admin-only.</p>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>

      <Dialog open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4" /> Workspace context</DialogTitle>
            <DialogDescription>Set the project repo, branch, and environment for this user session.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><label className="text-sm font-medium">Repository URL</label><Input value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="https://github.com/owner/repo" /></div>
            <div className="space-y-1.5"><label className="text-sm font-medium">Branch</label><Input value={repoBranch} onChange={(event) => setRepoBranch(event.target.value)} placeholder="main" /></div>
            <div className="space-y-1.5"><label className="text-sm font-medium">Environment</label><Select value={workspaceEnv} onValueChange={setWorkspaceEnv}><SelectTrigger><SelectValue placeholder="Select environment" /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="development">Development</SelectItem><SelectItem value="staging">Staging</SelectItem><SelectItem value="production">Production</SelectItem></SelectContent></Select></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWorkspaceOpen(false)}>Cancel</Button>
            <Button onClick={saveWorkspace} disabled={updateSession.isPending}>Save workspace</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
