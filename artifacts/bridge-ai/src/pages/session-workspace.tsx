import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useGetSession,
  useListMessages,
  useListTasks,
  useListAgents,
  useRunNextStep,
  useRunFullWorkflow,
  useSendMessage,
  useStopSession,
  useApproveAction,
  useListApprovals,
  useListAuditLogs,
  useGetStats,
  getGetSessionQueryKey,
  getListMessagesQueryKey,
  getListTasksQueryKey,
  getListApprovalsQueryKey,
  getListAuditLogsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Play, FastForward, Square, Send, CheckCircle2, Clock, Bot,
  Crosshair, LineChart, Zap, FlaskConical, RotateCcw, X,
  RefreshCw, History, ShieldCheck, TrendingDown, AlertTriangle,
} from "lucide-react";

const MAX_BANNER_STORAGE_KEYS = 20;

function pruneStaleLocalStorageKeys() {
  try {
    const prefix = "bridge_fallback_banner_";
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
    if (keys.length > MAX_BANNER_STORAGE_KEYS) {
      const sorted = keys.sort();
      sorted.slice(0, keys.length - MAX_BANNER_STORAGE_KEYS).forEach((k) =>
        localStorage.removeItem(k)
      );
    }
  } catch {}
}

const AGENT_COLORS: Record<string, string> = {
  "openai": "bg-green-500/10 text-green-400 border-green-500/20",
  "anthropic": "bg-orange-500/10 text-orange-400 border-orange-500/20",
  "manus": "bg-purple-500/10 text-purple-400 border-purple-500/20",
  "replit": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "google": "bg-teal-500/10 text-teal-400 border-teal-500/20",
  "perplexity": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "user": "bg-primary/10 text-primary border-primary/20",
};

const SIMULATED_PREFIX = "⚠️ [Simulated";

function getActivityDisplay(eventType: string, description: string, meta: Record<string, unknown>) {
  if (eventType === "adapter_success" && typeof meta.attempt === "number" && meta.attempt > 1) {
    return { icon: RefreshCw, color: "text-blue-400", label: `Live call succeeded on retry (attempt ${meta.attempt})` };
  }
  if (eventType === "adapter_success") {
    return { icon: Zap, color: "text-emerald-400", label: description };
  }
  if (eventType === "adapter_fallback") {
    const perm = meta.permanent === true;
    return {
      icon: FlaskConical,
      color: "text-amber-400",
      label: perm ? "Permanent auth error — skipped retry, fell back to simulation" : "Fell back to simulation after retry",
    };
  }
  if (eventType === "session_completed") {
    return { icon: CheckCircle2, color: "text-emerald-400", label: "Session completed" };
  }
  if (eventType === "approval_requested") {
    return { icon: ShieldCheck, color: "text-blue-400", label: "Approval requested" };
  }
  if (eventType === "task_assigned") {
    return { icon: Clock, color: "text-muted-foreground", label: description };
  }
  return { icon: History, color: "text-muted-foreground", label: description };
}

