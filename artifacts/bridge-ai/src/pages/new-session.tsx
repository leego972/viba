import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useCreateSession, getListSessionsQueryKey, useGetSettings, useListGithubRepos, useGetGithubRepo, type CreateSessionBody } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Bot, Target, ShieldCheck, Zap, AlertTriangle, FlaskConical, GitBranch, ChevronDown, Wrench, CheckCircle2, Loader2, Sparkles, Bookmark, BookMarked, Trash2 } from "lucide-react";
import { UpgradePrompt } from "@/components/UpgradePrompt";

const AVAILABLE_PROVIDERS = [
  { id: "openai",     name: "ChatGPT",    provider: "OpenAI",     defaultRole: "Strategist",    color: "bg-green-500",   apiKey: "OPENAI_API_KEY",     canUseTools: false },
  { id: "anthropic",  name: "Claude",     provider: "Anthropic",  defaultRole: "Builder",       color: "bg-orange-500",  apiKey: "ANTHROPIC_API_KEY",  canUseTools: false },
  { id: "groq",       name: "Groq",       provider: "Groq",       defaultRole: "Builder",       color: "bg-rose-500",    apiKey: "GROQ_API_KEY",       canUseTools: true  },
  { id: "ollama",     name: "Ollama",     provider: "Ollama",     defaultRole: "Researcher",    color: "bg-slate-500",   apiKey: "",                   canUseTools: true  },
  { id: "manus",      name: "Manus",      provider: "Manus",      defaultRole: "Code Reviewer", color: "bg-purple-500",  apiKey: "MANUS_API_KEY",      canUseTools: true  },
  { id: "replit",     name: "Replit",     provider: "Replit",     defaultRole: "Builder",       color: "bg-blue-500",    apiKey: "REPLIT_API_KEY",     canUseTools: true  },
  { id: "railway",    name: "Railway",    provider: "Railway",    defaultRole: "DevOps",        color: "bg-violet-500",  apiKey: "RAILWAY_TOKEN",      canUseTools: true  },
  { id: "gemini",     name: "Gemini",     provider: "Google",     defaultRole: "Researcher",    color: "bg-teal-500",    apiKey: "GEMINI_API_KEY",     canUseTools: false },
  { id: "perplexity", name: "Perplexity", provider: "Perplexity", defaultRole: "Researcher",    color: "bg-amber-500",   apiKey: "PERPLEXITY_API_KEY", canUseTools: false },
];

const ROLES = [
  "Strategist",
  "Creative Director",
  "Researcher",
  "Builder",
  "Code Reviewer",
  "UX Reviewer",
  "Final QA"
];

const WORKSPACE_ENVS = ["development", "staging", "production"];

type SavedTeam = {
  name: string;
  agents: Record<string, { selected: boolean; role: string; canUseTools: boolean }>;
  savedAt: string;
};

const SAVED_TEAMS_KEY = "viba_saved_teams";

