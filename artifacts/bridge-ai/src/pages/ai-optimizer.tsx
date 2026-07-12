import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Zap, Brain, Gauge, DollarSign, CheckCircle, ArrowRight, Loader2, Info } from "lucide-react";

interface MonthlySummary {
  totalTasks: number;
  tasksWithoutPremium: number;
  estimatedSpendUsd: number;
  estimatedSavingsUsd: number;
  percentageSaved: number;
  premiumModelExecutions: number;
  cacheHits: number;
}

interface OptimisationDecision {
  executionMethod: string;
  provider?: string;
  model?: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCost: number;
  estimatedCostWithoutViba: number;
  estimatedSavings: number;
  savingsReasons: string[];
  confidence: number;
  qualityMode: string;
  requiresApproval: boolean;
  budgetWarning: boolean;
}

const METHOD_LABELS: Record<string, { label: string; color: string }> = {
  cache:         { label: "Cache Hit",       color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  local_tool:    { label: "Local Tool",      color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  rule_engine:   { label: "Rule Engine",     color: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  economy_model: { label: "Economy Model",   color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  premium_model: { label: "Premium Model",   color: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
  multi_model:   { label: "Multi-Model",     color: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
  memory:        { label: "Project Memory",  color: "bg-teal-500/15 text-teal-400 border-teal-500/30" },
};

const MODE_INFO = {
  economy:  { icon: DollarSign, label: "Economy",         desc: "Minimise cost. Use cache, tools, and low-cost models first." },
  balanced: { icon: Gauge,      label: "Balanced",         desc: "Optimise cost without reducing quality. Default for most tasks." },
  maximum:  { icon: Brain,      label: "Maximum Quality",  desc: "Prioritise output quality. Use premium models when justified." },
};

export default function AiOptimizerPage() {
  const [qualityMode, setQualityMode] = useState<"economy" | "balanced" | "maximum">("balanced");
  const [useExistingFirst, setUseExistingFirst] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [taskType, setTaskType] = useState("general");
  const [decision, setDecision] = useState<OptimisationDecision | null>(null);

  const { data: summaryData } = useQuery<{ summary: MonthlySummary }>({
    queryKey: ["/api/ai/savings/summary"],
    queryFn: () => fetch("/api/ai/savings/summary", { credentials: "include" }).then(r => r.json()),
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai/optimize/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ taskType, prompt, qualityMode }),
      });
      return res.json();
    },
    onSuccess: (data) => setDecision(data.decision),
  });

  const summary = summaryData?.summary;
  const ModeIcon = MODE_INFO[qualityMode].icon;

  return (
    <AppLayout>
      <div className="container max-w-5xl py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Optimiser</h1>
          <p className="text-muted-foreground mt-1">
            VIBA checks whether a task requires premium AI before sending it.
          </p>
        </div>

        {/* Stats row */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Tasks this month", value: summary.totalTasks, suffix: "" },
              { label: "Without premium AI", value: summary.tasksWithoutPremium, suffix: "" },
              { label: "Estimated spend", value: `$${summary.estimatedSpendUsd.toFixed(2)}`, suffix: "" },
              { label: "Estimated saved", value: `$${summary.estimatedSavingsUsd.toFixed(2)}`, suffix: `(${summary.percentageSaved}%)` },
            ].map(({ label, value, suffix }) => (
              <Card key={label} className="bg-card/60 border-border/50">
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold mt-0.5">{value} <span className="text-sm font-normal text-muted-foreground">{suffix}</span></p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">Estimated</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Quality mode selector */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Optimisation Mode</CardTitle>
            <CardDescription>Controls how VIBA routes your AI tasks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              {(["economy", "balanced", "maximum"] as const).map((mode) => {
                const { icon: Icon, label, desc } = MODE_INFO[mode];
                return (
                  <button
                    key={mode}
                    onClick={() => setQualityMode(mode)}
                    className={`text-left p-4 rounded-xl border transition-all ${
                      qualityMode === mode
                        ? "border-primary bg-primary/8 shadow-[0_0_16px_rgba(99,102,241,0.15)]"
                        : "border-border/50 hover:border-border hover:bg-card/60"
                    }`}
                  >
                    <Icon className={`h-4 w-4 mb-2 ${qualityMode === mode ? "text-primary" : "text-muted-foreground"}`} />
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Switch id="useExisting" checked={useExistingFirst} onCheckedChange={setUseExistingFirst} />
              <div>
                <Label htmlFor="useExisting" className="text-sm font-medium cursor-pointer">Use My Existing AI First</Label>
                <p className="text-xs text-muted-foreground">Prefer providers you already pay for before using additional services.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pre-execution preview */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Pre-Execution Cost Preview</CardTitle>
            <CardDescription>See how VIBA would route a task before running it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Task type</Label>
                <Select value={taskType} onValueChange={setTaskType}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["general","grammar","rewriting","summarisation","code_review","bug_diagnosis",
                      "architecture","business_strategy","research","security_review","complex_reasoning",
                      "creative_generation","data_extraction","document_analysis"].map(t => (
                      <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Sample prompt</Label>
              <Textarea
                placeholder="Describe what you want to do…"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={3}
                className="resize-none text-sm"
              />
            </div>
            <Button
              size="sm"
              onClick={() => previewMutation.mutate()}
              disabled={!prompt.trim() || previewMutation.isPending}
            >
              {previewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
              Preview Execution Plan
            </Button>

            {decision && (
              <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-3 mt-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm font-semibold">VIBA Execution Plan</p>
                  <Badge className={`text-xs border ${(METHOD_LABELS[decision.executionMethod] ?? METHOD_LABELS["economy_model"]).color}`}>
                    {(METHOD_LABELS[decision.executionMethod] ?? { label: decision.executionMethod }).label}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  {decision.provider && <div><p className="text-xs text-muted-foreground">Provider</p><p className="font-medium capitalize">{decision.provider}</p></div>}
                  {decision.model && <div><p className="text-xs text-muted-foreground">Model</p><p className="font-medium">{decision.model}</p></div>}
                  <div><p className="text-xs text-muted-foreground">Est. input tokens</p><p className="font-medium">{decision.estimatedInputTokens.toLocaleString()} <span className="text-muted-foreground text-xs">Estimated</span></p></div>
                  <div><p className="text-xs text-muted-foreground">Est. cost</p><p className="font-medium">${decision.estimatedCost.toFixed(4)} <span className="text-muted-foreground text-xs">Estimated</span></p></div>
                  <div><p className="text-xs text-muted-foreground">Without VIBA</p><p className="font-medium">${decision.estimatedCostWithoutViba.toFixed(4)} <span className="text-muted-foreground text-xs">Estimated</span></p></div>
                  <div><p className="text-xs text-muted-foreground">Est. saving</p><p className="font-medium text-emerald-400">${decision.estimatedSavings.toFixed(4)} <span className="text-muted-foreground text-xs">Estimated</span></p></div>
                </div>

                {decision.savingsReasons.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">Optimisations applied:</p>
                    {decision.savingsReasons.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-foreground/70">
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        {r}
                      </div>
                    ))}
                  </div>
                )}

                {decision.requiresApproval && (
                  <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
                    <Info className="h-3.5 w-3.5 shrink-0" />
                    This task exceeds your approval threshold and requires confirmation before running.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* How it works */}
        <Card className="border-border/50 bg-card/40">
          <CardHeader>
            <CardTitle className="text-base">How VIBA Routes Your Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[
                ["1", "Cache",          "Reuse a previous result if the task is identical."],
                ["2", "Project Memory", "Pull structured context instead of re-sending history."],
                ["3", "Local Tool",     "Use browser automation or code analysis instead of AI."],
                ["4", "Rule Engine",    "Apply deterministic rules for repeatable findings."],
                ["5", "Economy Model",  "Use a fast, low-cost model for simple tasks."],
                ["6", "Premium Model",  "Use a premium model only when the task requires it."],
                ["7", "Multi-Model",    "Use multiple models only when independent verification is needed."],
              ].map(([n, label, desc]) => (
                <div key={n} className="flex items-start gap-3 py-1.5">
                  <span className="h-5 w-5 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center text-[10px] font-bold text-primary shrink-0 mt-0.5">{n}</span>
                  <div>
                    <span className="text-sm font-medium">{label}</span>
                    <ArrowRight className="h-3 w-3 inline mx-1.5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
