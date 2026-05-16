import { useState } from "react";
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
import { useAnalyzeWorkbenchTask } from "@workspace/api-client-react";
import type { WorkbenchAnalyzeRequest } from "@workspace/api-client-react";
import {
  FlaskConical,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  Info,
} from "lucide-react";

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
  const analyzeMutation = useAnalyzeWorkbenchTask();

  const [platform, setPlatform] = useState<WorkbenchAnalyzeRequest["platform"]>("alignerr");
  const [taskType, setTaskType] = useState<WorkbenchAnalyzeRequest["taskType"]>("unknown");
  const [instructions, setInstructions] = useState("");
  const [rubric, setRubric] = useState("");
  const [taskContent, setTaskContent] = useState("");
  const [answerOptionsRaw, setAnswerOptionsRaw] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [routingMode, setRoutingMode] =
    useState<WorkbenchAnalyzeRequest["routingMode"]>("balanced");

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

  function copyAnswer() {
    if (!analyzeMutation.data?.recommendedAnswer) return;
    navigator.clipboard.writeText(analyzeMutation.data.recommendedAnswer).then(() => {
      toast({ title: "Copied to clipboard" });
    });
  }

  const result = analyzeMutation.data;

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 py-8 max-w-5xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-lg bg-primary/10 text-primary shrink-0">
            <FlaskConical className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">AI Trainer Workbench</h1>
            <p className="text-sm text-muted-foreground mt-1">
              AI-assisted analysis of training tasks. Every recommendation must be reviewed and
              submitted manually — no automatic login, submission, or platform automation.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input panel */}
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
                    "Analyse Task"
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Results panel */}
          <div className="flex flex-col gap-4">
            {!result && !analyzeMutation.isPending && (
              <Card className="flex items-center justify-center min-h-[300px] border-dashed">
                <div className="text-center text-muted-foreground px-8">
                  <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">
                    Fill in the task details and click Analyse to get a recommended answer.
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
                {/* Review level banner */}
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

                {/* Routing receipt / simulated warning */}
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

                {/* Recommended answer */}
                <Card>
                  <CardHeader className="pb-2 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">Recommended Answer</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={copyAnswer}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed bg-muted/40 rounded-md p-3">
                      {result.recommendedAnswer}
                    </pre>
                  </CardContent>
                </Card>

                {/* Confidence */}
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

                {/* Rubric checklist */}
                {result.rubricChecklist.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Rubric Checklist</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1.5">
                        {result.rubricChecklist.map((item, i) => {
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

                {/* Risk flags */}
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
                        {result.riskFlags.map((flag, i) => (
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
      </div>
    </AppLayout>
  );
}
