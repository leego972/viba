import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
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
  getGetSessionQueryKey,
  getListMessagesQueryKey,
  getListTasksQueryKey,
  getListApprovalsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Play, FastForward, Square, Send, CheckCircle2, Clock, User, Bot, AlertTriangle, Crosshair, LineChart } from "lucide-react";

const AGENT_COLORS: Record<string, string> = {
  "openai": "bg-green-500/10 text-green-400 border-green-500/20",
  "anthropic": "bg-orange-500/10 text-orange-400 border-orange-500/20",
  "manus": "bg-purple-500/10 text-purple-400 border-purple-500/20",
  "replit": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "google": "bg-teal-500/10 text-teal-400 border-teal-500/20",
  "perplexity": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "user": "bg-primary/10 text-primary border-primary/20",
};

export default function SessionWorkspace() {
  const { id } = useParams();
  const sessionId = parseInt(id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const [userInstruction, setUserInstruction] = useState("");
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<any>(null);

  // Queries
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
    query: { enabled: !!sessionId, queryKey: ["sessions", sessionId, "agents"] as const }
  });

  const { data: approvals = [] } = useListApprovals(sessionId, {
    query: { enabled: !!sessionId, queryKey: getListApprovalsQueryKey(sessionId), refetchInterval: 2000 }
  });

  // Mutations
  const runNext = useRunNextStep();
  const runFull = useRunFullWorkflow();
  const stopSess = useStopSession();
  const sendMsg = useSendMessage();
  const approve = useApproveAction();

  const isSessionActive = session?.status === "active";

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
  };

  const tasksByStatus = {
    planned: tasks.filter(t => t.status === "planned"),
    in_progress: tasks.filter(t => t.status === "in_progress"),
    review: tasks.filter(t => t.status === "review"),
    complete: tasks.filter(t => t.status === "complete")
  };

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
        {/* Header Bar */}
        <div className="flex items-center justify-between bg-card border rounded-lg p-4 shadow-sm shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="font-bold text-lg truncate max-w-[300px]" title={session.goal}>{session.goal}</h1>
            <Badge variant="outline" className="capitalize">{session.status}</Badge>
            <Badge variant="secondary">{session.autonomyMode}</Badge>
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
                  {agents.map(agent => (
                    <div key={agent.id} className="flex flex-col p-2 rounded border bg-muted/30">
                      <div className="font-semibold text-sm">{agent.name}</div>
                      <div className="flex justify-between items-center mt-1">
                        <Badge variant="outline" className="text-[10px] h-4">{agent.provider}</Badge>
                        <span className="text-xs text-muted-foreground">{agent.role}</span>
                      </div>
                    </div>
                  ))}
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
                  const colorClass = isUser ? AGENT_COLORS["User"] : (msg.provider ? AGENT_COLORS[msg.provider] : "bg-muted text-foreground border-border");
                  
                  return (
                    <div key={msg.id} className={`flex flex-col max-w-[85%] rounded-lg border p-3 ${colorClass} ${isUser ? "self-end" : "self-start"}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-xs">{isUser ? "You" : msg.agentName || "System"}</span>
                        {!isUser && msg.agentRole && <span className="text-[10px] opacity-70">| {msg.agentRole}</span>}
                        <span className="text-[10px] opacity-50 ml-auto">{format(new Date(msg.createdAt), "HH:mm:ss")}</span>
                      </div>
                      <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
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
                    if (e.key === 'Enter' && !e.shiftKey) {
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

          {/* Right: Task Board (3 cols) */}
          <Card className="lg:col-span-3 flex flex-col min-h-0 bg-muted/20 border-l-0 lg:border-l lg:border-l-border">
            <CardHeader className="p-4 border-b shrink-0 bg-card">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Task Board
              </CardTitle>
            </CardHeader>
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-4">
              {(['planned', 'in_progress', 'review', 'complete'] as const).map(status => {
                const columnTasks = tasksByStatus[status];
                if (columnTasks.length === 0 && status !== 'planned') return null; // Hide empty columns except planned
                
                return (
                  <div key={status} className="flex flex-col gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 flex items-center gap-2">
                      {status.replace('_', ' ')}
                      <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">{columnTasks.length}</Badge>
                    </div>
                    {columnTasks.map(task => (
                      <div key={task.id} className="bg-card border rounded p-2 text-sm shadow-sm">
                        <div className="font-medium line-clamp-2 leading-tight">{task.title}</div>
                        {task.assignedAgentId && (
                          <div className="text-[10px] text-muted-foreground mt-2 pt-2 border-t flex justify-between items-center">
                            <span>Assigned to: {agents.find(a => a.id === task.assignedAgentId)?.name || 'Unknown'}</span>
                          </div>
                        )}
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
