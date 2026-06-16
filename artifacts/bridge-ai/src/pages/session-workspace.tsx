import { useCallback, useEffect, useRef, useState } from "react";
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
  useGetBannerDismissal,
  useDismissBanner,
  getGetSessionQueryKey,
  getListMessagesQueryKey,
  getListTasksQueryKey,
  getListApprovalsQueryKey,
  getListAuditLogsQueryKey,
  getGetBannerDismissalQueryKey,
  getGetStatsQueryKey,
  type Approval,
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
  Download, Brain, Copy,
} from "lucide-react";
import { useSessionStream } from "@/hooks/useSessionStream";
import { MarkdownContent } from "@/components/MarkdownContent";
import {
  SIMULATED_PREFIX,
  pruneStaleLocalStorageKeys,
} from "@/lib/bannerLogic";
import {
  computeShowSpikeAlert,
  computeUndismissedProviders,
  pruneStaleSpikeDismissalKeys,
  readDismissedSpikeProviders,
  writeDismissedSpikeProviders,
  broadcastSpikeDismissal,
  subscribeToSpikeDismissals,
} from "@/lib/spikeAlertLogic";

const AGENT_COLORS: Record<string, string> = {
  "openai": "bg-green-500/10 text-green-400 border-green-500/20",
  "anthropic": "bg-orange-500/10 text-orange-400 border-orange-500/20",
  "manus": "bg-purple-500/10 text-purple-400 border-purple-500/20",
  "replit": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "google": "bg-teal-500/10 text-teal-400 border-teal-500/20",
  "perplexity": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "user": "bg-primary/10 text-primary border-primary/20",
};

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
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<Approval | null>(null);

  // Prune stale keys from localStorage once on mount (#47)
  useEffect(() => {
    pruneStaleLocalStorageKeys();
    pruneStaleSpikeDismissalKeys();
  }, []);

  // Banner dismissal — persisted server-side so it works across devices.
  // On first load we migrate any existing localStorage value to the server.
  const bannerQueryKey = getGetBannerDismissalQueryKey(sessionId);
  const dismissBannerMutation = useDismissBanner({
    mutation: {
      onSuccess: (data) => {
        // Immediately sync the cache so the banner hides without a round-trip refetch.
        queryClient.setQueryData(bannerQueryKey, data);
      },
    },
  });
  const { data: bannerDismissalData } = useGetBannerDismissal(sessionId, {
    query: {
      enabled: !!sessionId,
      queryKey: bannerQueryKey,
    },
  });

  // Migrate existing localStorage dismissal to the server (runs once when the
  // server reports no dismissal for this session).
  useEffect(() => {
    if (!sessionId) return;
    if (bannerDismissalData === undefined) return;
    if (bannerDismissalData.dismissedAt !== null) return;
    const storageKey = `bridge_fallback_banner_${sessionId}`;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored && !isNaN(Date.parse(stored))) {
        // Pass the original timestamp so the banner re-show comparison
        // (latestFallbackTimestamp > dismissedAt) is preserved correctly.
        dismissBannerMutation.mutate(
          { id: sessionId, data: { dismissedAt: stored } },
          {
            onSuccess: () => {
              // Remove the now-migrated legacy key so it doesn't linger.
              try { localStorage.removeItem(storageKey); } catch {}
            },
          },
        );
      }
    } catch {
      // localStorage unavailable — nothing to migrate
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, bannerDismissalData?.dismissedAt]);

  const dismissedAt = bannerDismissalData?.dismissedAt ?? null;

  const dismissFallbackBanner = () => {
    dismissBannerMutation.mutate({ id: sessionId, data: {} });
  };

  // Real-time SSE stream — pushes all session data updates at ~800 ms intervals,
  // populating the React Query cache so all queries below stay fresh without polling.
  useSessionStream(sessionId);

  // Queries — no refetchInterval needed; SSE keeps the cache fresh
  // Stats are polled every 30 s so the spike threshold and recentSpikeProviders
  // stay current even when the operator changes the threshold from another tab.
  const { data: stats } = useGetStats({
    query: { queryKey: getGetStatsQueryKey(), refetchInterval: 30_000 },
  });

  const { data: session, isLoading: sessionLoading } = useGetSession(sessionId, {
    query: { enabled: !!sessionId, queryKey: getGetSessionQueryKey(sessionId) }
  });

  const { data: messages = [] } = useListMessages(sessionId, {
    query: { enabled: !!sessionId, queryKey: getListMessagesQueryKey(sessionId) }
  });

  const { data: tasks = [] } = useListTasks(sessionId, {
    query: { enabled: !!sessionId, queryKey: getListTasksQueryKey(sessionId) }
  });

  const { data: agents = [] } = useListAgents(sessionId, {
    query: { enabled: !!sessionId, queryKey: ["sessions", sessionId, "agents"] as const }
  });

  const { data: approvals = [] } = useListApprovals(sessionId, {
    query: { enabled: !!sessionId, queryKey: getListApprovalsQueryKey(sessionId) }
  });

  const { data: auditLogs = [] } = useListAuditLogs(sessionId, {
    query: { enabled: !!sessionId, queryKey: getListAuditLogsQueryKey(sessionId) }
  });

  // Mutations
  const runNext = useRunNextStep();
  const runFull = useRunFullWorkflow();
  const stopSess = useStopSession();
  const sendMsg = useSendMessage();
  const approve = useApproveAction();

  const isSessionActive = session?.status === "active";
  const isSessionComplete = session?.status === "completed";

  // Memory from SSE-enriched session data
  const sessionMemory = session?.memory ?? null;

  // Detect fallback messages
  const fallbackMessages = messages.filter(m => m.content?.startsWith(SIMULATED_PREFIX));
  const hasFallbackMessages = fallbackMessages.length > 0;
  const fallbackAgentNames = [...new Set(fallbackMessages.map(m => m.agentName).filter(Boolean))];
  const fallbackAgentCount = fallbackAgentNames.length;
  const latestFallbackTimestamp = fallbackMessages.reduce<string | null>((latest, m) => {
    if (!m.createdAt) return latest;
    return latest === null || m.createdAt > latest ? m.createdAt : latest;
  }, null);
  const showFallbackBanner = hasFallbackMessages && (
    dismissedAt === null || (latestFallbackTimestamp !== null && latestFallbackTimestamp > dismissedAt)
  );

  // Spike alert from stats API
  const recentSpikeProviders = stats?.recentSpikeProviders ?? [];
  const recentSpikeThreshold = stats?.recentSpikeThreshold ?? 5;
  const alertEnabled = stats?.alertEnabled ?? true;
  // Spike alert dismiss — localStorage so dismissals survive page reloads
  const [dismissedSpikeProviders, setDismissedSpikeProviders] = useState<string[]>(() =>
    readDismissedSpikeProviders(sessionId)
  );

  // Reload dismissal state from localStorage if sessionId changes without remount
  useEffect(() => {
    setDismissedSpikeProviders(readDismissedSpikeProviders(sessionId));
  }, [sessionId]);

  const dismissSpikeAlert = () => {
    setDismissedSpikeProviders(recentSpikeProviders);
    writeDismissedSpikeProviders(sessionId, recentSpikeProviders);
    broadcastSpikeDismissal(sessionId, recentSpikeProviders);
  };

  // Cross-tab sync — when another tab dismisses the spike alert, update this tab too
  useEffect(() => {
    return subscribeToSpikeDismissals((msg) => {
      if (msg.sessionId === sessionId) {
        setDismissedSpikeProviders(msg.providers);
      }
    });
  }, [sessionId]);

  // Re-show if a new provider appears that wasn't dismissed
  const undismissedSpikeProviders = computeUndismissedProviders(recentSpikeProviders, dismissedSpikeProviders);
  const showSpikeAlert = computeShowSpikeAlert(alertEnabled, recentSpikeProviders, dismissedSpikeProviders);

  // Browser notification when a spike is detected
  const prevSpikeRef = useRef<string[]>([]);
  useEffect(() => {
    if (!showSpikeAlert) { prevSpikeRef.current = []; return; }
    const newProviders = recentSpikeProviders.filter(p => !prevSpikeRef.current.includes(p));
    if (newProviders.length > 0) {
      prevSpikeRef.current = recentSpikeProviders;
      if ("Notification" in window) {
        const fire = () => {
          new Notification("VIBA — Fallback Spike", {
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

  // Activity log
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
    if (isAtBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isAtBottom]);

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

  const handleMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const copyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      toast({ title: "Copied" });
    });
  }, [toast]);

  const handleRunNext = () => {
    runNext.mutate({ id: sessionId }, {
      onSuccess: () => invalidateAll(),
      onError: (err: unknown) => toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to run step", variant: "destructive" })
    });
  };

  const handleRunFull = () => {
    runFull.mutate({ id: sessionId }, {
      onSuccess: () => invalidateAll(),
      onError: (err: unknown) => toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to run workflow", variant: "destructive" })
    });
  };

  const handleStop = () => {
    stopSess.mutate({ id: sessionId }, {
      onSuccess: () => invalidateAll(),
      onError: (err: unknown) => toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to stop", variant: "destructive" })
    });
  };

  const handleSend = () => {
    if (!userInstruction.trim()) return;
    sendMsg.mutate({ id: sessionId, data: { content: userInstruction } }, {
      onSuccess: () => {
        setUserInstruction("");
        invalidateAll();
      },
      onError: (err: unknown) => toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to send message", variant: "destructive" })
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
      onError: (err: unknown) => toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to approve", variant: "destructive" })
    });
  };

  const handleExport = () => {
    if (!session) return;
    const lines: string[] = [];
    lines.push(`# ${session.goal}`);
    lines.push(`**Status:** ${session.status} | **Mode:** ${session.autonomyMode} | **Estimated Cost:** $${session.estimatedCost?.toFixed(4) || "0.0000"}`);
    lines.push(`**Created:** ${format(new Date(session.createdAt), "PPpp")}`);
    lines.push("");
    lines.push("## Agents");
    agents.forEach(a => {
      const live = !a.isMock ? " [Live]" : " [Simulated]";
      const model = a.activeModel ? ` | ${a.activeModel}` : "";
      lines.push(`- **${a.name}** (${a.provider}) — ${a.role}${model}${live}`);
    });
    lines.push("");
    if (tasks.length > 0) {
      lines.push("## Task Board");
      tasks.forEach(t => {
        const assignee = agents.find(a => a.id === t.assignedAgentId);
        lines.push(`- [${t.status.toUpperCase()}] **${t.title}**${assignee ? ` — ${assignee.name}` : ""}`);
        if (t.description) lines.push(`  ${t.description}`);
      });
      lines.push("");
    }
    if (sessionMemory) {
      lines.push("## Session Memory");
      if (sessionMemory.summary) lines.push(sessionMemory.summary);
      if (sessionMemory.decisions?.length > 0) {
        lines.push("");
        lines.push("### Decisions");
        sessionMemory.decisions.forEach(d => lines.push(`- ${d}`));
      }
      lines.push("");
    }
    lines.push("## Conversation");
    messages.forEach(msg => {
      const sender = msg.role === "user" ? "You" : msg.agentName || "System";
      const time = format(new Date(msg.createdAt), "HH:mm:ss");
      const displayContent = msg.content?.startsWith(SIMULATED_PREFIX)
        ? msg.content.replace(/^⚠️ \[Simulated — live \S+ API unavailable\] /, "")
        : msg.content;
      lines.push(`### ${sender} [${time}]`);
      if (msg.agentRole && msg.role !== "user") {
        lines.push(`*${msg.agentRole}${msg.model ? ` | ${msg.model}` : ""}${msg.agentId && !agents.find(a => a.id === msg.agentId)?.isMock ? " | Live" : " | Simulated"}*`);
      }
      lines.push("");
      lines.push(displayContent || "");
      lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bridge-session-${sessionId}-${format(new Date(), "yyyy-MM-dd")}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: "Session transcript downloaded." });
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
      <div className="flex flex-col lg:h-[calc(100vh-8rem)] gap-4">
        {/* Spike alert */}
        {showSpikeAlert && (
          <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300 shrink-0">
            <TrendingDown className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
            <div className="flex-1">
              <span className="font-semibold">Fallback spike alert — </span>
              {undismissedSpikeProviders.length === 1
                ? `The ${undismissedSpikeProviders[0]} provider`
                : `Providers ${undismissedSpikeProviders.join(", ")}`}{" "}
              {undismissedSpikeProviders.length === 1 ? "has" : "have"} hit {recentSpikeThreshold}+ fallbacks in the last hour.{" "}
              <Link href="/settings" className="underline underline-offset-2 hover:text-red-200">
                Check your API keys
              </Link>
              .
            </div>
            <button
              onClick={dismissSpikeAlert}
              aria-label="Dismiss spike alert"
              className="shrink-0 mt-0.5 rounded p-0.5 text-red-400 hover:bg-red-500/20 hover:text-red-200 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Simulation fallback banner */}
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
              onClick={() => dismissFallbackBanner()}
              className="shrink-0 rounded p-0.5 hover:bg-amber-500/20 transition-colors"
              aria-label="Dismiss banner"
            >
              <X className="h-4 w-4 text-amber-400" />
            </button>
          </div>
        )}

        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-card border rounded-lg p-4 shadow-sm shrink-0">
          <div className="flex items-center gap-3 flex-wrap min-w-0 flex-1">
            <h1 className="font-bold text-lg truncate max-w-[240px] sm:max-w-[300px]" title={session.goal}>{session.goal}</h1>
            <Badge variant="outline" className="capitalize shrink-0">{session.status}</Badge>
            <Badge variant="secondary" className="shrink-0">{session.autonomyMode}</Badge>
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
              <Clock className="w-4 h-4 shrink-0" />
              Est. Cost: ${session.estimatedCost?.toFixed(4) || "0.0000"}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <Button size="sm" variant="ghost" onClick={handleExport} title="Download session transcript as Markdown" aria-label="Export session as Markdown">
              <Download className="w-4 h-4 mr-1.5" /> Export
            </Button>
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

        {/* Completion summary banner */}
        {isSessionComplete && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300 shrink-0">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-400" />
            <div className="flex-1">
              <span className="font-semibold">Session completed successfully.</span>
              {sessionMemory?.summary && (
                <p className="text-emerald-300/80 mt-1">{sessionMemory.summary}</p>
              )}
            </div>
          </div>
        )}

        {/* 3 Column Layout */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0 overflow-auto lg:overflow-hidden">

          {/* Left: Info, Memory & Agents (3 cols) */}
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

            {/* Memory panel — shows AI working memory and key decisions */}
            {sessionMemory && (
              <Card className="shrink-0 border-primary/20 bg-primary/5">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-primary">
                    <Brain className="w-4 h-4" /> Session Memory
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  {sessionMemory.summary && (
                    <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                      {sessionMemory.summary}
                    </p>
                  )}
                  {sessionMemory.decisions && sessionMemory.decisions.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Key Decisions</p>
                      <ul className="space-y-1">
                        {sessionMemory.decisions.map((d, i) => (
                          <li key={i} className="text-[11px] text-muted-foreground leading-tight flex gap-1.5">
                            <span className="text-primary/60 shrink-0">•</span>
                            <span>{d}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

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
                <span className="ml-auto text-[10px] font-normal text-muted-foreground flex items-center gap-3">
                  <span>{messages.length} msg{messages.length !== 1 ? "s" : ""}</span>
                  {session && <span className="font-mono tabular-nums">${session.estimatedCost?.toFixed(4) ?? "0.0000"}</span>}
                  {(runNext.isPending || runFull.isPending) && (
                    <span className="text-primary animate-pulse font-medium">Processing…</span>
                  )}
                </span>
              </CardTitle>
            </CardHeader>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4" ref={scrollRef} onScroll={handleMessagesScroll}>
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
                    <div key={msg.id} className={`group flex flex-col max-w-[85%] rounded-lg border p-3 ${colorClass} ${isUser ? "self-end" : "self-start"}`}>
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
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
                        <button
                          type="button"
                          title="Copy message"
                          className="opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity shrink-0 p-0.5 rounded"
                          onClick={() => copyMessage(displayContent || "")}
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                      {isUser ? (
                        <div className="text-sm whitespace-pre-wrap leading-relaxed">{displayContent}</div>
                      ) : (
                        <MarkdownContent content={displayContent || ""} />
                      )}
                    </div>
                  );
                })
              )}
              {(runNext.isPending || runFull.isPending) && (
                <div className="flex self-start items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 mt-1">
                  <span className="flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-bounce [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-bounce [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-bounce [animation-delay:300ms]" />
                  </span>
                  <span className="text-xs text-muted-foreground">Processing…</span>
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t shrink-0 bg-muted/10">
              {!isSessionActive && (
                <p className="text-xs text-muted-foreground text-center mb-2">
                  {isSessionComplete ? "Session completed — export the transcript above." : `Session is ${session.status}.`}
                </p>
              )}
              <div className="flex gap-2">
                <Textarea
                  placeholder={isSessionActive ? "Send an instruction or provide feedback to the agents..." : "Session is not active"}
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
                  {sendMsg.isPending
                    ? <RefreshCw className="h-4 w-4 animate-spin" />
                    : <Send className="h-4 w-4" />}
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
                  <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                    {tasksByStatus.complete.length}/{tasks.length} done
                  </span>
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
