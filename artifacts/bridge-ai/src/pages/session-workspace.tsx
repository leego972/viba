import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useParams, Link, useLocation } from "wouter";
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
  useUpdateSession,
  useListApprovals,
  useListAuditLogs,
  useGetStats,
  useGetBannerDismissal,
  useDismissBanner,
  useAnswerQuestion,
  useDeleteSession,
  getGetSessionQueryKey,
  getListMessagesQueryKey,
  getListTasksQueryKey,
  getListApprovalsQueryKey,
  getListAuditLogsQueryKey,
  getGetBannerDismissalQueryKey,
  getGetStatsQueryKey,
  type Approval,
  type Task,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Play, FastForward, Square, Send, CheckCircle2, Clock, Bot,
  Crosshair, LineChart, Zap, FlaskConical, RotateCcw, X,
  RefreshCw, History, ShieldCheck, TrendingDown, AlertTriangle,
  Download, Brain, Copy, GitBranch, ExternalLink, Server, Pencil, Wrench,
  CopyPlus, BarChart3, MessageSquare, ListChecks, Search, Mic, MicOff, Trash2,
} from "lucide-react";
import { useSessionStream } from "@/hooks/useSessionStream";
import { MarkdownContent } from "@/components/MarkdownContent";
import { StreamingMarkdown } from "@/components/StreamingMarkdown";
import { OdometerCost } from "@/components/OdometerCost";
import { ApprovalCountdown } from "@/components/ApprovalCountdown";
import { useSessionSounds } from "@/hooks/useSessionSounds";
import { ToolOutputCards, type ToolOutput } from "@/components/ToolOutputCards";
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
import { MissionHeader } from "@/components/viba-command/MissionHeader";
import { OrchestrationCanvas } from "@/components/orchestration/OrchestrationCanvas";
import {
  buildDemoViewModel,
  AGENT_ROLE_COLORS,
  type OrchestrationViewModel,
  type CoordinatorPhase,
  type AgentStatus,
} from "@/lib/orchestrationViewModel";

function shortRepoName(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, "").replace(/\.git$/, "");
  } catch {
    return url;
  }
}