const SESSION_TEMPLATES: Array<{
  id: string;
  emoji: string;
  label: string;
  description: string;
  goal: string;
  autonomyMode: string;
  agents: Partial<Record<string, string>>;
}> = [
  {
    id: "code-review",
    emoji: "🔍",
    label: "Code Review",
    description: "Security, performance & quality analysis",
    goal: "Perform a comprehensive code review of this repository. Analyse code quality, identify security vulnerabilities, performance bottlenecks, and provide specific improvement suggestions with file references.",
    autonomyMode: "Supervised",
    agents: { openai: "Strategist", anthropic: "Code Reviewer" },
  },
  {
    id: "bug-hunt",
    emoji: "🐛",
    label: "Bug Hunt",
    description: "Systematic bug identification & fix proposals",
    goal: "Systematically identify bugs, edge cases, and logic errors. For each issue found, provide a root cause analysis, the affected location, and a concrete proposed fix.",
    autonomyMode: "Supervised",
    agents: { anthropic: "Code Reviewer", openai: "Final QA", replit: "Builder" },
  },
  {
    id: "feature-build",
    emoji: "⚡",
    label: "Feature Build",
    description: "Plan, build, and test a new feature end-to-end",
    goal: "Design and implement a new feature. Start with a technical spec, then build the implementation, write tests, and prepare a pull request with a clear description.",
    autonomyMode: "Supervised",
    agents: { openai: "Strategist", anthropic: "Builder", replit: "Builder" },
  },
  {
    id: "research-report",
    emoji: "📊",
    label: "Research Report",
    description: "Deep research with structured deliverables",
    goal: "Research the topic thoroughly and produce a structured report: executive summary, key findings, supporting evidence, and prioritised actionable recommendations.",
    autonomyMode: "Autonomous",
    agents: { gemini: "Researcher", perplexity: "Researcher", openai: "Strategist" },
  },
  {
    id: "architecture-review",
    emoji: "🏗️",
    label: "Architecture Review",
    description: "System design analysis & improvement roadmap",
    goal: "Review the system architecture for scalability, reliability, and maintainability. Identify anti-patterns, propose improvements, and outline a prioritised migration roadmap.",
    autonomyMode: "Manual",
    agents: { openai: "Strategist", anthropic: "Code Reviewer", gemini: "Researcher" },
  },
  {
    id: "content-strategy",
    emoji: "✍️",
    label: "Content Strategy",
    description: "Multi-agent content creation & review pipeline",
    goal: "Develop a content strategy and produce polished deliverables. Cover audience analysis, key messaging, content calendar, and draft pieces ready for publication.",
    autonomyMode: "Supervised",
    agents: { openai: "Creative Director", anthropic: "Researcher", gemini: "Final QA" },
  },
];

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const m = url.trim().match(/^https?:\/\/github\.com\/([^/]+)\/([^/?.]+?)(?:\.git)?(?:\/.*)?$/);
  if (!m || !m[1] || !m[2]) return null;
  return { owner: m[1], repo: m[2] };
}

