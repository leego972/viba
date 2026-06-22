import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useWorkbenchAnalyze } from "@workspace/api-client-react";
import type { WorkbenchAnalyzeRequest } from "@workspace/api-client-react";
import {
  FlaskConical,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  Info,
  Clock,
  ThumbsUp,
  Trash2,
  ClipboardCheck,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const PLATFORMS = [
  { value: "alignerr", label: "Alignerr" },
  { value: "outlier", label: "Outlier" },
  { value: "dataannotation", label: "DataAnnotation" },
  { value: "toloka", label: "Toloka" },
  { value: "remotasks", label: "Remotasks" },
  { value: "mindrift", label: "Mindrift" },
  { value: "other", label: "Other" },
];

const TASK_TYPES = [
  { value: "unknown", label: "Auto-detect" },
  { value: "grammar_cleanup", label: "Grammar / Cleanup" },
  { value: "classification", label: "Classification" },
  { value: "sentiment_labeling", label: "Sentiment Labeling" },
  { value: "response_comparison", label: "Response Comparison (A/B)" },
  { value: "factuality_check", label: "Factuality Check" },
  { value: "math_reasoning", label: "Math Reasoning" },
  { value: "coding", label: "Coding" },
  { value: "expert_domain", label: "Expert Domain" },
  { value: "subjective_judgment", label: "Subjective Judgment" },
];

const ROUTING_MODES = [
  { value: "fast", label: "Fast (cheaper, quicker)" },
  { value: "balanced", label: "Balanced (default)" },
  { value: "quality", label: "Quality (most capable)" },
];

const REVIEW_LEVEL_CONFIG = {
  quick_review: {
    label: "Quick Review",
    color: "bg-green-500/10 text-green-600 border-green-500/20",
    icon: CheckCircle2,
    description: "High confidence — read and approve before submitting.",
  },
  careful_review: {
    label: "Careful Review",
    color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
    icon: AlertTriangle,
    description: "Some uncertainty — read carefully before accepting.",
  },
  human_only: {
    label: "Human Review Required",
    color: "bg-red-500/10 text-red-600 border-red-500/20",
    icon: ShieldCheck,
    description: "Do not submit without domain-expert review.",
  },
};

interface WorkbenchResult {
  taskId: string;
  platform: string;
  taskType: string;
  recommendedAnswer: string;
  confidence: number;
  reasoningSummary: string;
  riskFlags: string[];
  rubricChecklist: string[];
  reviewLevel: string;
  humanReviewRequired: boolean;
  routingReceipt: unknown;
}

interface WorkbenchHistoryEntry {
  taskId: string;
  platform: string;
  taskType: string;
  confidence: number;
  reviewLevel: string;
  timestamp: string;
  used: boolean;
  result: WorkbenchResult;
}

interface QualityGate {
  label: string;
  tone: "ready" | "review" | "blocked";
  action: string;
  checklist: string[];
}

const HISTORY_KEY = "viba_workbench_history";
const MAX_HISTORY = 20;

function loadHistory(): WorkbenchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as WorkbenchHistoryEntry[];
  } catch {
    return [];
  }
}

function persistHistory(entries: WorkbenchHistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {
    // localStorage unavailable
  }
}

function buildQualityGate(result: WorkbenchResult): QualityGate {
  const pct = Math.round(result.confidence * 100);
  const riskCount = result.riskFlags.length;
  const hasRubric = result.rubricChecklist.length > 0;

  if (result.humanReviewRequired || result.reviewLevel === "human_only" || pct < 50) {
    return {
      label: "Blocked until human review",
      tone: "blocked",
      action: "Do not use this answer until you personally verify the domain facts, rubric, and risk flags.",
      checklist: [
        "Read the original task instructions again.",
        "Check every risk flag before using the answer.",
        hasRubric ? "Confirm every rubric item manually." : "No rubric was supplied — validate against the platform instructions.",
        "Rewrite the answer yourself if the reasoning is weak or incomplete.",
      ],
    };
  }

  if (result.reviewLevel === "careful_review" || pct < 80 || riskCount > 0) {
    return {
      label: "Careful review required",
      tone: "review",
      action: "Use this as a strong draft, but verify the risky or uncertain parts before submitting.",
      checklist: [
        "Check the answer against the task wording.",
        riskCount > 0 ? "Resolve or accept each risk flag deliberately." : "Confirm there are no hidden assumptions.",
        hasRubric ? "Compare the answer to the rubric checklist." : "Add a quick manual rubric check before use.",
        "Only mark as used after manual review.",
      ],
    };
  }

  return {
    label: "Ready after final read",
    tone: "ready",
    action: "High-confidence recommendation. Read once, then use if it matches the platform task exactly.",
    checklist: [
      "Confirm the answer matches the task instructions.",
      "Check there is no missing context from the original platform screen.",
      "Copy or mark as used only after your final read.",
    ],
  };
}

