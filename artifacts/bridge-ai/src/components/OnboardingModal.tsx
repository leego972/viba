import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight, ArrowLeft, CheckCircle2, Zap, Shield, Rocket,
  Bot, Cpu, Key, Eye, EyeOff, X, Sparkles,
} from "lucide-react";

const ONBOARDING_KEY = "viba_onboarded_v2";

type Step = "welcome" | "intent" | "connect" | "goal" | "ready";
const STEPS: Step[] = ["welcome", "intent", "connect", "goal", "ready"];

type IntentKey = "assess" | "repo" | "repair" | "security" | "collaborate";
const INTENTS: Array<{ key: IntentKey; emoji: string; label: string; sub: string; requiresPro: boolean }> = [
  { key: "assess",      emoji: "🔍", label: "Assess my website",           sub: "Scans, Lighthouse, SEO, accessibility", requiresPro: false },
  { key: "repo",        emoji: "📦", label: "Check my repository",         sub: "Code quality, dependency audit",        requiresPro: false },
  { key: "repair",      emoji: "🔧", label: "Repair build / UI issues",    sub: "AI-assisted fix, PR creation",          requiresPro: true  },
  { key: "security",    emoji: "🛡️", label: "Run a security audit",        sub: "OWASP, TLS, headers, deep scan",        requiresPro: true  },
  { key: "collaborate", emoji: "🤝", label: "Coordinate multiple AIs",     sub: "Specialist roles, multi-agent session", requiresPro: true  },
];

interface ProviderCard {
  id: string;
  label: string;
  description: string;
  free?: boolean;
  placeholder: string;
  color: string;
}

const PROVIDERS: ProviderCard[] = [
  {
    id: "groq",
    label: "Groq",
    description: "Included free — no key needed",
    free: true,
    placeholder: "",
    color: "emerald",
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT-4o, GPT-4o-mini",
    placeholder: "sk-...",
    color: "blue",
  },
  {
    id: "anthropic",
    label: "Claude",
    description: "Claude 3.5 Sonnet, Haiku",
    placeholder: "sk-ant-...",
    color: "amber",
  },
  {
    id: "gemini",
    label: "Gemini",
    description: "Gemini 1.5 Flash, Pro",
    placeholder: "AIza...",
    color: "violet",
  },
];

const COLOR_MAP: Record<string, string> = {
  emerald: "border-emerald-500/40 bg-emerald-500/8 text-emerald-300",
  blue:    "border-blue-500/40 bg-blue-500/8 text-blue-300",
  amber:   "border-amber-500/40 bg-amber-500/8 text-amber-300",
  violet:  "border-violet-500/40 bg-violet-500/8 text-violet-300",
};

const SELECTED_MAP: Record<string, string> = {
  emerald: "border-emerald-500/60 bg-emerald-500/15 ring-2 ring-emerald-500/30",
  blue:    "border-blue-500/60 bg-blue-500/15 ring-2 ring-blue-500/30",
  amber:   "border-amber-500/60 bg-amber-500/15 ring-2 ring-amber-500/30",
  violet:  "border-violet-500/60 bg-violet-500/15 ring-2 ring-violet-500/30",
};

export function useOnboarding() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(ONBOARDING_KEY)) return;
    const t = setTimeout(() => setShow(true), 600);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    localStorage.setItem(ONBOARDING_KEY, "1");
    setShow(false);
  }

  return { show, dismiss };
}

interface OnboardingModalProps {
  onClose: () => void;
}