export default function NewSession() {
  const [, setLocation] = useLocation();
  const createSession = useCreateSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading: isSettingsLoading } = useGetSettings();

  const searchParams = new URLSearchParams(window.location.search);
  const initRepo = searchParams.get("repo") ?? "";
  const initBranch = searchParams.get("branch") ?? "";
  // Fall back to last-used values when no URL params are present
  const lastRepo   = !initRepo   ? (localStorage.getItem("viba_last_repo")   ?? "") : "";
  const lastBranch = !initBranch ? (localStorage.getItem("viba_last_branch") ?? "") : "";
  const lastEnv    = localStorage.getItem("viba_last_env") ?? "";

  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [savedTeams, setSavedTeams] = useState<SavedTeam[]>(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_TEAMS_KEY) ?? "[]") as SavedTeam[]; }
    catch { return []; }
  });
  const [saveTeamName, setSaveTeamName] = useState("");
  const [showSaveTeamInput, setShowSaveTeamInput] = useState(false);

  const [goal, setGoal] = useState("");
  const [autonomyMode, setAutonomyMode] = useState("Supervised");
  const [repoUrl, setRepoUrl] = useState(initRepo || lastRepo);
  const [repoBranch, setRepoBranch] = useState(initBranch || lastBranch);
  const [workspaceEnv, setWorkspaceEnv] = useState(lastEnv);
  const [workspaceOpen, setWorkspaceOpen] = useState(!!(initRepo || initBranch || lastRepo));
  const { data: githubRepos } = useListGithubRepos({ query: { enabled: workspaceOpen, retry: false } as never });

  const [manualRepoParams, setManualRepoParams] = useState<{ owner: string; repo: string } | null>(() => {
    if (initRepo && !initBranch) return parseGithubUrl(initRepo);
    return null;
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDropdownUrl = useRef<string>(initRepo || lastRepo);

  const { data: fetchedRepo, isFetching: isFetchingRepo } = useGetGithubRepo(
    manualRepoParams ?? { owner: "", repo: "" },
    { query: { enabled: !!manualRepoParams, retry: false } as never }
  );

  useEffect(() => {
    if (fetchedRepo) {
      if (!repoBranch) setRepoBranch(fetchedRepo.defaultBranch ?? "main");
      if (!workspaceEnv) setWorkspaceEnv("development");
    }
  }, [fetchedRepo]);

  const handleRepoUrlChange = (url: string) => {
    setRepoUrl(url);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = url.trim();

    if (!trimmed || trimmed === lastDropdownUrl.current) {
      setManualRepoParams(null);
      return;
    }

    const parsed = parseGithubUrl(trimmed);
    if (!parsed) {
      setManualRepoParams(null);
      return;
    }

    if (githubRepos) {
      const found = githubRepos.find(r => r.htmlUrl === trimmed);
      if (found) {
        if (!repoBranch) setRepoBranch(found.defaultBranch ?? "main");
        if (!workspaceEnv) setWorkspaceEnv("development");
        setManualRepoParams(null);
        return;
      }
    }

    debounceRef.current = setTimeout(() => {
      setManualRepoParams(parsed);
    }, 600);
  };

  // Multi-key: available labels per provider and per-agent selected label
  const [providerKeyLabels, setProviderKeyLabels] = useState<Record<string, string[]>>({});
  const [credentialLabels, setCredentialLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
    const providers = ["openai", "anthropic", "google", "perplexity", "groq", "manus", "replit", "railway"];
    void Promise.allSettled(
      providers.map(async (id) => {
        try {
          const res = await fetch(`${BASE}/api/providers/${id}/keys`, { credentials: "include" });
          if (!res.ok) return;
          const data = await res.json() as { keys: Array<{ label: string }> };
          const labels = data.keys.map((k) => k.label);
          if (labels.length > 0) {
            setProviderKeyLabels(prev => ({ ...prev, [id]: labels }));
          }
        } catch {}
      })
    );
  }, []);

  const [planKey, setPlanKey] = useState<string | null>(null);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);

  useEffect(() => {
    fetch("/api/billing/status", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.planKey) setPlanKey(d.planKey as string); })
      .catch(() => {});
  }, []);

  const isBasicPlan = planKey === "basic_assessment";

  const [selectedAgents, setSelectedAgents] = useState<Record<string, { selected: boolean; role: string; canUseTools: boolean }>>(() => {
    const initial: Record<string, { selected: boolean; role: string; canUseTools: boolean }> = {};
    AVAILABLE_PROVIDERS.forEach(p => {
      initial[p.id] = { selected: false, role: p.defaultRole, canUseTools: p.canUseTools };
    });
    initial["openai"]!.selected = true;
    initial["anthropic"]!.selected = true;
    return initial;
  });

  const configuredKeys = new Set(
    (settings ?? [])
      .filter(s => s.key.toLowerCase().includes("api_key") && s.value && s.value !== "")
      .map(s => s.key.toUpperCase())
  );

  const isLive = (providerId: string): boolean => {
    const provider = AVAILABLE_PROVIDERS.find(p => p.id === providerId);
    return provider ? configuredKeys.has(provider.apiKey.toUpperCase()) : false;
  };

  const selectedProviderIds = AVAILABLE_PROVIDERS.filter(p => selectedAgents[p.id]!.selected).map(p => p.id);
  const simulatedSelected = selectedProviderIds.filter(id => !isLive(id));

  const selectedNativeToolCapable = AVAILABLE_PROVIDERS
    .filter(p => selectedAgents[p.id]!.selected && p.canUseTools)
    .map(p => p.name);

  const selectedBrokerToolCapable = AVAILABLE_PROVIDERS
    .filter(p => selectedAgents[p.id]!.selected && !p.canUseTools && selectedAgents[p.id]!.canUseTools)
    .map(p => p.name);

  const selectedToolCapable = [...selectedNativeToolCapable, ...selectedBrokerToolCapable];

  const hasRealExecution = repoUrl.trim() !== "" && selectedToolCapable.length > 0;

  const handleAgentToggle = (id: string) => {
    // Basic plan: only 1 external provider allowed (Groq is always free/included)
    const isExternalProvider = id !== "groq" && id !== "ollama";
    if (isBasicPlan && isExternalProvider && !selectedAgents[id]!.selected) {
      const currentExternalCount = AVAILABLE_PROVIDERS.filter(
        p => p.id !== "groq" && p.id !== "ollama" && selectedAgents[p.id]!.selected
      ).length;
      if (currentExternalCount >= 1) {
        setShowUpgradePrompt(true);
        return;
      }
    }
    setSelectedAgents(prev => ({
      ...prev,
      [id]: { ...prev[id]!, selected: !prev[id]!.selected }
    }));
  };

  const handleRoleChange = (id: string, role: string) => {
    setSelectedAgents(prev => ({
      ...prev,
      [id]: { ...prev[id]!, role }
    }));
  };

  const handleToolsToggle = (id: string) => {
    setSelectedAgents(prev => ({
      ...prev,
      [id]: { ...prev[id]!, canUseTools: !prev[id]!.canUseTools }
    }));
  };

  const handleAutoAssign = () => {
    const newAgents = { ...selectedAgents };
    AVAILABLE_PROVIDERS.forEach(p => {
      newAgents[p.id] = { ...newAgents[p.id]!, role: p.defaultRole };
    });
    setSelectedAgents(newAgents);
  };

  const applyTemplate = (tpl: typeof SESSION_TEMPLATES[number]) => {
    setActiveTemplateId(tpl.id);
    setGoal(tpl.goal);
    setAutonomyMode(tpl.autonomyMode);
    const next: Record<string, { selected: boolean; role: string; canUseTools: boolean }> = {};
    AVAILABLE_PROVIDERS.forEach(p => {
      next[p.id] = { selected: p.id in tpl.agents, role: tpl.agents[p.id] ?? p.defaultRole, canUseTools: p.canUseTools };
    });
    setSelectedAgents(next);
  };

  const persistSavedTeams = (teams: SavedTeam[]) => {
    setSavedTeams(teams);
    try { localStorage.setItem(SAVED_TEAMS_KEY, JSON.stringify(teams)); } catch {}
  };

  const handleSaveTeam = () => {
    const name = saveTeamName.trim();
    if (!name) return;
    const team: SavedTeam = { name, agents: selectedAgents, savedAt: new Date().toISOString() };
    persistSavedTeams([...savedTeams.filter(t => t.name !== name), team]);
    setSaveTeamName("");
    setShowSaveTeamInput(false);
    toast({ title: "Team saved", description: `"${name}" saved for future sessions.` });
  };

  const handleLoadTeam = (team: SavedTeam) => {
    setSelectedAgents(team.agents);
    setActiveTemplateId(null);
    toast({ title: "Team loaded", description: `"${team.name}" applied.` });
  };

  const handleDeleteTeam = (name: string) => {
    persistSavedTeams(savedTeams.filter(t => t.name !== name));
  };

  const handleSubmit = () => {
    if (!goal.trim()) {
      toast({ title: "Goal required", description: "Please enter a project goal.", variant: "destructive" });
      return;
    }

    const agentsList = AVAILABLE_PROVIDERS
      .filter(p => selectedAgents[p.id]!.selected)
      .map(p => ({
        name: p.name,
        provider: p.provider,
        role: selectedAgents[p.id]!.role,
        isMock: !isLive(p.id),
        canUseTools: selectedAgents[p.id]!.canUseTools,
        credentialLabel: credentialLabels[p.id] ?? "default",
      }));

    if (agentsList.length === 0) {
      toast({ title: "Agents required", description: "Please select at least one agent.", variant: "destructive" });
      return;
    }

    const sessionData: CreateSessionBody = { goal, autonomyMode, agents: agentsList };
    if (repoUrl.trim())      sessionData.repoUrl      = repoUrl.trim();
    if (repoBranch.trim())   sessionData.repoBranch   = repoBranch.trim();
    if (workspaceEnv)        sessionData.workspaceEnv = workspaceEnv;

    createSession.mutate(
      { data: sessionData },
      {
        onSuccess: (session) => {
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
          try {
            if (repoUrl.trim()) localStorage.setItem("viba_last_repo", repoUrl.trim());
            if (repoBranch.trim()) localStorage.setItem("viba_last_branch", repoBranch.trim());
            if (workspaceEnv) localStorage.setItem("viba_last_env", workspaceEnv);
          } catch {}
          setLocation(`/sessions/${session.id}`);
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to create session.", variant: "destructive" });
        }
      }
    );
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New Session</h1>
          <p className="text-muted-foreground">Configure your agents and project goal</p>
        </div>

        {/* Quick-start Templates */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-3">
            <Sparkles className="h-3.5 w-3.5" /> Quick-start templates
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SESSION_TEMPLATES.map(tpl => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => applyTemplate(tpl)}
                className={`text-left p-3 rounded-lg border transition-all ${
                  activeTemplateId === tpl.id
                    ? "border-primary bg-primary/10 shadow-sm shadow-primary/20"
                    : "border-border/60 bg-card hover:border-primary/40 hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base leading-none">{tpl.emoji}</span>
                  <span className="text-sm font-semibold leading-tight">{tpl.label}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">{tpl.description}</p>
              </button>
            ))}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Target className="h-5 w-5" /> Project Goal</CardTitle>
            <CardDescription>What should the AI team build or accomplish?</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea 
              placeholder="E.g., Build a personal finance tracker web app using React and Tailwind. The app should allow users to add expenses, categorize them, and see a monthly summary chart."
              className="min-h-[150px] resize-none"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </CardContent>
        </Card>

        {/* Workspace Context (optional) */}
        <Collapsible open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg select-none">
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="h-4 w-4" />
                  Workspace Context
                  <span className="text-xs font-normal text-muted-foreground ml-1">(optional)</span>
                  {hasRealExecution ? (
                    <Badge className="text-[10px] h-4 px-1.5 bg-emerald-500/15 text-emerald-600 border-emerald-500/30 gap-0.5">
                      <Zap className="h-2.5 w-2.5" /> Real execution
                    </Badge>
                  ) : (repoUrl || repoBranch || workspaceEnv) ? (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">configured</Badge>
                  ) : null}
                  <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${workspaceOpen ? "rotate-180" : ""}`} />
                </CardTitle>
                <CardDescription className="text-xs">
                  Connect a git repo so tool-capable agents (Replit, Manus) can clone, run, and deploy code.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 grid sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 flex flex-col gap-1.5">
                  <Label className="text-xs">Repository URL</Label>
                  {githubRepos && githubRepos.length > 0 && (
                    <Select
                      value={repoUrl}
                      onValueChange={(val) => {
                        const repo = githubRepos.find(r => r.htmlUrl === val);
                        lastDropdownUrl.current = val;
                        setRepoUrl(val);
                        setManualRepoParams(null);
                        if (repo) {
                          if (!repoBranch) setRepoBranch(repo.defaultBranch ?? "main");
                          if (!workspaceEnv) setWorkspaceEnv("development");
                        }
                      }}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Pick from your GitHub repos…" />
                      </SelectTrigger>
                      <SelectContent>
                        {githubRepos.map(r => (
                          <SelectItem key={r.htmlUrl} value={r.htmlUrl ?? ""} className="text-xs">
                            {r.fullName}{r.private ? " 🔒" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="relative">
                    <Input
                      placeholder={githubRepos && githubRepos.length > 0 ? "Or paste URL directly…" : "https://github.com/owner/repo"}
                      value={repoUrl}
                      onChange={(e) => handleRepoUrlChange(e.target.value)}
                      className="h-8 text-sm pr-8"
                    />
                    {isFetchingRepo && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Branch</Label>
                  <Input
                    placeholder="main"
                    value={repoBranch}
                    onChange={(e) => setRepoBranch(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Environment</Label>
                  <Select value={workspaceEnv} onValueChange={setWorkspaceEnv}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {WORKSPACE_ENVS.map(env => (
                        <SelectItem key={env} value={env} className="text-xs capitalize">{env}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Autonomy Mode</CardTitle>
              <CardDescription>How much independence should the team have?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                {[
                  { value: "Manual", desc: "You must trigger every single step manually." },
                  { value: "Supervised", desc: "Runs autonomously but pauses for approval on critical actions." },
                  { value: "Autonomous", desc: "Runs without interruption. Highest risk of cost/errors." }
                ].map(mode => (
                  <div 
                    key={mode.value}
                    role="button"
                    tabIndex={0}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${autonomyMode === mode.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                    onClick={() => setAutonomyMode(mode.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAutonomyMode(mode.value); } }}
                    aria-pressed={autonomyMode === mode.value}
                  >
                    <div className="font-semibold">{mode.value}</div>
                    <div className="text-sm text-muted-foreground">{mode.desc}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" /> Assemble Team</CardTitle>
                  <CardDescription>
                    Select agents and assign roles.
                    {isBasicPlan && <span className="ml-1 text-indigo-400 font-medium">· Basic: 1 external provider</span>}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {savedTeams.length > 0 && (
                    <Select onValueChange={(name) => {
                      const t = savedTeams.find(s => s.name === name);
                      if (t) handleLoadTeam(t);
                    }}>
                      <SelectTrigger className="h-7 text-xs w-auto min-w-[90px] gap-1 pr-2">
                        <BookMarked className="h-3 w-3 shrink-0" />
                        <SelectValue placeholder="Load…" />
                      </SelectTrigger>
                      <SelectContent>
                        {savedTeams.map(t => (
                          <SelectItem key={t.name} value={t.name} className="text-xs">
                            <div className="flex items-center justify-between gap-4 w-full">
                              <span>{t.name}</span>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleDeleteTeam(t.name); }}
                                className="text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {showSaveTeamInput ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        className="h-7 px-2 text-xs rounded border border-border bg-background w-28 focus:outline-none focus:ring-1 focus:ring-primary"
                        placeholder="Team name…"
                        value={saveTeamName}
                        onChange={e => setSaveTeamName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") handleSaveTeam();
                          if (e.key === "Escape") { setShowSaveTeamInput(false); setSaveTeamName(""); }
                        }}
                      />
                      <Button size="sm" className="h-7 px-2 text-xs" onClick={handleSaveTeam} disabled={!saveTeamName.trim()}>Save</Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowSaveTeamInput(true)}>
                      <Bookmark className="h-3 w-3" /> Save team
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAutoAssign}>Auto-assign</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {showUpgradePrompt && (
                <div className="mb-3">
                  <UpgradePrompt
                    variant="banner"
                    feature="multi-agent collaboration"
                    onDismiss={() => setShowUpgradePrompt(false)}
                  />
                </div>
              )}
              <div className="space-y-3">
                {AVAILABLE_PROVIDERS.map(provider => {
                  const live = isLive(provider.id);
                  const isExternalProvider = provider.id !== "groq" && provider.id !== "ollama";
                  const currentExternalCount = AVAILABLE_PROVIDERS.filter(
                    p => p.id !== "groq" && p.id !== "ollama" && selectedAgents[p.id]!.selected
                  ).length;
                  const lockedForBasic = isBasicPlan && isExternalProvider &&
                    !selectedAgents[provider.id]!.selected && currentExternalCount >= 1;
                  return (
                    <div key={provider.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-2 rounded-md hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {lockedForBasic ? (
                          <div className="flex items-center h-4 w-4 justify-center">
                            <span title="Upgrade to Pro for multi-agent collaboration" className="text-indigo-400/60 text-xs">🔒</span>
                          </div>
                        ) : (
                        <Checkbox 
                          id={`agent-${provider.id}`} 
                          checked={selectedAgents[provider.id]!.selected}
                          onCheckedChange={() => handleAgentToggle(provider.id)}
                        />
                        )}
                        <Label htmlFor={`agent-${provider.id}`} className="cursor-pointer flex items-center gap-2 min-w-0">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${provider.color}`} />
                          <span className="font-medium truncate">{provider.name}</span>
                          {live ? (
                            <Badge variant="outline" className="text-green-600 border-green-500/40 bg-green-500/10 gap-1 px-1.5 py-0 text-[10px] flex-shrink-0">
                              <Zap className="h-2.5 w-2.5" /> Live
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30 bg-muted/40 gap-1 px-1.5 py-0 text-[10px] flex-shrink-0">
                              <FlaskConical className="h-2.5 w-2.5" /> Simulation
                            </Badge>
                          )}
                          {provider.canUseTools ? (
                            <Badge variant="outline" className="text-blue-500 border-blue-500/30 bg-blue-500/10 gap-1 px-1.5 py-0 text-[10px] flex-shrink-0" title="Uses its own native tool stack (git, code execution, deployment). You pay for these via your existing subscription — VIBA charges only a platform orchestration fee.">
                              <Wrench className="h-2.5 w-2.5" /> Native Tools
                            </Badge>
                          ) : selectedAgents[provider.id]!.canUseTools ? (
                            <Badge variant="outline" className="text-violet-500 border-violet-500/30 bg-violet-500/10 gap-1 px-1.5 py-0 text-[10px] flex-shrink-0" title="Uses VIBA's broker tool suite (GitHub, Railway, Stripe, DNS, Browser, SMTP). Credits charged per tool call.">
                              <Wrench className="h-2.5 w-2.5" /> Broker Tools
                            </Badge>
                          ) : null}
                        </Label>
                      </div>
                      {selectedAgents[provider.id]!.selected && (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Select 
                            value={selectedAgents[provider.id]!.role} 
                            onValueChange={(val) => handleRoleChange(provider.id, val)}
                          >
                            <SelectTrigger className="w-[130px] sm:w-[140px] h-8 text-xs flex-shrink-0">
                              <SelectValue placeholder="Select role" />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLES.map(role => (
                                <SelectItem key={role} value={role} className="text-xs">{role}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {/* Multi-key: show account picker when provider has >1 saved key */}
                          {(providerKeyLabels[provider.id]?.length ?? 0) > 1 && (
                            <Select
                              value={credentialLabels[provider.id] ?? "default"}
                              onValueChange={(val) => setCredentialLabels(prev => ({ ...prev, [provider.id]: val }))}
                            >
                              <SelectTrigger className="w-[110px] h-8 text-xs flex-shrink-0" title="Which API account to use">
                                <SelectValue placeholder="Account" />
                              </SelectTrigger>
                              <SelectContent>
                                {providerKeyLabels[provider.id]!.map(label => (
                                  <SelectItem key={label} value={label} className="text-xs">{label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          {!provider.canUseTools && (
                            <button
                              type="button"
                              title={selectedAgents[provider.id]!.canUseTools ? "Disable tool access" : "Enable tool access"}
                              onClick={() => handleToolsToggle(provider.id)}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                                selectedAgents[provider.id]!.canUseTools
                                  ? "border-blue-500/40 bg-blue-500/10 text-blue-500"
                                  : "border-muted-foreground/20 bg-muted/30 text-muted-foreground"
                              }`}
                            >
                              <Wrench className="h-2.5 w-2.5" />
                              Tools
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {selectedToolCapable.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-[11px] text-blue-500/80 flex items-center gap-1.5">
                    <Wrench className="h-3 w-3" />
                    <span><strong>{selectedToolCapable.join(", ")}</strong> {selectedToolCapable.length === 1 ? "can" : "can"} run code and execute git operations.</span>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {hasRealExecution && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 flex gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-emerald-700 dark:text-emerald-300 text-sm flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5" /> Real execution enabled
              </h3>
              <p className="text-sm text-emerald-700/80 dark:text-emerald-300/80 mt-0.5">
                <strong>{selectedToolCapable.join(", ")}</strong> will clone <strong>{repoUrl.replace("https://github.com/", "")}</strong>{repoBranch ? ` (${repoBranch})` : ""} and run code directly.{" "}
                {workspaceEnv && <span>Environment: <strong className="capitalize">{workspaceEnv}</strong>.</span>}
              </p>
            </div>
          </div>
        )}

        {simulatedSelected.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-700 dark:text-amber-300 text-sm">
                {simulatedSelected.length === 1 ? "1 agent will run in simulation" : `${simulatedSelected.length} agents will run in simulation`}
              </h3>
              <p className="text-sm text-amber-700/80 dark:text-amber-300/80 mt-0.5">
                {simulatedSelected
                  .map(id => AVAILABLE_PROVIDERS.find(p => p.id === id)?.name)
                  .join(", ")}{" "}
                {simulatedSelected.length === 1 ? "has" : "have"} no API key configured and will use simulated output.{" "}
                <a href="/settings" className="underline underline-offset-2 font-medium hover:text-amber-800 dark:hover:text-amber-200">
                  Add keys in Settings
                </a>{" "}
                to enable live AI.
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button size="lg" className="px-8 gap-2" onClick={handleSubmit} disabled={createSession.isPending || isSettingsLoading}>
            {createSession.isPending ? "Starting..." : "Start Session"} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