export default function SessionWorkspace() {
  const { id } = useParams();
  const sessionId = parseInt(id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [userInstruction, setUserInstruction] = useState("");
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<any>(null);

  // Banner dismissal — stores the count of fallback messages seen at dismissal time.
  // If new fallback messages arrive after dismissal, banner re-appears automatically.
  const storageKey = `bridge_fallback_banner_${sessionId}`;
  const [dismissedAtCount, setDismissedAtCount] = useState<number>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v ? parseInt(v, 10) : 0;
    } catch {
      return 0;
    }
  });

  // Prune stale keys from localStorage once on mount (#47)
  useEffect(() => { pruneStaleLocalStorageKeys(); }, []);

  const dismissFallbackBanner = (currentFallbackCount: number) => {
    setDismissedAtCount(currentFallbackCount);
    try {
      localStorage.setItem(storageKey, String(currentFallbackCount));
    } catch {}
  };

  // Queries
  const { data: stats } = useGetStats();

  const { data: session, isLoading: sessionLoading } = useGetSession(sessionId, {
    query: { enabled: !!sessionId, queryKey: getGetSessionQueryKey(sessionId), refetchInterval: 2000 }
  });

  const { data: messages = [] } = useListMessages(sessionId, {
    query: { enabled: !!sessionId, queryKey: getListMessagesQueryKey(sessionId), refetchInterval: 2000 }
  });

  const { data: tasks = [] } = useListTasks(sessionId, {
    query: { enabled: !!sessionId, queryKey: getListTasksQueryKey(sessionId), refetchInterval: 2000 }
  });

  const { data: agents = [] } = useListAgents(sessionId, {
    query: { enabled: !!sessionId, queryKey: ["sessions", sessionId, "agents"] as const, refetchInterval: 3000 }
  });

  const { data: approvals = [] } = useListApprovals(sessionId, {
    query: { enabled: !!sessionId, queryKey: getListApprovalsQueryKey(sessionId), refetchInterval: 2000 }
  });

  const { data: auditLogs = [] } = useListAuditLogs(sessionId, {
    query: { enabled: !!sessionId, queryKey: getListAuditLogsQueryKey(sessionId), refetchInterval: 4000 }
  });

  // Mutations
  const runNext = useRunNextStep();
  const runFull = useRunFullWorkflow();
  const stopSess = useStopSession();
  const sendMsg = useSendMessage();
  const approve = useApproveAction();

  const isSessionActive = session?.status === "active";

  // Detect fallback messages
  const fallbackMessages = messages.filter(m => m.content?.startsWith(SIMULATED_PREFIX));
  const currentFallbackCount = fallbackMessages.length;
  const hasFallbackMessages = currentFallbackCount > 0;
  const fallbackAgentNames = [...new Set(fallbackMessages.map(m => m.agentName).filter(Boolean))];
  const fallbackAgentCount = fallbackAgentNames.length;
  // Re-show banner automatically if new fallbacks arrive after user dismissed (#46)
  const showFallbackBanner = hasFallbackMessages && currentFallbackCount > dismissedAtCount;

  // Spike alert from stats API — shown in workspace too (#54)
  const recentSpikeProviders = stats?.recentSpikeProviders ?? [];
  const recentSpikeThreshold = stats?.recentSpikeThreshold ?? 5;
  const alertEnabled = stats?.alertEnabled ?? true;
  const showSpikeAlert = alertEnabled && recentSpikeProviders.length > 0;

  // Browser notification when a spike is detected (#52)
  const prevSpikeRef = useRef<string[]>([]);
  useEffect(() => {
    if (!showSpikeAlert) { prevSpikeRef.current = []; return; }
    const newProviders = recentSpikeProviders.filter(p => !prevSpikeRef.current.includes(p));
    if (newProviders.length > 0) {
      prevSpikeRef.current = recentSpikeProviders;
      if ("Notification" in window) {
        const fire = () => {
          new Notification("BridgeAI — Fallback Spike", {
            body: `${newProviders.join(", ")} hit ${recentSpikeThreshold}+ fallbacks in the last hour. Check your API keys.`,
            icon: "/favicon.ico",
          });
        };
        if (Notification.permission === "granted") {
          fire();
        } else if (Notification.permission !== "denied") {
          Notification.requestPermission().then(perm => { if (perm === "granted") fire(); });
        }
      }
    }
  }, [showSpikeAlert, recentSpikeProviders.join(",")]);

  // Activity log: show notable events (retry, fallback, success, completed)
  const activityEvents = [...auditLogs]
    .reverse()
    .filter(log =>
      log.eventType === "adapter_fallback" ||
      log.eventType === "adapter_success" ||
      log.eventType === "session_completed" ||
      log.eventType === "approval_requested"
    )
    .slice(0, 15);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const pending = approvals.find(a => a.status === "pending");
    if (pending && !showApprovalModal) {
      setPendingApproval(pending);
      setShowApprovalModal(true);
    } else if (!pending) {
      setShowApprovalModal(false);
      setPendingApproval(null);
    }
  }, [approvals, showApprovalModal]);

  const handleRunNext = () => {
    runNext.mutate({ id: sessionId }, {
      onSuccess: () => invalidateAll(),
      onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to run step", variant: "destructive" })
    });
  };

  const handleRunFull = () => {
    runFull.mutate({ id: sessionId }, {
      onSuccess: () => invalidateAll(),
      onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to run workflow", variant: "destructive" })
    });
  };

  const handleStop = () => {
    stopSess.mutate({ id: sessionId }, {
      onSuccess: () => invalidateAll(),
      onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to stop", variant: "destructive" })
    });
  };

  const handleSend = () => {
    if (!userInstruction.trim()) return;
    sendMsg.mutate({ id: sessionId, data: { content: userInstruction } }, {
      onSuccess: () => {
        setUserInstruction("");
        invalidateAll();
      },
      onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to send message", variant: "destructive" })
    });
  };

  const handleApprove = () => {
    if (!pendingApproval) return;
    approve.mutate({ id: sessionId, data: { approvalId: pendingApproval.id } }, {
      onSuccess: () => {
        setShowApprovalModal(false);
        setPendingApproval(null);
        invalidateAll();
        toast({ title: "Approved", description: "Action approved successfully." });
      },
      onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to approve", variant: "destructive" })
    });
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(sessionId) });
    queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(sessionId) });
    queryClient.invalidateQueries({ queryKey: getListApprovalsQueryKey(sessionId) });
    queryClient.invalidateQueries({ queryKey: getListAuditLogsQueryKey(sessionId) });
  };

  const tasksByStatus = {
    planned: tasks.filter(t => t.status === "planned"),
    in_progress: tasks.filter(t => t.status === "in_progress"),
    review: tasks.filter(t => t.status === "review"),
    complete: tasks.filter(t => t.status === "complete")
  };

  const liveAgentCount = agents.filter(a => !a.isMock).length;
  const simAgentCount = agents.filter(a => a.isMock).length;

  if (sessionLoading || !session) {
    return (
      <AppLayout>
        <div className="flex h-full items-center justify-center">
          <Skeleton className="w-full h-[600px] rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-8rem)] gap-4">
        {/* Spike alert — shown in workspace when a provider hits the threshold in the last hour (#54) */}
        {showSpikeAlert && (
          <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300 shrink-0">
            <TrendingDown className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
            <div className="flex-1">
              <span className="font-semibold">Fallback spike alert — </span>
              {recentSpikeProviders.length === 1
                ? `The ${recentSpikeProviders[0]} provider`
                : `Providers ${recentSpikeProviders.join(", ")}`}{" "}
              {recentSpikeProviders.length === 1 ? "has" : "have"} hit {recentSpikeThreshold}+ fallbacks in the last hour.{" "}
              <Link href="/settings" className="underline underline-offset-2 hover:text-red-200">
                Check your API keys
              </Link>
              .
            </div>
          </div>
        )}

        {/* Simulation fallback banner — re-shows if new fallbacks arrive after dismissal (#46) */}
        {showFallbackBanner && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300 shrink-0">
            <RotateCcw className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="flex-1">
              <span className="font-semibold">
                {fallbackAgentCount <= 1 ? "An agent" : `${fallbackAgentCount} agents`} switched to simulation mid-run
              </span>{" "}
              — the live API call was retried before falling back to simulation.
              Simulated messages are marked with a{" "}
              <span className="inline-flex items-center gap-0.5 font-medium text-amber-400">
                <FlaskConical className="h-3 w-3" /> Simulated
              </span>{" "}
              badge. Check your API keys if you expected a live response.
            </span>
            <button
              onClick={() => dismissFallbackBanner(currentFallbackCount)}
              className="shrink-0 rounded p-0.5 hover:bg-amber-500/20 transition-colors"
              aria-label="Dismiss banner"
            >
              <X className="h-4 w-4 text-amber-400" />
            </button>
          </div>
        )}

        {/* Header Bar */}
        <div className="flex items-center justify-between bg-card border rounded-lg p-4 shadow-sm shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            <h1 className="font-bold text-lg truncate max-w-[300px]" title={session.goal}>{session.goal}</h1>
            <Badge variant="outline" className="capitalize">{session.status}</Badge>
            <Badge variant="secondary">{session.autonomyMode}</Badge>
            {agents.length > 0 && (
              <div className="flex items-center gap-1.5">
                {liveAgentCount > 0 && (
                  <Badge className="text-[11px] h-5 px-2 gap-1 bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20">
                    <Zap className="h-3 w-3" /> {liveAgentCount} Live
                  </Badge>
                )}
                {simAgentCount > 0 && (
                  <Badge variant="outline" className="text-[11px] h-5 px-2 gap-1 text-muted-foreground">
                    <FlaskConical className="h-3 w-3" /> {simAgentCount} Sim
                  </Badge>
                )}
              </div>
            )}
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <Clock className="w-4 h-4" />
              Est. Cost: ${session.estimatedCost?.toFixed(4) || "0.0000"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isSessionActive && (
              <>
                <Button size="sm" variant="outline" onClick={handleRunNext} disabled={runNext.isPending || !!pendingApproval}>
                  <Play className="w-4 h-4 mr-2" /> Next Step
                </Button>
                {session.autonomyMode !== "Manual" && (
                  <Button size="sm" onClick={handleRunFull} disabled={runFull.isPending || !!pendingApproval}>
                    <FastForward className="w-4 h-4 mr-2" /> Run Workflow
                  </Button>
                )}
                <Button size="sm" variant="destructive" onClick={handleStop} disabled={stopSess.isPending}>
                  <Square className="w-4 h-4 mr-2" /> Stop
                </Button>
              </>
            )}
            {!isSessionActive && session.status !== "completed" && (
              <Badge variant="secondary">Session {session.status}</Badge>
            )}
          </div>
        </div>

        {/* 3 Column Layout */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">

          {/* Left: Info & Agents (3 cols) */}
          <div className="lg:col-span-3 flex flex-col gap-4 overflow-y-auto pr-1">
            <Card className="shrink-0">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Crosshair className="w-4 h-4" /> Goal
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 text-sm text-muted-foreground">
                {session.goal}
              </CardContent>
            </Card>

            <Card className="flex-1 min-h-0 flex flex-col">
              <CardHeader className="p-4 pb-2 shrink-0">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Bot className="w-4 h-4" /> Connected Agents
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 overflow-y-auto">
                <div className="flex flex-col gap-2">
                  {agents.map(agent => {
                    const isLive = !agent.isMock;
                    return (
                      <div key={agent.id} className="flex flex-col p-2 rounded border bg-muted/30">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold text-sm truncate">{agent.name}</span>
                          {isLive ? (
                            <Badge className="text-[10px] h-4 px-1.5 gap-0.5 bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20 shrink-0">
                              <Zap className="h-2.5 w-2.5" /> Live
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-0.5 text-muted-foreground shrink-0">
                              <FlaskConical className="h-2.5 w-2.5" /> Sim
                            </Badge>
                          )}
                        </div>
                        <div className="flex justify-between items-center mt-1">
                          <Badge variant="outline" className="text-[10px] h-4">{agent.provider}</Badge>
                          <span className="text-xs text-muted-foreground">{agent.role}</span>
                        </div>
                        {agent.activeModel && (
                          <div className="mt-1.5 pt-1.5 border-t border-border/50">
                            <span className="text-[10px] text-muted-foreground font-mono bg-muted/60 rounded px-1.5 py-0.5">
                              {agent.activeModel}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Center: Conversation Thread (6 cols) */}
          <Card className="lg:col-span-6 flex flex-col min-h-0">
            <CardHeader className="p-4 border-b shrink-0">
              <CardTitle className="text-sm flex items-center gap-2">
                <LineChart className="w-4 h-4" /> Live Collaboration
              </CardTitle>
            </CardHeader>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4" ref={scrollRef as any}>
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-muted-foreground text-sm italic">
                  No messages yet. Start the session to see collaboration.
                </div>
              ) : (
                messages.map(msg => {
                  const isUser = msg.role === "user";
                  const isSimulated = !isUser && msg.content?.startsWith(SIMULATED_PREFIX);
                  const colorClass = isUser
                    ? AGENT_COLORS["user"]
                    : isSimulated
                      ? "bg-amber-500/10 text-amber-200 border-amber-500/30"
                      : (msg.provider ? AGENT_COLORS[msg.provider] : "bg-muted text-foreground border-border");

                  const displayContent = isSimulated
                    ? msg.content.replace(/^⚠️ \[Simulated — live \S+ API unavailable\] /, "")
                    : msg.content;

                  return (
                    <div key={msg.id} className={`flex flex-col max-w-[85%] rounded-lg border p-3 ${colorClass} ${isUser ? "self-end" : "self-start"}`}>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold text-xs">{isUser ? "You" : msg.agentName || "System"}</span>
                        {!isUser && msg.agentRole && <span className="text-[10px] opacity-70">| {msg.agentRole}</span>}
                        {!isUser && msg.model && (
                          <span className="text-[10px] opacity-60 font-mono bg-black/10 rounded px-1">{msg.model}</span>
                        )}
                        {isSimulated && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-0.5 text-amber-400 border-amber-500/40">
                            <FlaskConical className="h-2.5 w-2.5" /> Simulated
                          </Badge>
                        )}
                        <span className="text-[10px] opacity-50 ml-auto">{format(new Date(msg.createdAt), "HH:mm:ss")}</span>
                      </div>
                      <div className="text-sm whitespace-pre-wrap leading-relaxed">{displayContent}</div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t shrink-0 bg-muted/10">
              <div className="flex gap-2">
                <Textarea
                  placeholder="Send an instruction or provide feedback to the agents..."
                  className="min-h-[60px] resize-none"
                  value={userInstruction}
                  onChange={(e) => setUserInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  disabled={!isSessionActive}
                />
                <Button className="h-auto w-12 shrink-0" onClick={handleSend} disabled={!isSessionActive || !userInstruction.trim() || sendMsg.isPending}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>

          {/* Right: Task Board + Activity Log (3 cols) */}
          <div className="lg:col-span-3 flex flex-col gap-4 min-h-0">
            <Card className="flex-1 flex flex-col min-h-0 bg-muted/20">
              <CardHeader className="p-4 border-b shrink-0 bg-card">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Task Board
                </CardTitle>
              </CardHeader>
              <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-4">
                {(['planned', 'in_progress', 'review', 'complete'] as const).map(status => {
                  const columnTasks = tasksByStatus[status];
                  if (columnTasks.length === 0 && status !== 'planned') return null;

                  return (
                    <div key={status} className="flex flex-col gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 flex items-center gap-2">
                        {status.replace('_', ' ')}
                        <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">{columnTasks.length}</Badge>
                      </div>
                      {columnTasks.map(task => (
                        <div key={task.id} className="bg-card border rounded p-2 text-sm shadow-sm">
                          <div className="font-medium line-clamp-2 leading-tight">{task.title}</div>
                          {task.assignedAgentId && (() => {
                            const assignedAgent = agents.find(a => a.id === task.assignedAgentId);
                            return (
                              <div className="text-[10px] text-muted-foreground mt-2 pt-2 border-t flex justify-between items-center">
                                <span>Assigned to: {assignedAgent?.name || 'Unknown'}</span>
                                {assignedAgent && (
                                  assignedAgent.isMock ? (
                                    <Badge variant="outline" className="text-[9px] h-3.5 px-1 gap-0.5 text-muted-foreground">
                                      <FlaskConical className="h-2 w-2" /> Sim
                                    </Badge>
                                  ) : (
                                    <Badge className="text-[9px] h-3.5 px-1 gap-0.5 bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20">
                                      <Zap className="h-2 w-2" /> Live
                                    </Badge>
                                  )
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                      {columnTasks.length === 0 && status === 'planned' && (
                        <div className="border border-dashed rounded p-3 text-center text-xs text-muted-foreground">
                          No tasks planned yet
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Activity Log */}
            {activityEvents.length > 0 && (
              <Card className="shrink-0 bg-muted/10">
                <CardHeader className="p-3 pb-2 border-b">
                  <CardTitle className="text-xs flex items-center gap-2 text-muted-foreground">
                    <History className="w-3.5 h-3.5" /> Activity Log
                  </CardTitle>
                </CardHeader>
                <div className="p-2 flex flex-col gap-1 max-h-48 overflow-y-auto">
                  {activityEvents.map(log => {
                    const meta = (log.metadata ?? {}) as Record<string, unknown>;
                    const { icon: Icon, color, label } = getActivityDisplay(log.eventType, log.description, meta);
                    return (
                      <div key={log.id} className="flex items-start gap-2 px-1 py-0.5">
                        <Icon className={`h-3 w-3 mt-0.5 shrink-0 ${color}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-[10px] leading-tight ${color}`}>{label}</p>
                          <p className="text-[9px] text-muted-foreground/60 mt-0.5">
                            {format(new Date(log.createdAt), "HH:mm:ss")}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Approval Modal */}
      <Dialog open={showApprovalModal} onOpenChange={setShowApprovalModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-500">
              <AlertTriangle className="h-5 w-5" /> Approval Required
            </DialogTitle>
            <DialogDescription>
              The agents have requested approval before proceeding.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="font-semibold text-sm mb-1">{pendingApproval?.type || 'Action'}</div>
            <div className="text-sm bg-muted p-3 rounded-md">{pendingApproval?.description}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApprovalModal(false)}>Review Manually</Button>
            <Button onClick={handleApprove} disabled={approve.isPending}>
              {approve.isPending ? "Approving..." : "Approve & Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