export function OnboardingModal({ onClose }: OnboardingModalProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [selectedProvider, setSelectedProvider] = useState<string>("groq");
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [goal, setGoal] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [selectedIntent, setSelectedIntent] = useState<IntentKey | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const intentNeedsPro = selectedIntent ? INTENTS.find(i => i.key === selectedIntent)?.requiresPro ?? false : false;

  const stepIdx = STEPS.indexOf(step);
  const provider = PROVIDERS.find(p => p.id === selectedProvider)!;

  function next() { if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1]!); }
  function prev() { if (stepIdx > 0) setStep(STEPS[stepIdx - 1]!); }

  function canNext() {
    if (step === "connect") {
      if (selectedProvider === "groq") return true;
      return keySaved;
    }
    return true;
  }

  async function saveKey() {
    if (!keyInput.trim()) return;
    setSavingKey(true);
    try {
      const res = await fetch(`/api/providers/${selectedProvider}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, key: keyInput.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setKeyInput("");
      setKeySaved(true);
      toast({ title: `${provider.label} connected`, description: "API key saved to your secure vault." });
    } catch {
      toast({ title: "Failed to save key", variant: "destructive" });
    } finally {
      setSavingKey(false);
    }
  }

  function launch() {
    onClose();
    const params = new URLSearchParams();
    if (goal.trim()) params.set("goal", goal.trim());
    if (repoUrl.trim()) params.set("repo", repoUrl.trim());
    const qs = params.toString();
    navigate(qs ? `/sessions/new?${qs}` : "/sessions/new");
  }

  function goToDashboard() {
    onClose();
    navigate("/dashboard");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-2xl border border-white/[0.1] bg-[hsl(var(--background))] shadow-2xl shadow-black/50 overflow-hidden max-h-[88vh] flex flex-col">

        {/* Top gradient bar */}
        <div className="h-[3px] w-full bg-gradient-to-r from-primary/60 via-violet-500/80 to-primary/60 shrink-0" />

        {/* Header row: progress + close */}
        <div className="flex items-center justify-between px-5 pt-4 pb-1 shrink-0">
          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={`rounded-full transition-all duration-300 ${
                  i === stepIdx
                    ? "h-2 w-5 bg-primary"
                    : i < stepIdx
                    ? "h-1.5 w-1.5 bg-primary/50"
                    : "h-1.5 w-1.5 bg-muted/40"
                }`}
              />
            ))}
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">

          {/* ── STEP: welcome ── */}
          {step === "welcome" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Welcome to VIBA</h2>
                  <p className="text-xs text-muted-foreground">Multi-agent AI collaboration — in minutes</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { icon: Bot, label: "Assign AI roles", sub: "Planner, coder, reviewer" },
                  { icon: Zap, label: "Groq free", sub: "No key needed to start" },
                  { icon: Shield, label: "Human-in-loop", sub: "Approve before any action" },
                  { icon: Cpu, label: "BYOK", sub: "OpenAI, Claude, Gemini" },
                ].map(({ icon: Icon, label, sub }) => (
                  <div key={label} className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
                    <Icon className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium leading-tight">{label}</p>
                      <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── STEP: intent ── */}
          {step === "intent" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">What do you want to do?</h2>
                <p className="text-sm text-muted-foreground mt-0.5">We'll recommend the right plan and setup for you.</p>
              </div>
              <div className="space-y-2">
                {INTENTS.map(({ key, emoji, label, sub, requiresPro }) => {
                  const isSelected = selectedIntent === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedIntent(key)}
                      className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-150 ${
                        isSelected
                          ? "border-primary/50 bg-primary/10 ring-1 ring-primary/20"
                          : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.15]"
                      }`}
                    >
                      <span className="text-xl shrink-0">{emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{sub}</p>
                      </div>
                      {requiresPro && (
                        <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/40 bg-indigo-500/15 text-indigo-400">
                          PRO
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {intentNeedsPro && (
                <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/8 px-4 py-3 text-sm text-zinc-400">
                  <span className="font-medium text-indigo-300">Pro plan recommended</span> — {selectedIntent === "collaborate" ? "Multi-agent collaboration" : selectedIntent === "security" ? "Deep security audits" : "Repair actions"} require VIBA Pro Repair ($89/mo). You can start with a 7-day free trial.
                </div>
              )}
            </div>
          )}

          {/* ── STEP: connect ── */}
          {step === "connect" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">Connect your AI</h2>
                <p className="text-sm text-muted-foreground mt-0.5">Groq is free and ready to go. Add another provider for more power.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {PROVIDERS.map((p) => {
                  const isSelected = selectedProvider === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedProvider(p.id); setKeySaved(false); setKeyInput(""); }}
                      className={`relative flex flex-col gap-1 rounded-xl border px-3.5 py-3 text-left transition-all duration-150 ${
                        isSelected ? SELECTED_MAP[p.color]! : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.05]"
                      }`}
                    >
                      {p.free && (
                        <Badge className={`absolute top-2 right-2 text-[10px] h-4 px-1.5 ${COLOR_MAP[p.color]}`}>
                          Free
                        </Badge>
                      )}
                      {isSelected && !p.free && (
                        <div className="absolute top-2 right-2">
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      <span className="text-sm font-semibold pr-8">{p.label}</span>
                      <span className="text-[11px] text-muted-foreground">{p.description}</span>
                    </button>
                  );
                })}
              </div>

              {selectedProvider !== "groq" && !keySaved && (
                <div className="space-y-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                  <Label className="text-xs font-medium flex items-center gap-1.5">
                    <Key className="h-3 w-3" />
                    {provider.label} API key
                  </Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showKey ? "text" : "password"}
                        placeholder={provider.placeholder}
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                        className="pr-9 font-mono text-xs bg-background/50"
                        autoComplete="off"
                        onKeyDown={(e) => { if (e.key === "Enter" && keyInput.trim()) void saveKey(); }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => void saveKey()}
                      disabled={savingKey || !keyInput.trim()}
                      className="shrink-0"
                    >
                      {savingKey ? "Saving…" : "Save"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Key stored encrypted — never shown after saving.</p>
                </div>
              )}

              {selectedProvider !== "groq" && keySaved && (
                <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-3">
                  <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-emerald-300">{provider.label} connected</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Key saved securely. Your agents will use it in live sessions.</p>
                  </div>
                </div>
              )}

              {selectedProvider === "groq" && (
                <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-3">
                  <Zap className="h-4 w-4 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-emerald-300">Groq is ready — no setup needed</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Fast inference included. Add other providers anytime in Settings → Connections.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP: goal ── */}
          {step === "goal" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">Describe your first task</h2>
                <p className="text-sm text-muted-foreground mt-0.5">What do you want VIBA's agents to work on? Be specific or open-ended.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="onb-goal" className="text-xs">Goal</Label>
                <Textarea
                  id="onb-goal"
                  rows={3}
                  placeholder="e.g. Build a REST API with auth, deploy to Railway, run tests and send me a report"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  className="resize-none text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="onb-repo" className="text-xs">GitHub repo (optional)</Label>
                <Input
                  id="onb-repo"
                  placeholder="https://github.com/your/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="text-sm"
                />
                <p className="text-[11px] text-muted-foreground">VIBA will read the repo and tailor its plan. You can skip this and add it later.</p>
              </div>
            </div>
          )}

          {/* ── STEP: ready ── */}
          {step === "ready" && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                  <Rocket className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">You're all set!</h2>
                  <p className="text-sm text-muted-foreground">VIBA is ready to run your first collaborative session.</p>
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Summary</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">AI provider</span>
                  <span className="font-medium capitalize">{provider.label}</span>
                </div>
                {goal.trim() && (
                  <div className="flex items-start justify-between text-sm gap-4">
                    <span className="text-muted-foreground shrink-0">Goal</span>
                    <span className="font-medium text-right line-clamp-2">{goal}</span>
                  </div>
                )}
                {repoUrl.trim() && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Repo</span>
                    <span className="font-mono text-xs truncate max-w-[220px]">{repoUrl}</span>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Button size="lg" className="w-full gap-2" onClick={launch}>
                  <Rocket className="h-4.5 w-4.5" />
                  Start VIBA Session
                </Button>
                <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={goToDashboard}>
                  Go to Dashboard
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Navigation footer */}
        {step !== "ready" && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.06] shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={prev}
              disabled={stepIdx === 0}
              className="gap-1.5 text-muted-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {stepIdx + 1} of {STEPS.length}
            </span>
            <Button
              size="sm"
              onClick={next}
              disabled={!canNext()}
              className="gap-1.5"
            >
              {step === "goal" && !goal.trim() ? "Skip" : "Next"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