function gateStyles(tone: QualityGate["tone"]) {
  if (tone === "blocked") return "border-red-500/30 bg-red-500/10 text-red-600";
  if (tone === "review") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-600";
  return "border-green-500/30 bg-green-500/10 text-green-600";
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-medium tabular-nums w-12 text-right">{pct}%</span>
    </div>
  );
}

export default function Workbench() {
  const { toast } = useToast();
  const analyzeMutation = useWorkbenchAnalyze();

  const [platform, setPlatform] = useState<WorkbenchAnalyzeRequest["platform"]>("alignerr");
  const [taskType, setTaskType] = useState<WorkbenchAnalyzeRequest["taskType"]>("unknown");
  const [instructions, setInstructions] = useState("");
  const [rubric, setRubric] = useState("");
  const [taskContent, setTaskContent] = useState("");
  const [answerOptionsRaw, setAnswerOptionsRaw] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [routingMode, setRoutingMode] =
    useState<WorkbenchAnalyzeRequest["routingMode"]>("balanced");

  const [history, setHistory] = useState<WorkbenchHistoryEntry[]>(() => loadHistory());
  const [historicResult, setHistoricResult] = useState<WorkbenchResult | null>(null);
  const [markedUsedIds, setMarkedUsedIds] = useState<Set<string>>(new Set());

  const canSubmit =
    platform && instructions.trim().length > 0 && taskContent.trim().length > 0;

  function buildRequest(): WorkbenchAnalyzeRequest {
    const answerOptions = answerOptionsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      platform,
      taskType: taskType === "unknown" ? undefined : taskType,
      instructions: instructions.trim(),
      rubric: rubric.trim() || undefined,
      taskContent: taskContent.trim(),
      answerOptions: answerOptions.length > 0 ? answerOptions : undefined,
      userNotes: userNotes.trim() || undefined,
      routingMode,
    };
  }

  function handleAnalyze() {
    if (!canSubmit) return;
    setHistoricResult(null);
    analyzeMutation.mutate(
      { data: buildRequest() },
      {
        onError: (err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Analysis failed. Please try again.";
          toast({ title: "Analysis failed", description: message, variant: "destructive" });
        },
      }
    );
  }

  useEffect(() => {
    const data = analyzeMutation.data;
    if (!data) return;
    const entry: WorkbenchHistoryEntry = {
      taskId: data.taskId,
      platform: data.platform,
      taskType: data.taskType,
      confidence: data.confidence,
      reviewLevel: data.reviewLevel,
      timestamp: new Date().toISOString(),
      used: false,
      result: data as WorkbenchResult,
    };
    setHistory((prev) => {
      const deduped = prev.filter((h) => h.taskId !== entry.taskId);
      const updated = [entry, ...deduped].slice(0, MAX_HISTORY);
      persistHistory(updated);
      return updated;
    });
  }, [analyzeMutation.data]);

  function handleLoadHistory(entry: WorkbenchHistoryEntry) {
    setHistoricResult(entry.result);
  }

  function handleMarkUsed(taskId: string) {
    setMarkedUsedIds((prev) => new Set([...prev, taskId]));
    setHistory((prev) => {
      const updated = prev.map((h) => (h.taskId === taskId ? { ...h, used: true } : h));
      persistHistory(updated);
      return updated;
    });
  }

  function handleClearHistory() {
    setHistory([]);
    persistHistory([]);
  }

  function copyAnswer() {
    const answer = result?.recommendedAnswer;
    if (!answer) return;
    navigator.clipboard.writeText(answer).then(() => {
      toast({ title: "Copied to clipboard" });
    });
  }

  function copyReviewPacket() {
    if (!result) return;
    const gate = buildQualityGate(result as WorkbenchResult);
    const packet = [
      `Task ID: ${result.taskId}`,
      `Platform: ${result.platform}`,
      `Task type: ${result.taskType}`,
      `Confidence: ${Math.round(result.confidence * 100)}%`,
      `Quality gate: ${gate.label}`,
      `Required action: ${gate.action}`,
      "",
      "Recommended answer:",
      result.recommendedAnswer,
      "",
      "Reasoning summary:",
      result.reasoningSummary || "No reasoning summary provided.",
      "",
      "Risk flags:",
      result.riskFlags.length ? result.riskFlags.map((flag) => `- ${flag}`).join("\n") : "None reported.",
      "",
      "Rubric checklist:",
      result.rubricChecklist.length ? result.rubricChecklist.map((item) => `- ${item}`).join("\n") : "No rubric checklist provided.",
      "",
      "Review checklist:",
      gate.checklist.map((item) => `- ${item}`).join("\n"),
    ].join("\n");
    navigator.clipboard.writeText(packet).then(() => {
      toast({ title: "Review packet copied" });
    });
  }

  const result = historicResult ?? (analyzeMutation.isPending ? undefined : analyzeMutation.data);
  const isHistoric = historicResult !== null;
  const qualityGate = result ? buildQualityGate(result as WorkbenchResult) : null;

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 py-8 max-w-5xl mx-auto px-4">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-lg bg-primary/10 text-primary shrink-0">
            <FlaskConical className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">AI Trainer Workbench</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Guarded analysis for training tasks. VIBA can recommend, score, and flag risk — but final submission stays manual.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Task Details</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="platform">Platform</Label>
                    <Select
                      value={platform}
                      onValueChange={(v) =>
                        setPlatform(v as WorkbenchAnalyzeRequest["platform"])
                      }
                    >
                      <SelectTrigger id="platform">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PLATFORMS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="taskType">Task Type</Label>
                    <Select
                      value={taskType ?? "unknown"}
                      onValueChange={(v) =>
                        setTaskType(v as WorkbenchAnalyzeRequest["taskType"])
                      }
                    >
                      <SelectTrigger id="taskType">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TASK_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="instructions">
                    Platform Instructions <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="instructions"
                    placeholder="Paste the full instructions shown on the platform…"
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    rows={4}
                    className="resize-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="rubric">Rubric / Scoring Criteria</Label>
                  <Textarea
                    id="rubric"
                    placeholder="Optional — paste any rubric or evaluation criteria…"
                    value={rubric}
                    onChange={(e) => setRubric(e.target.value)}
                    rows={3}
                    className="resize-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="taskContent">
                    Task Content <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="taskContent"
                    placeholder="Paste the actual content to evaluate (text, code, question, etc.)…"
                    value={taskContent}
                    onChange={(e) => setTaskContent(e.target.value)}
                    rows={5}
                    className="resize-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="answerOptions">
                    Answer Options
                    <span className="text-muted-foreground text-xs ml-2">
                      comma-separated
                    </span>
                  </Label>
                  <Input
                    id="answerOptions"
                    placeholder="e.g. Positive, Negative, Neutral"
                    value={answerOptionsRaw}
                    onChange={(e) => setAnswerOptionsRaw(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="userNotes">Your Notes</Label>
                  <Textarea
                    id="userNotes"
                    placeholder="Optional — any observations you want the AI to consider…"
                    value={userNotes}
                    onChange={(e) => setUserNotes(e.target.value)}
                    rows={2}
                    className="resize-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="routingMode">AI Routing</Label>
                  <Select
                    value={routingMode}
                    onValueChange={(v) =>
                      setRoutingMode(v as WorkbenchAnalyzeRequest["routingMode"])
                    }
                  >
                    <SelectTrigger id="routingMode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROUTING_MODES.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  className="w-full mt-1"
                  disabled={!canSubmit || analyzeMutation.isPending}
                  onClick={handleAnalyze}
                >
                  {analyzeMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Analysing…
                    </>
                  ) : (
                    "Run Guarded Analysis"
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            {!result && !analyzeMutation.isPending && (
              <Card className="flex items-center justify-center min-h-[300px] border-dashed">
                <div className="text-center text-muted-foreground px-8">
                  <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">
                    Fill in the task details and run guarded analysis to get a recommendation, risk flags, and a quality gate.
                  </p>
                </div>
              </Card>
            )}

            {analyzeMutation.isPending && (
              <Card className="flex items-center justify-center min-h-[300px]">
                <div className="text-center text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
                  <p className="text-sm">Analysing task…</p>
                </div>
              </Card>
            )}

            {result && !analyzeMutation.isPending && (
              <>
                {(() => {
                  const cfg =
                    REVIEW_LEVEL_CONFIG[result.reviewLevel as keyof typeof REVIEW_LEVEL_CONFIG];
                  const Icon = cfg?.icon ?? Info;
                  return (
                    <div
                      className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${cfg?.color ?? ""}`}
                    >
                      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold">{cfg?.label}</p>
                        <p className="text-xs mt-0.5 opacity-80">{cfg?.description}</p>
                      </div>
                    </div>
                  );
                })()}

                {qualityGate && (
                  <Card className={`border ${gateStyles(qualityGate.tone)}`}>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <ShieldCheck className="h-4 w-4" />
                        Submission Quality Gate
                        <Badge variant="outline" className={`ml-auto ${gateStyles(qualityGate.tone)}`}>
                          {qualityGate.label}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-0">
                      <p className="text-xs leading-5">{qualityGate.action}</p>
                      <ul className="grid gap-1.5">
                        {qualityGate.checklist.map((item) => (
                          <li key={item} className="flex items-start gap-2 text-xs">
                            <ClipboardCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {(result.routingReceipt as { simulated?: boolean } | null)?.simulated && (
                  <div className="flex items-start gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 text-yellow-600 px-4 py-3">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p className="text-xs">
                      Simulated response — no API key is configured. Add a key in{" "}
                      <a href="/settings" className="underline font-medium">
                        Settings
                      </a>{" "}
                      to enable real AI analysis.
                    </p>
                  </div>
                )}

                {isHistoric && (
                  <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                    <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                    <p className="text-xs text-primary flex-1">Viewing a historic analysis</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs px-2"
                      onClick={() => setHistoricResult(null)}
                    >
                      Clear
                    </Button>
                  </div>
                )}

                <Card>
                  <CardHeader className="pb-2 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">Recommended Answer</CardTitle>
                    <div className="flex items-center gap-1">
                      {!isHistoric && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          onClick={() => handleMarkUsed(result.taskId)}
                          disabled={markedUsedIds.has(result.taskId)}
                        >
                          <ThumbsUp className="h-3.5 w-3.5" />
                          {markedUsedIds.has(result.taskId) ? "Marked as used" : "Mark as used"}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={copyReviewPacket}
                      >
                        <ClipboardCheck className="h-3.5 w-3.5" />
                        Packet
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={copyAnswer}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed bg-muted/40 rounded-md p-3">
                      {result.recommendedAnswer}
                    </pre>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Confidence</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ConfidenceBar value={result.confidence} />
                    {result.reasoningSummary && (
                      <p className="text-xs text-muted-foreground">{result.reasoningSummary}</p>
                    )}
                    <div className="flex gap-2 flex-wrap pt-1">
                      <Badge variant="outline" className="text-xs">
                        Type: {result.taskType.replace(/_/g, " ")}
                      </Badge>
                      {(result.routingReceipt as { provider?: string } | null)?.provider && (
                        <Badge variant="outline" className="text-xs">
                          via{" "}
                          {(result.routingReceipt as { provider: string }).provider}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {result.rubricChecklist.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Rubric Checklist</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1.5">
                        {result.rubricChecklist.map((item: string, i: number) => {
                          const isPass = /^pass|✓|ok/i.test(item) || /:\s*pass/i.test(item);
                          const isFail = /^fail|✗|error/i.test(item) || /:\s*fail/i.test(item);
                          return (
                            <li key={i} className="flex items-start gap-2 text-xs">
                              <span
                                className={`mt-0.5 shrink-0 ${
                                  isPass
                                    ? "text-green-500"
                                    : isFail
                                    ? "text-red-500"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {isPass ? "✓" : isFail ? "✗" : "·"}
                              </span>
                              <span>{item}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {result.riskFlags.length > 0 && (
                  <Card className="border-yellow-500/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        Risk Flags
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1">
                        {result.riskFlags.map((flag: string, i: number) => (
                          <li key={i} className="text-xs text-yellow-600">
                            • {flag}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                <Separator />

                <p className="text-xs text-muted-foreground text-center">
                  Task ID: <span className="font-mono">{result.taskId}</span>
                </p>
              </>
            )}
          </div>
        </div>

        {history.length > 0 && (
          <>
            <Separator />
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Recent Analyses
                  <Badge variant="secondary" className="text-xs">{history.length}</Badge>
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs text-muted-foreground"
                  onClick={handleClearHistory}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear all
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {history.map((entry) => {
                  const cfg = REVIEW_LEVEL_CONFIG[entry.reviewLevel as keyof typeof REVIEW_LEVEL_CONFIG];
                  const isCurrentlyLoaded = historicResult?.taskId === entry.taskId;
                  return (
                    <div
                      key={entry.taskId}
                      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors ${isCurrentlyLoaded ? "border-primary/40 bg-primary/5" : "bg-card"}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <Badge variant="outline" className="text-xs shrink-0">
                          {entry.platform}
                        </Badge>
                        <span className="text-xs text-muted-foreground truncate">
                          {entry.taskType.replace(/_/g, " ")}
                        </span>
                        <span className="text-xs font-medium tabular-nums">
                          {Math.round(entry.confidence * 100)}%
                        </span>
                        {cfg && (
                          <Badge
                            variant="outline"
                            className={`text-xs shrink-0 ${cfg.color}`}
                          >
                            {cfg.label}
                          </Badge>
                        )}
                        {(entry.used || markedUsedIds.has(entry.taskId)) && (
                          <Badge variant="secondary" className="text-xs gap-1 shrink-0">
                            <ThumbsUp className="h-2.5 w-2.5" />
                            Used
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleLoadHistory(entry)}
                          disabled={isCurrentlyLoaded}
                        >
                          {isCurrentlyLoaded ? "Loaded" : "Load"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