const ENV_BADGE_STYLES: Record<string, string> = {
  production: "bg-red-500/10 text-red-400 border-red-500/30",
  staging: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  development: "bg-blue-500/10 text-blue-400 border-blue-500/30",
};

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
  const [, navigate] = useLocation();
  const sessionId = parseInt(id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef("");

  const [userInstruction, setUserInstruction] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [msgSearch, setMsgSearch] = useState("");
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<Approval | null>(null);

  // Workspace context edit modal (#14)
  const [showEditCtxModal, setShowEditCtxModal] = useState(false);
  const [editRepoUrl, setEditRepoUrl] = useState("");
  const [editRepoBranch, setEditRepoBranch] = useState("");
  const [editWorkspaceEnv, setEditWorkspaceEnv] = useState("");

  // Inline reply state for user-directed questions
  const [replyingToId, setReplyingToId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [isRejectingApproval, setIsRejectingApproval] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Safety-voting state
  const [isVoting, setIsVoting] = useState(false);
  const [voteResult, setVoteResult] = useState<{
    passed: boolean;
    votes: Array<{ agentId: number; agentName: string; accepted: boolean; reason?: string }>;
    declineReason?: string;
  } | null>(null);
  const [showDeclineModal, setShowDeclineModal] = useState(false);

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
    const storageKey = `viba_fallback_banner_${sessionId}`;
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
  const { isReconnecting } = useSessionStream(sessionId);

  // Queries — no refetchInterval needed; SSE keeps the cache fresh
  // Stats are polled every 30 s so the spike threshold and recentSpikeProviders
  // stay current even when the operator changes the threshold from another tab.
  const { data: stats } = useGetStats({
    query: { queryKey: getGetStatsQueryKey(), refetchInterval: 30_000 },
  });

  const { data: session, isLoading: sessionLoading } = useGetSession(sessionId, {
    query: { enabled: !!sessionId, queryKey: getGetSessionQueryKey(sessionId) }
  });

  const { data: messages = [] } = useListMessages(sessionId, undefined, {
    query: { enabled: !!sessionId, queryKey: getListMessagesQueryKey(sessionId) }
  });

  // Track which message IDs existed on first load — new arrivals get the streaming reveal
  const seenMsgIds = useRef<Set<number>>(new Set());
  const msgStreamInitialized = useRef(false);
  useEffect(() => {
    if (!msgStreamInitialized.current && messages.length > 0) {
      msgStreamInitialized.current = true;
      messages.forEach(m => seenMsgIds.current.add(m.id));
    }
  }, [messages]);
  const isNewMsg = (id: number): boolean => {
    if (!seenMsgIds.current.has(id)) {
      seenMsgIds.current.add(id);
      return true;
    }
    return false;
  };

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
  const updateCtx = useUpdateSession();
  const answerQ = useAnswerQuestion();

  const isSessionActive = session?.status === "active";
  const isSessionComplete = session?.status === "completed";

  // ── Feature 9: Session sounds ──────────────────────────────────────────
  const sounds = useSessionSounds();

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

  // ── Feature 8+9: Sound effects wiring ────────────────────────────────
  const prevMsgCount = useRef(0);
  const prevTaskCount = useRef(0);
  const prevApproval = useRef<number | null>(null);
  const prevComplete = useRef(false);

  useEffect(() => {
    const count = messages.length;
    if (count > prevMsgCount.current) sounds.play("message");
    prevMsgCount.current = count;
  }, [messages.length, sounds]);

  useEffect(() => {
    const completed = tasks.filter(t => t.status === "completed").length;
    if (completed > prevTaskCount.current) sounds.play("task_complete");
    prevTaskCount.current = completed;
  }, [tasks, sounds]);

  useEffect(() => {
    const id = pendingApproval?.id ?? null;
    if (id != null && id !== prevApproval.current) sounds.play("approval");
    prevApproval.current = id ?? null;
  }, [pendingApproval, sounds]);

  useEffect(() => {
    if (isSessionComplete && !prevComplete.current) sounds.play("session_done");
    prevComplete.current = isSessionComplete;
  }, [isSessionComplete, sounds]);

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

  /**
   * Runs the pre-execution safety vote. Each agent evaluates the session goal
   * and votes whether to participate. Agents that refuse sit out; if all refuse
   * the session is declined and this returns false.
   */
  const handleSafetyVote = async (): Promise<boolean> => {
    setIsVoting(true);
    try {
      const resp = await fetch(`/api/sessions/${sessionId}/safety-vote`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!resp.ok) return true; // fail-open if the endpoint errors
      const result = await resp.json() as {
        passed: boolean;
        votes: Array<{ agentId: number; agentName: string; accepted: boolean; reason?: string }>;
        declineReason?: string;
      };
      setVoteResult(result);
      invalidateAll(); // refresh agent list to surface sat-out badges
      if (!result.passed) {
        setShowDeclineModal(true);
        return false;
      }
      const satOut = (result.votes ?? []).filter((v) => !v.accepted);
      if (satOut.length > 0) {
        const names = satOut.map((v) => v.agentName).join(", ");
        toast({
          title: `${satOut.length} agent${satOut.length > 1 ? "s" : ""} sat out`,
          description: `${names} declined this session's goal. Proceeding with the remaining agents.`,
        });
      }
      return true;
    } catch {
      return true; // fail-open
    } finally {
      setIsVoting(false);
    }
  };

  const handleRunNext = async () => {
    // On first run, conduct safety vote before executing anything
    if (messages.length === 0 && !voteResult) {
      const ok = await handleSafetyVote();
      if (!ok) return;
    }
    runNext.mutate({ id: sessionId }, {
      onSuccess: () => invalidateAll(),
      onError: (err: unknown) => toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to run step", variant: "destructive" })
    });
  };

  const handleRunFull = async () => {
    // On first run, conduct safety vote before executing anything
    if (messages.length === 0 && !voteResult) {
      const ok = await handleSafetyVote();
      if (!ok) return;
    }
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

  const toggleSpeech = useCallback(() => {
    if (!isSessionActive) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast({ title: "Not supported", description: "Speech input requires Chrome, Edge, or Safari 14.5+.", variant: "destructive" });
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition: any = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    baseTextRef.current = userInstruction;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          baseTextRef.current = (baseTextRef.current + (baseTextRef.current ? " " : "") + t).trim();
        } else {
          interim += t;
        }
      }
      setUserInstruction((baseTextRef.current + (interim ? " " + interim : "")).trim());
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, isSessionActive, userInstruction, toast]);

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

  const handleReplySubmit = (questionMessageId: number) => {
    if (!replyText.trim()) return;
    answerQ.mutate({ id: sessionId, messageId: questionMessageId, data: { content: replyText.trim() } }, {
      onSuccess: () => {
        setReplyingToId(null);
        setReplyText("");
        invalidateAll();
      },
      onError: (err: unknown) => toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to post answer", variant: "destructive" }),
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

  const handleReject = async () => {
    if (!pendingApproval) return;
    setIsRejectingApproval(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/reject-approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ approvalId: pendingApproval.id, rejectedReason: rejectFeedback }),
      });
      if (!res.ok) throw new Error("Failed");
      setShowApprovalModal(false);
      setPendingApproval(null);
      setRejectFeedback("");
      invalidateAll();
      toast({ title: "Rejected", description: "Approval rejected — session paused for review." });
    } catch {
      toast({ title: "Error", description: "Failed to reject approval.", variant: "destructive" });
    } finally {
      setIsRejectingApproval(false);
    }
  };

  const handleReopen = async () => {
    setIsReopening(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/reopen`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      await queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
      toast({ title: "Session reopened", description: "The session has been reopened and is now active." });
    } catch {
      toast({ title: "Error", description: "Failed to reopen session.", variant: "destructive" });
    } finally {
      setIsReopening(false);
    }
  };

  const deleteSession = useDeleteSession({
    mutation: {
      onSuccess: () => {
        toast({ title: "Session deleted" });
        navigate("/");
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to delete session.", variant: "destructive" });
      },
    },
  });

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
    a.download = `viba-session-${sessionId}-${format(new Date(), "yyyy-MM-dd")}.md`;
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

  const openEditCtxModal = () => {
    setEditRepoUrl(session?.repoUrl ?? "");
    setEditRepoBranch(session?.repoBranch ?? "");
    setEditWorkspaceEnv(session?.workspaceEnv ?? "none");
    setShowEditCtxModal(true);
  };

  const handleSaveCtx = () => {
    updateCtx.mutate(
      { id: sessionId, data: {
        repoUrl: editRepoUrl.trim() || null,
        repoBranch: editRepoBranch.trim() || null,
        workspaceEnv: editWorkspaceEnv === "none" ? null : editWorkspaceEnv || null,
      }},
      {
        onSuccess: () => {
          setShowEditCtxModal(false);
          queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
          toast({ title: "Saved", description: "Workspace context updated." });
        },
        onError: () => toast({ title: "Error", description: "Failed to update context.", variant: "destructive" }),
      }
    );
  };

  const tasksByStatus = {
    planned: tasks.filter(t => t.status === "planned"),
    in_progress: tasks.filter(t => t.status === "in_progress"),
    review: tasks.filter(t => t.status === "review"),
    complete: tasks.filter(t => t.status === "complete"),
    blocked_needs_tools: tasks.filter(t => t.status === "blocked_needs_tools")
  };

  const liveAgentCount = agents.filter(a => !a.isMock).length;
  const simAgentCount = agents.filter(a => a.isMock).length;

  // ── Task detail modal ────────────────────────────────────────────────────
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // ── Orchestration view ───────────────────────────────────────────────────
  const [showOrchestration, setShowOrchestration] = useState(false);

  const phaseFromStatus: Record<string, CoordinatorPhase> = {
    active: "delegating",
    completed: "complete",
    stopped: "error",
    paused: "waiting_approval",
    pending: "idle",
  };

  const liveVm = useMemo((): OrchestrationViewModel => {
    if (!session || agents.length === 0) return buildDemoViewModel();
    const elapsedMs = session.createdAt
      ? Math.max(0, Date.now() - new Date(session.createdAt).getTime())
      : 0;
    const sessionPhase: CoordinatorPhase = phaseFromStatus[session.status] ?? "idle";
    const msgCountByAgent: Record<number, number> = {};
    for (const m of messages) {
      if (m.agentId) msgCountByAgent[m.agentId] = (msgCountByAgent[m.agentId] ?? 0) + 1;
    }
    const lastMsgByAgent: Record<number, string> = {};
    for (const m of [...messages].reverse()) {
      if (m.agentId && !lastMsgByAgent[m.agentId] && m.content) {
        lastMsgByAgent[m.agentId] = m.content.slice(0, 80);
      }
    }
    const builtAgents = agents.map(a => {
      const roleKey = (a.role ?? "").toLowerCase();
      const colors = AGENT_ROLE_COLORS[roleKey] ?? AGENT_ROLE_COLORS["default"];
      let agentStatus: AgentStatus = "idle";
      if (session.status === "completed") agentStatus = "complete";
      else if (session.status === "stopped") agentStatus = "failed";
      else if (session.status === "paused") agentStatus = "paused";
      else if (session.status === "active") {
        const msgCount = msgCountByAgent[a.id] ?? 0;
        agentStatus = msgCount > 0 ? "working" : "queued";
      }
      return {
        id: String(a.id),
        name: a.name,
        provider: a.provider,
        role: a.role ?? "Agent",
        status: agentStatus,
        taskSummary: lastMsgByAgent[a.id],
        cost: undefined,
        latencyMs: undefined,
        confidence: undefined,
        color: colors.color,
        accentColor: colors.accent,
      };
    });
    const completedTasks = tasks.filter(t => t.status === "complete").length;
    const totalTasks = tasks.length;
    const progress = totalTasks > 0
      ? Math.round((completedTasks / totalTasks) * 100)
      : session.status === "completed" ? 100 : 0;
    return {
      sessionId: session.id,
      sessionName: session.goal,
      phase: sessionPhase,
      agents: builtAgents,
      events: auditLogs.slice(-8).map((log, i) => ({
        id: String(log.id ?? i),
        timestamp: log.createdAt ? new Date(log.createdAt) : new Date(),
        agentName: "VIBA",
        agentColor: "#a78bfa",
        action: log.eventType ?? "event",
        detail: undefined,
        type: log.eventType === "adapter_fallback" ? "warning" as const : "info" as const,
      })),
      totalCost: session.estimatedCost ?? 0,
      estimatedPremiumCost: (session.estimatedCost ?? 0) * 5.2,
      elapsedMs,
      progress,
      isDemo: false,
    };
  }, [session, agents, messages, tasks, auditLogs]);

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
        {/* Mission Control Header */}
        <MissionHeader
          sessionName={session.goal}
          phase={liveVm.phase}
          progress={liveVm.progress}
          elapsedMs={liveVm.elapsedMs}
          cost={session.estimatedCost ?? 0}
          estimatedPremiumCost={(session.estimatedCost ?? 0) * 5.2}
          status={session.status}
          hasApproval={!!pendingApproval}
          onStop={isSessionActive ? handleStop : undefined}
        />

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

        {/* SSE Reconnecting banner */}
        {isReconnecting && (
          <div className="flex items-center gap-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm text-sky-300 shrink-0">
            <RefreshCw className="h-4 w-4 shrink-0 text-sky-400 animate-spin" />
            <span>Reconnecting to live feed… updates may be delayed.</span>
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
            {(session.repoUrl || session.repoBranch || session.workspaceEnv) && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {session.repoUrl && (
                  <a
                    href={session.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors max-w-[160px] truncate"
                    title={session.repoUrl}
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <span className="truncate">{shortRepoName(session.repoUrl)}</span>
                  </a>
                )}
                {session.repoBranch && (
                  <Badge variant="outline" className="text-[11px] h-5 px-2 gap-1 font-mono text-muted-foreground shrink-0">
                    <GitBranch className="h-3 w-3" />{session.repoBranch}
                  </Badge>
                )}
                {session.workspaceEnv && (
                  <Badge variant="outline" className={`text-[11px] h-5 px-2 gap-1 shrink-0 ${ENV_BADGE_STYLES[session.workspaceEnv] ?? "bg-muted/30 text-muted-foreground border-border/50"}`}>
                    <Server className="h-3 w-3" />{session.workspaceEnv}
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
            <Button
              size="sm"
              variant="ghost"
              onClick={sounds.toggle}
              title={sounds.enabled ? "Mute session sounds" : "Enable session sounds"}
              aria-label={sounds.enabled ? "Mute" : "Unmute"}
              className={sounds.enabled ? "text-primary/70" : "text-muted-foreground/40"}
            >
              {sounds.enabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={handleExport} title="Download session transcript as Markdown" aria-label="Export session as Markdown">
              <Download className="w-4 h-4 mr-1.5" /> Export
            </Button>
            <a
              href={`/sessions/new?goal=${encodeURIComponent(session.goal)}`}
              title="Fork — start a new session with the same goal"
            >
              <Button size="sm" variant="ghost" className="gap-1.5">
                <CopyPlus className="w-4 h-4" /> Fork
              </Button>
            </a>
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
            {!isSessionActive && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleReopen}
                disabled={isReopening}
                className="gap-1.5"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${isReopening ? "animate-spin" : ""}`} />
                {isReopening ? "Reopening…" : "Reopen Session"}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={deleteSession.isPending}
              className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
              title="Permanently delete this session"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </Button>
          </div>
        </div>

        {/* Orchestration view toggle */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => setShowOrchestration(v => !v)}
            className="flex items-center gap-1.5 text-[10px] text-white/30 hover:text-white/60 transition-colors mb-1"
          >
            <span className={`transition-transform duration-200 ${showOrchestration ? "rotate-90" : ""}`}>▶</span>
            {showOrchestration ? "Hide" : "Show"} orchestration view
          </button>
          {showOrchestration && (
            <div className="rounded-xl border border-white/[0.06] bg-[#0a0b11] overflow-hidden">
              <OrchestrationCanvas vm={liveVm} height={260} />
            </div>
          )}
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

            {/* Workspace Context — repo, branch, environment */}
            {(session.repoUrl || session.repoBranch || session.workspaceEnv) ? (
              <details className="group/wctx shrink-0">
                <summary className="cursor-pointer select-none list-none flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors">
                  <GitBranch className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="flex-1">Workspace Context</span>
                  <span className="text-[10px] text-muted-foreground transition-transform group-open/wctx:rotate-180 inline-block">▼</span>
                </summary>
                <div className="mt-1 rounded-lg border bg-card p-4 flex flex-col gap-3">
                  {session.repoUrl && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Repository</span>
                      <a
                        href={session.repoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-primary hover:underline break-all"
                        title={session.repoUrl}
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        {session.repoUrl}
                      </a>
                    </div>
                  )}
                  {session.repoBranch && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Branch</span>
                      <span className="flex items-center gap-1.5 text-xs font-mono text-foreground">
                        <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
                        {session.repoBranch}
                      </span>
                    </div>
                  )}
                  {session.workspaceEnv && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Environment</span>
                      <span className="flex items-center gap-1.5">
                        <Server className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <Badge variant="outline" className={`text-[11px] h-5 px-2 ${ENV_BADGE_STYLES[session.workspaceEnv] ?? "bg-muted/30 text-muted-foreground border-border/50"}`}>
                          {session.workspaceEnv}
                        </Badge>
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={openEditCtxModal}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground self-start mt-1 transition-colors"
                  >
                    <Pencil className="h-3 w-3" /> Edit context
                  </button>
                </div>
              </details>
            ) : (
              <button
                type="button"
                onClick={openEditCtxModal}
                className="shrink-0 flex items-center gap-2 rounded-lg border border-dashed bg-card/50 px-4 py-3 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors w-full"
              >
                <GitBranch className="w-4 h-4 shrink-0" />
                <span>Set workspace context (repo, branch, env)</span>
                <Pencil className="w-3.5 h-3.5 ml-auto shrink-0" />
              </button>
            )}

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
                      <div
                        key={agent.id}
                        className={`flex flex-col gap-1.5 p-2.5 rounded border ${(agent as { satOutReason?: string | null }).satOutReason ? "border-amber-500/30 bg-amber-500/5" : "bg-muted/30"}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <span
                                className="font-semibold text-xs truncate"
                                title={[agent.role, agent.activeModel].filter(Boolean).join(" · ")}
                              >
                                {agent.name}
                              </span>
                              {agent.canUseTools && (
                                <span title="Can execute tools" className="text-violet-400 text-[10px] shrink-0">🔧</span>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                              {agent.provider}{agent.activeModel ? ` · ${agent.activeModel}` : ""}
                            </p>
                          </div>
                          {isLive ? (
                            <Badge className="text-[10px] h-4 px-1.5 gap-0.5 bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shrink-0">
                              <Zap className="h-2.5 w-2.5" /> Live
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-0.5 text-muted-foreground shrink-0">
                              <FlaskConical className="h-2.5 w-2.5" /> Sim
                            </Badge>
                          )}
                        </div>
                        {(agent as { satOutReason?: string | null }).satOutReason && (
                          <div className="flex items-start gap-1.5 text-[10px] text-amber-400/90 leading-tight">
                            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                            <span>
                              {(() => {
                                const r = (agent as { satOutReason?: string | null }).satOutReason ?? "";
                                return r.length > 120 ? r.substring(0, 120) + "…" : r;
                              })()}
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
            <CardHeader className="p-4 border-b shrink-0 space-y-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <LineChart className="w-4 h-4" /> Live Collaboration
                <span className="ml-auto text-[10px] font-normal text-muted-foreground flex items-center gap-3">
                  <span>{messages.length} msg{messages.length !== 1 ? "s" : ""}</span>
                  {session && <OdometerCost value={session.estimatedCost ?? 0} />}
                  {(runNext.isPending || runFull.isPending) && (
                    <span className="text-primary animate-pulse font-medium">Processing…</span>
                  )}
                </span>
              </CardTitle>
              {messages.length > 4 && (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search messages…"
                    value={msgSearch}
                    onChange={e => setMsgSearch(e.target.value)}
                    className="w-full h-7 pl-8 pr-8 rounded-md border border-border bg-muted/30 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  {msgSearch && (
                    <button onClick={() => setMsgSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </CardHeader>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4" ref={scrollRef} onScroll={handleMessagesScroll}>
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-muted-foreground text-sm italic">
                  No messages yet. Start the session to see collaboration.
                </div>
              ) : (
                (() => {
                  // Pre-build: map questionMessageId → answer message for O(1) lookup
                  const answerByQuestionId = new Map<number, typeof messages[number]>();
                  for (const m of messages) {
                    if ((m.messageType ?? "output") === "answer") {
                      const meta = m.metadata as { questionMessageId?: number } | null;
                      if (typeof meta?.questionMessageId === "number") {
                        answerByQuestionId.set(meta.questionMessageId, m);
                      }
                    }
                  }
                  // Skip standalone answer messages — they're rendered inline below their question
                  const answeredIds = new Set(answerByQuestionId.keys());
                  const answerMessageIds = new Set(
                    [...answerByQuestionId.values()].map(m => m.id)
                  );

                  const searchLower = msgSearch.trim().toLowerCase();
                  const visibleMessages = messages
                    .filter(msg => !answerMessageIds.has(msg.id))
                    .filter(msg => !searchLower || msg.content?.toLowerCase().includes(searchLower) || msg.agentName?.toLowerCase().includes(searchLower) || msg.agentRole?.toLowerCase().includes(searchLower));

                  if (searchLower && visibleMessages.length === 0) {
                    return (
                      <div className="flex h-full items-center justify-center text-muted-foreground text-sm italic">
                        No messages match "{msgSearch}".
                      </div>
                    );
                  }

                  return visibleMessages.map(msg => {
                  const isUser = msg.role === "user";
                  const isSimulated = !isUser && msg.content?.startsWith(SIMULATED_PREFIX);
                  const msgType = msg.messageType ?? "output";
                  const isAnswered = msgType === "question" && answeredIds.has(msg.id);
                  const inlineAnswer = msgType === "question" ? answerByQuestionId.get(msg.id) : undefined;

                  // A question is "for the user" when toAgentId is absent/null and it's from an agent
                  const isQuestionForUser = msgType === "question" && !isUser && !msg.toAgentId;

                  const colorClass = isUser
                    ? AGENT_COLORS["user"]
                    : msgType === "handoff"
                      ? "bg-orange-500/10 text-orange-200 border-orange-500/30"
                      : msgType === "question"
                        ? isQuestionForUser
                          ? isAnswered
                            ? "bg-violet-500/5 text-violet-200/70 border-violet-500/20"
                            : "bg-violet-500/10 text-violet-200 border-violet-500/40"
                          : isAnswered
                            ? "bg-blue-500/5 text-blue-200/70 border-blue-500/20"
                            : "bg-blue-500/10 text-blue-200 border-blue-500/30"
                        : msgType === "answer"
                          ? "bg-emerald-500/10 text-emerald-200 border-emerald-500/30"
                          : msgType === "context"
                            ? "bg-muted/40 text-muted-foreground border-border/50"
                            : isSimulated
                              ? "bg-amber-500/10 text-amber-200 border-amber-500/30"
                              : (msg.provider ? AGENT_COLORS[msg.provider] : "bg-muted text-foreground border-border");

                  const displayContent = isSimulated
                    ? msg.content.replace(/^⚠️ \[Simulated — live \S+ API unavailable\] /, "")
                    : msg.content;

                  // Parse handoff metadata for structured rendering
                  const handoffMeta = msgType === "handoff"
                    ? (msg.metadata as { blockedReason?: string; partialWork?: string; toolRequirements?: string[] } | null)
                    : null;

                  const isReplying = replyingToId === msg.id;

                  return (
                    <div key={msg.id} className={`group flex flex-col max-w-[85%] rounded-lg border p-3 ${colorClass} ${isUser ? "self-end" : "self-start"}${msgType === "question" && !isAnswered ? " ring-2 ring-blue-500/50 shadow-[0_0_14px_rgba(59,130,246,0.18)]" : ""}`}>
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span
                          className="font-semibold text-xs"
                          title={!isUser && msg.agentRole ? `${msg.agentRole}${msg.model ? ` · ${msg.model}` : ""}` : undefined}
                        >
                          {isUser ? "You" : msg.agentName || "System"}
                        </span>
                        {isSimulated && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-0.5 text-amber-400 border-amber-500/40">
                            <FlaskConical className="h-2.5 w-2.5" /> Simulated
                          </Badge>
                        )}
                        {msgType === "handoff" && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-0.5 text-orange-400 border-orange-500/40">
                            🔄 Handoff
                          </Badge>
                        )}
                        {msgType === "handoff" && msg.toAgentName && (
                          <span className="text-[10px] text-orange-300/80 flex items-center gap-1">
                            <span className="opacity-60">{msg.agentName || "Agent"}</span>
                            <span>→</span>
                            <span className="font-semibold">{msg.toAgentName}</span>
                          </span>
                        )}
                        {msgType === "context" && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-0.5 text-muted-foreground border-border/60">
                            📋 Context
                          </Badge>
                        )}
                        {msgType === "question" && isQuestionForUser && (
                          <Badge variant="outline" className={`text-[10px] h-4 px-1.5 gap-0.5 ${isAnswered ? "text-emerald-400 border-emerald-500/40" : "text-violet-400 border-violet-500/40"}`}>
                            {isAnswered ? "✅ Answered" : "💬 Needs your input"}
                          </Badge>
                        )}
                        {msgType === "question" && !isQuestionForUser && (
                          <Badge variant="outline" className={`text-[10px] h-4 px-1.5 gap-0.5 ${isAnswered ? "text-emerald-400 border-emerald-500/40" : "text-blue-400 border-blue-500/40"}`}>
                            {isAnswered ? "✅ Answered" : "❓ Question"}
                          </Badge>
                        )}
                        {msgType === "question" && !isQuestionForUser && msg.toAgentName && (
                          <span className="text-[10px] text-blue-300/80 flex items-center gap-0.5">
                            <span className="opacity-50">→</span>
                            <span className="font-semibold">{msg.toAgentName}</span>
                          </span>
                        )}
                        {msgType === "question" && isQuestionForUser && (
                          <span className="text-[10px] text-violet-300/80 flex items-center gap-0.5">
                            <span className="opacity-50">→</span>
                            <span className="font-semibold">You</span>
                          </span>
                        )}
                        {msgType === "answer" && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-0.5 text-emerald-400 border-emerald-500/40">
                            ✅ Answer
                          </Badge>
                        )}
                        {msgType === "answer" && msg.toAgentName && (
                          <span className="text-[10px] text-emerald-300/80 flex items-center gap-0.5">
                            <span className="opacity-50">↩</span>
                            <span className="font-semibold">{msg.toAgentName}</span>
                          </span>
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

                      {/* Context: muted aside */}
                      {msgType === "context" && (
                        <p className="text-xs italic text-muted-foreground/80 leading-relaxed">
                          {displayContent}
                        </p>
                      )}

                      {/* Handoff: structured collapsible sections */}
                      {msgType === "handoff" && handoffMeta ? (
                        <div className="flex flex-col gap-2 text-sm">
                          {handoffMeta.blockedReason && (
                            <p className="text-xs text-orange-300/80 italic">
                              Blocked: {handoffMeta.blockedReason}
                            </p>
                          )}
                          {handoffMeta.partialWork && (
                            <details open className="group/det rounded border border-orange-500/20 bg-black/10">
                              <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-semibold text-orange-300 list-none flex items-center gap-1.5">
                                <span className="transition-transform group-open/det:rotate-90 inline-block">▶</span>
                                What was completed
                              </summary>
                              <div className="px-3 pb-2 pt-1 border-t border-orange-500/20">
                                <MarkdownContent content={handoffMeta.partialWork} />
                              </div>
                            </details>
                          )}
                          <details className="group/det2 rounded border border-orange-500/20 bg-black/10">
                            <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-semibold text-orange-300 list-none flex items-center gap-1.5">
                              <span className="transition-transform group-open/det2:rotate-90 inline-block">▶</span>
                              What remains (requires tools)
                            </summary>
                            <div className="px-3 pb-2 pt-1 border-t border-orange-500/20 text-xs text-orange-200/80">
                              {handoffMeta.toolRequirements && handoffMeta.toolRequirements.length > 0
                                ? <ul className="list-disc list-inside space-y-0.5">{handoffMeta.toolRequirements.map((r, i) => <li key={i}>{r}</li>)}</ul>
                                : <span className="italic opacity-70">See sibling task for full context.</span>
                              }
                            </div>
                          </details>
                        </div>
                      ) : isUser ? (
                        <div className="text-sm whitespace-pre-wrap leading-relaxed">{displayContent}</div>
                      ) : msgType !== "context" ? (
                        <StreamingMarkdown content={displayContent || ""} isNew={isNewMsg(msg.id)} />
                      ) : null}

                      {/* Tool outputs — diffs, test results, deployment links, etc. */}
                      {Array.isArray(msg.toolOutputs) && msg.toolOutputs.length > 0 && (
                        <ToolOutputCards outputs={msg.toolOutputs as ToolOutput[]} />
                      )}

                      {/* Threaded answer — rendered inline below the question */}
                      {msgType === "question" && inlineAnswer && (
                        <div className="mt-2 ml-3 pl-3 border-l-2 border-emerald-500/40 flex flex-col gap-1">
                          <span className="text-[10px] font-semibold text-emerald-400 flex items-center gap-1">
                            ↳ {inlineAnswer.agentName || "You"} answered
                            {inlineAnswer.toAgentName && (
                              <span className="font-normal text-emerald-300/70 flex items-center gap-0.5">
                                <span className="opacity-60">↩</span>
                                <span>{inlineAnswer.toAgentName}</span>
                              </span>
                            )}
                          </span>
                          <div className="text-xs text-emerald-200/80">
                            <MarkdownContent content={inlineAnswer.content || ""} />
                          </div>
                        </div>
                      )}

                      {/* Inline reply box — shown only for unanswered user-directed questions */}
                      {isQuestionForUser && !isAnswered && (
                        <div className="mt-3 flex flex-col gap-2 border-t border-violet-500/20 pt-3">
                          {isReplying ? (
                            <>
                              <Textarea
                                autoFocus
                                placeholder="Type your answer…"
                                className="min-h-[56px] resize-none text-xs bg-black/20 border-violet-500/30 focus:border-violet-400"
                                value={replyText}
                                onChange={(e) => setReplyText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleReplySubmit(msg.id);
                                  }
                                  if (e.key === "Escape") {
                                    setReplyingToId(null);
                                    setReplyText("");
                                  }
                                }}
                              />
                              <div className="flex gap-1.5 justify-end">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-[11px] text-muted-foreground"
                                  onClick={() => { setReplyingToId(null); setReplyText(""); }}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-6 px-2 text-[11px] bg-violet-600 hover:bg-violet-500 text-white"
                                  disabled={!replyText.trim() || answerQ.isPending}
                                  onClick={() => handleReplySubmit(msg.id)}
                                >
                                  {answerQ.isPending ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
                                  Reply
                                </Button>
                              </div>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="self-start text-[11px] text-violet-400 hover:text-violet-300 font-medium flex items-center gap-1 transition-colors"
                              onClick={() => { setReplyingToId(msg.id); setReplyText(""); }}
                            >
                              <Send className="h-3 w-3" />
                              Reply to this question
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                  })
                })()
              )}
              {(runNext.isPending || runFull.isPending) && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex self-start items-center gap-2.5 rounded border border-white/8 bg-white/[0.03] px-3 py-2 mt-1"
                >
                  <span className="flex gap-[3px] items-center">
                    {[0, 1, 2].map(i => (
                      <motion.span
                        key={i}
                        className="h-1 w-1 rounded-full bg-primary/50"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.22, ease: "easeInOut" }}
                      />
                    ))}
                  </span>
                  <span className="text-[11px] font-mono tracking-wide text-muted-foreground/70 uppercase">
                    Agents deliberating
                  </span>
                </motion.div>
              )}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t shrink-0 bg-muted/10">
              {!isSessionActive && (
                <div className="flex flex-col items-center gap-2 mb-2">
                  <p className="text-xs text-muted-foreground text-center">
                    {isSessionComplete ? "Session completed — export the transcript above." : `Session is ${session.status}.`}
                  </p>
                  {isSessionComplete && (
                    <Link href="/sessions/new">
                      <Button size="sm" variant="outline" className="text-xs h-7 gap-1.5">
                        <RefreshCw className="h-3 w-3" /> Start follow-up session
                      </Button>
                    </Link>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Textarea
                    placeholder={isSessionActive ? "Send an instruction or provide feedback to the agents..." : "Session is not active"}
                    className={`min-h-[60px] resize-none pr-10 transition-colors ${isListening ? "border-red-500/60 bg-red-500/5 ring-1 ring-red-500/30" : ""}`}
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
                  {/* Mic button — floats inside textarea bottom-right */}
                  <button
                    type="button"
                    onClick={toggleSpeech}
                    disabled={!isSessionActive}
                    title={isListening ? "Stop listening" : "Speak to type"}
                    className={`absolute bottom-2 right-2 p-1.5 rounded-md transition-all ${
                      !isSessionActive
                        ? "opacity-30 cursor-not-allowed"
                        : isListening
                        ? "bg-red-500 text-white shadow-[0_0_8px_rgba(239,68,68,0.6)] hover:bg-red-600"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {isListening ? (
                      <MicOff className="h-3.5 w-3.5" />
                    ) : (
                      <Mic className="h-3.5 w-3.5" />
                    )}
                    {isListening && (
                      <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                      </span>
                    )}
                  </button>
                </div>
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
                {(['planned', 'in_progress', 'review', 'complete', 'blocked_needs_tools'] as const).map(status => {
                  const columnTasks = tasksByStatus[status];
                  if (columnTasks.length === 0 && status !== 'planned' && status !== 'blocked_needs_tools') return null;

                  return (
                    <div key={status} className="flex flex-col gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 flex items-center gap-2">
                        {status.replace('_', ' ')}
                        <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">{columnTasks.length}</Badge>
                      </div>
                      <AnimatePresence initial={false}>
                      {columnTasks.map(task => (
                        <motion.div
                          key={task.id}
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4, scale: 0.98 }}
                          transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
                          onClick={() => setSelectedTask(task)}
                          className={`bg-card border rounded p-2 text-sm shadow-sm cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors ${task.status === "blocked_needs_tools" ? "border-amber-500/30 bg-amber-500/5" : ""} ${task.status === "complete" ? "border-emerald-500/25 task-complete-shimmer" : ""}`}
                        >
                          <div className="font-medium line-clamp-2 leading-tight">{task.title}</div>
                          {task.status === "blocked_needs_tools" && task.blockedReason && (
                            <div className="flex items-start gap-1 mt-1.5 text-[10px] text-amber-400/90">
                              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                              <span className="leading-tight">{task.blockedReason}</span>
                            </div>
                          )}
                          {task.status === "blocked_needs_tools" && task.toolRequirements && task.toolRequirements.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {task.toolRequirements.map((req, i) => (
                                <span key={i} className="inline-flex items-center gap-0.5 text-[9px] font-mono bg-violet-500/10 text-violet-300 border border-violet-500/25 rounded px-1.5 py-0.5">
                                  <Wrench className="h-2 w-2 shrink-0" />
                                  {req}
                                </span>
                              ))}
                            </div>
                          )}
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
                        </motion.div>
                      ))}
                      </AnimatePresence>
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

            {/* Agent Insights */}
            {agents.length > 0 && messages.length > 0 && (
              <Card className="shrink-0 bg-muted/10">
                <CardHeader className="p-3 pb-2 border-b">
                  <CardTitle className="text-xs flex items-center gap-2 text-muted-foreground">
                    <BarChart3 className="w-3.5 h-3.5" /> Agent Insights
                  </CardTitle>
                </CardHeader>
                <div className="p-2 flex flex-col gap-1.5">
                  {agents.map(agent => {
                    const agentMsgs = messages.filter(m => m.agentName === agent.name && m.role !== "user").length;
                    const agentTasks = tasks.filter(t => t.assignedAgentId === agent.id).length;
                    const completedTasks = tasks.filter(t => t.assignedAgentId === agent.id && t.status === "complete").length;
                    const pct = agentMsgs === 0 ? 0 : Math.round((agentMsgs / Math.max(messages.filter(m => m.role !== "user").length, 1)) * 100);
                    return (
                      <div key={agent.id} className="px-1 py-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-medium truncate max-w-[100px]">{agent.name}</span>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-0.5"><MessageSquare className="h-2.5 w-2.5" />{agentMsgs}</span>
                            <span className="flex items-center gap-0.5"><ListChecks className="h-2.5 w-2.5" />{completedTasks}/{agentTasks}</span>
                          </div>
                        </div>
                        <div className="h-1 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${agent.isMock ? "bg-amber-400/50" : "bg-primary/60"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="text-[9px] text-muted-foreground/60 mt-0.5">{pct}% of output</p>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Edit Workspace Context Modal (#14) */}
      <Dialog open={showEditCtxModal} onOpenChange={setShowEditCtxModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" /> Edit Workspace Context
            </DialogTitle>
            <DialogDescription>
              Connect a repository so tool-capable agents can clone, run, and deploy code.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Repository URL</label>
              <Input
                placeholder="https://github.com/owner/repo"
                value={editRepoUrl}
                onChange={e => setEditRepoUrl(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Branch</label>
              <Input
                placeholder="main"
                value={editRepoBranch}
                onChange={e => setEditRepoBranch(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Environment</label>
              <Select value={editWorkspaceEnv} onValueChange={setEditWorkspaceEnv}>
                <SelectTrigger>
                  <SelectValue placeholder="Select environment…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {["development", "staging", "production"].map(env => (
                    <SelectItem key={env} value={env} className="capitalize">{env}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditCtxModal(false)}>Cancel</Button>
            <Button onClick={handleSaveCtx} disabled={updateCtx.isPending}>
              {updateCtx.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Safety-vote Decline Modal — shown when all agents refuse the session goal */}
      <Dialog open={showDeclineModal} onOpenChange={setShowDeclineModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Session Declined by All Agents
            </DialogTitle>
            <DialogDescription>
              Every agent in this session refused to participate in this goal. The session cannot proceed as defined.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Agent reasoning:</div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {voteResult?.votes?.filter((v) => !v.accepted).map((v) => (
                <div key={v.agentId} className="rounded bg-muted/50 p-2.5 text-xs">
                  <span className="font-semibold text-foreground">{v.agentName}: </span>
                  <span className="text-muted-foreground">{v.reason ?? "Declined to participate"}</span>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeclineModal(false)}>Dismiss</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approval Modal */}
      <Dialog open={showApprovalModal} onOpenChange={setShowApprovalModal}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <DialogTitle className="flex items-center gap-2 text-amber-500">
                  <AlertTriangle className="h-5 w-5" /> Approval Required
                </DialogTitle>
                <DialogDescription>
                  The agents have requested approval before proceeding.
                </DialogDescription>
              </div>
              {showApprovalModal && (
                <ApprovalCountdown seconds={90} />
              )}
            </div>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div className="font-semibold text-sm mb-1">{pendingApproval?.type || 'Action'}</div>
            <div className="text-sm bg-muted p-3 rounded-md">{pendingApproval?.description}</div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Rejection feedback (optional)</label>
              <Textarea
                placeholder="Explain why this action should not proceed…"
                className="min-h-[64px] resize-none text-sm"
                value={rejectFeedback}
                onChange={(e) => setRejectFeedback(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApprovalModal(false)}>Review Manually</Button>
            <Button variant="destructive" onClick={handleReject} disabled={isRejectingApproval}>
              {isRejectingApproval ? "Rejecting…" : "Reject"}
            </Button>
            <Button onClick={handleApprove} disabled={approve.isPending}>
              {approve.isPending ? "Approving..." : "Approve & Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Task Detail Modal */}
      <Dialog open={!!selectedTask} onOpenChange={(o) => { if (!o) setSelectedTask(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base leading-snug">
              <ListChecks className="h-4 w-4 shrink-0 text-primary" />
              {selectedTask?.title}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-[10px] capitalize">
                  {selectedTask?.status.replace(/_/g, " ")}
                </Badge>
                {selectedTask?.type && (
                  <Badge variant="outline" className="text-[10px]">{selectedTask.type}</Badge>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm py-1">
            {selectedTask?.description && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Description</p>
                <p className="text-muted-foreground leading-relaxed">{selectedTask.description}</p>
              </div>
            )}

            {selectedTask?.assignedAgentId && (() => {
              const a = agents.find(ag => ag.id === selectedTask.assignedAgentId);
              return a ? (
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Assigned to</p>
                  <span className="font-medium">{a.name}</span>
                  {a.isMock
                    ? <Badge variant="outline" className="text-[9px] h-4 px-1">Sim</Badge>
                    : <Badge className="text-[9px] h-4 px-1 bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Live</Badge>
                  }
                </div>
              ) : null;
            })()}

            {selectedTask?.costEstimate != null && (
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cost estimate</p>
                <span className="font-mono text-xs">${selectedTask.costEstimate.toFixed(4)}</span>
              </div>
            )}

            {selectedTask?.blockedReason && (
              <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-400 mb-1">Blocked reason</p>
                <p className="text-amber-300/80 text-xs leading-relaxed">{selectedTask.blockedReason}</p>
              </div>
            )}

            {selectedTask?.partialWork && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Partial work</p>
                <p className="text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap">{selectedTask.partialWork}</p>
              </div>
            )}

            {selectedTask?.toolRequirements && selectedTask.toolRequirements.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Tools required</p>
                <div className="flex flex-wrap gap-1">
                  {selectedTask.toolRequirements.map((req, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[10px] font-mono bg-violet-500/10 text-violet-300 border border-violet-500/25 rounded px-2 py-0.5">
                      <Wrench className="h-2.5 w-2.5" />{req}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSelectedTask(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session?</AlertDialogTitle>
            <AlertDialogDescription>
              {session?.goal
                ? <><span className="font-medium text-foreground">"{session.goal}"</span> will be permanently deleted including all messages, tasks, and agents. This cannot be undone.</>
                : "This session will be permanently deleted. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (session) deleteSession.mutate({ id: session.id });
              }}
            >
              Delete session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </AppLayout>
  );
}
