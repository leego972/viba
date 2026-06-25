import { useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Zap,
  Shield,
  Globe,
  FolderInput,
  Rocket,
  Cpu,
  Bot,
} from "lucide-react";

type Step = "goal" | "groq" | "byok" | "project" | "deploy" | "security" | "start";

const STEPS: Step[] = ["goal", "groq", "byok", "project", "deploy", "security", "start"];

const STEP_LABELS: Record<Step, string> = {
  goal: "Your Goal",
  groq: "AI Default",
  byok: "Custom AI (optional)",
  project: "Project (optional)",
  deploy: "Deployment (optional)",
  security: "Security Check",
  start: "Ready",
};

const DEPLOY_PROVIDERS = [
  { id: "railway", label: "Railway" },
  { id: "render", label: "Render" },
  { id: "digitalocean", label: "DigitalOcean" },
  { id: "vercel", label: "Vercel" },
  { id: "sevall", label: "Sevall" },
  { id: "custom", label: "Custom" },
  { id: "none", label: "Skip for now" },
];

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>("goal");
  const [goal, setGoal] = useState("");
  const [customAiName, setCustomAiName] = useState("");
  const [customAiKey, setCustomAiKey] = useState("");
  const [customAiSaved, setCustomAiSaved] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [deployProvider, setDeployProvider] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const stepIdx = STEPS.indexOf(step);

  function prev() {
    if (stepIdx > 0) setStep(STEPS[stepIdx - 1]!);
  }

  function next() {
    if (step === "goal" && !goal.trim()) {
      toast({ title: "Enter a goal", description: "Tell VIBA what you want to accomplish.", variant: "destructive" });
      return;
    }
    if (stepIdx < STEPS.length - 1) {
      setStep(STEPS[stepIdx + 1]!);
    }
  }

  async function saveCustomKey() {
    if (!customAiKey.trim()) {
      toast({ title: "Enter an API key", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch("/api/credentials/custom-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: customAiName || "Custom AI", key: customAiKey }),
      });
      if (res.ok) {
        setCustomAiKey("");
        setCustomAiSaved(true);
        toast({ title: "Custom AI saved to vault", description: "The key is stored encrypted. It will not be shown again." });
      } else {
        const d = await res.json().catch(() => ({}));
        toast({ title: "Failed to save", description: d.error ?? "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    }
  }

  function startTask() {
    const params = new URLSearchParams();
    if (goal.trim()) params.set("goal", goal.trim());
    if (repoUrl.trim()) params.set("repo", repoUrl.trim());
    if (deployProvider && deployProvider !== "none") params.set("deploy", deployProvider);
    navigate(`/sessions/new?${params.toString()}`);
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        {/* Progress bar */}
        <div className="flex items-center gap-1 mb-8">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`flex-1 h-1 rounded-full transition-all duration-300 ${
                i <= stepIdx ? "bg-primary" : "bg-muted/50"
              }`}
            />
          ))}
        </div>

        {/* Step indicator */}
        <p className="text-xs text-muted-foreground mb-1">
          Step {stepIdx + 1} of {STEPS.length}
        </p>
        <h2 className="text-xl font-semibold mb-6">{STEP_LABELS[step]}</h2>

        {/* ── STEP: goal ── */}
        {step === "goal" && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-xl border border-primary/20 bg-primary/5">
              <Bot className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <p className="text-sm text-muted-foreground">
                VIBA runs AI agents that collaborate to complete your task. Describe what you want to accomplish — be as specific or as open-ended as you like.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal">What do you want VIBA to do?</Label>
              <Textarea
                id="goal"
                rows={4}
                placeholder="e.g. Build a REST API with authentication, connect it to a PostgreSQL database, and deploy to Railway"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="resize-none"
              />
            </div>
          </div>
        )}

        {/* ── STEP: groq ── */}
        {step === "groq" && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
              <Zap className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-emerald-300">Groq is included free</p>
                <p className="text-sm text-muted-foreground">
                  Your agents will use Groq by default — no API key needed. Groq provides fast, high-quality AI for most tasks. You can optionally add your own AI provider in the next step.
                </p>
              </div>
            </div>
            <div className="p-4 rounded-xl border border-border/50 bg-card space-y-2">
              <p className="text-sm font-medium">What Groq gives you</p>
              <ul className="text-sm text-muted-foreground space-y-1.5">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" /> Fast planning and code generation</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" /> Works for the majority of tasks out of the box</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" /> No extra setup required</li>
              </ul>
            </div>
          </div>
        )}

        {/* ── STEP: byok ── */}
        {step === "byok" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              If you have an API key for another AI provider, you can add it here. Your key is stored encrypted and never displayed after saving.
            </p>
            {customAiSaved ? (
              <div className="flex items-center gap-3 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-emerald-300">Custom AI saved to vault</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Your key is stored encrypted. Click Next to continue.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="ai-name">AI provider name (optional)</Label>
                  <Input
                    id="ai-name"
                    placeholder="e.g. My OpenAI Key"
                    value={customAiName}
                    onChange={(e) => setCustomAiName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-key">API key</Label>
                  <Input
                    id="ai-key"
                    type="password"
                    placeholder="sk-..."
                    value={customAiKey}
                    onChange={(e) => setCustomAiKey(e.target.value)}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    The key will not be shown again after saving.
                  </p>
                </div>
                <Button variant="outline" onClick={saveCustomKey} disabled={!customAiKey.trim()}>
                  <Shield className="h-4 w-4 mr-2" />
                  Save to vault
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">You can add or manage keys anytime in the Vault.</p>
          </div>
        )}

        {/* ── STEP: project ── */}
        {step === "project" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Optionally link a GitHub repo or import a project. VIBA will read the code and tailor its plan.
            </p>
            <div className="space-y-2">
              <Label htmlFor="repo-url">GitHub repository URL (optional)</Label>
              <Input
                id="repo-url"
                placeholder="https://github.com/your/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3 p-4 rounded-xl border border-border/50 bg-card/50">
              <FolderInput className="h-5 w-5 text-muted-foreground shrink-0" />
              <p className="text-sm text-muted-foreground">
                You can also import a project zip or describe your existing codebase in the session — skip this for now if you don't have a repo yet.
              </p>
            </div>
          </div>
        )}

        {/* ── STEP: deploy ── */}
        {step === "deploy" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Where do you want to deploy your project? VIBA will configure the deployment target. You can change this later.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEPLOY_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setDeployProvider(p.id)}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-all ${
                    deployProvider === p.id
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/50 bg-card hover:border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Globe className="h-4 w-4 shrink-0" />
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP: security ── */}
        {step === "security" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground mb-2">
              VIBA enforces these protections throughout your session:
            </p>
            {[
              { icon: Shield, label: "Credentials stored encrypted in vault", pass: true },
              { icon: CheckCircle2, label: "Destructive actions require your approval", pass: true },
              { icon: CheckCircle2, label: "Raw API keys never displayed in the UI", pass: true },
              { icon: CheckCircle2, label: "Tool invocations go through approval gate", pass: true },
              { icon: CheckCircle2, label: "Unsafe zip uploads are blocked automatically", pass: true },
              { icon: CheckCircle2, label: "Agent budget limits prevent runaway spending", pass: true },
            ].map(({ icon: Icon, label, pass }) => (
              <div
                key={label}
                className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5"
              >
                <Icon className="h-4 w-4 text-emerald-400 shrink-0" />
                <span className="text-sm text-emerald-200">{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── STEP: start ── */}
        {step === "start" && (
          <div className="space-y-6">
            <div className="p-5 rounded-2xl border border-primary/20 bg-primary/5 space-y-3">
              <p className="text-sm font-medium">Your task summary</p>
              <div className="space-y-2">
                <div className="flex gap-2 text-sm">
                  <span className="text-muted-foreground min-w-[80px]">Goal</span>
                  <span className="text-foreground">{goal || "—"}</span>
                </div>
                <div className="flex gap-2 text-sm">
                  <span className="text-muted-foreground min-w-[80px]">AI</span>
                  <span className="text-foreground">{customAiSaved ? "Groq + Custom AI" : "Groq (free default)"}</span>
                </div>
                {repoUrl && (
                  <div className="flex gap-2 text-sm">
                    <span className="text-muted-foreground min-w-[80px]">Project</span>
                    <span className="text-foreground truncate">{repoUrl}</span>
                  </div>
                )}
                {deployProvider && deployProvider !== "none" && (
                  <div className="flex gap-2 text-sm">
                    <span className="text-muted-foreground min-w-[80px]">Deploy to</span>
                    <span className="text-foreground capitalize">{deployProvider}</span>
                  </div>
                )}
              </div>
            </div>
            <Button size="lg" className="w-full gap-2" onClick={startTask}>
              <Rocket className="h-5 w-5" />
              Start VIBA Task
            </Button>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-4 border-t border-border/40">
          <Button variant="ghost" onClick={prev} disabled={stepIdx === 0} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          {step !== "start" ? (
            <Button onClick={next} className="gap-2">
              {step === "byok" && !customAiKey.trim() && !customAiSaved ? "Skip" : "Next"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
}
