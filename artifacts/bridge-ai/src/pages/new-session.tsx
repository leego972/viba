import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListSessionsQueryKey,
  useCreateSession,
  useGetGithubRepo,
  useGetSettings,
  useListGithubRepos,
  type CreateSessionBody,
} from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, BrainCircuit, ChevronDown, GitBranch, Loader2, ShieldCheck, Sparkles, Target } from "lucide-react";

const PROVIDERS = [
  { id: "openai", name: "ChatGPT", provider: "OpenAI", key: "OPENAI_API_KEY", role: "Strategist", canUseTools: false },
  { id: "anthropic", name: "Claude", provider: "Anthropic", key: "ANTHROPIC_API_KEY", role: "Code Reviewer", canUseTools: false },
  { id: "google", name: "Gemini", provider: "Google", key: "GEMINI_API_KEY", role: "Researcher", canUseTools: false },
  { id: "perplexity", name: "Perplexity", provider: "Perplexity", key: "PERPLEXITY_API_KEY", role: "Researcher", canUseTools: false },
  { id: "deepseek", name: "DeepSeek", provider: "DeepSeek", key: "DEEPSEEK_API_KEY", role: "Reasoning Agent", canUseTools: true },
  { id: "mistral", name: "Mistral", provider: "Mistral", key: "MISTRAL_API_KEY", role: "Builder", canUseTools: true },
  { id: "venice", name: "Venice AI", provider: "Venice", key: "VENICE_API_KEY", role: "Researcher", canUseTools: false },
  { id: "groq", name: "Groq", provider: "Groq", key: "GROQ_API_KEY", role: "Builder", canUseTools: true },
  { id: "ollama", name: "Ollama", provider: "Ollama", key: "OLLAMA_BASE_URL", role: "Local Agent", canUseTools: true },
  { id: "railway", name: "Railway", provider: "Railway", key: "RAILWAY_TOKEN", role: "DevOps", canUseTools: true },
] as const;

const TEMPLATES = [
  {
    label: "Real System Audit",
    goal: "Verify the actual system works end-to-end. Trace UI actions to backend execution, identify fake or simulated behavior, reproduce failures, fix verified defects, run checks, and keep a detailed evidence log.",
  },
  {
    label: "Bug Hunt",
    goal: "Find and reproduce real defects, determine root causes, implement fixes, validate the results, and record every command, provider action, file change, and remaining blocker.",
  },
  {
    label: "Feature Build",
    goal: "Plan and implement the requested feature end-to-end, including real repository changes, tests, integration validation, and an execution report.",
  },
  {
    label: "Release Readiness",
    goal: "Audit release readiness using real build, typecheck, test, provider, deployment, security, and UI evidence. Fix critical defects and provide a verified release decision.",
  },
] as const;

const WORKSPACE_ENVS = ["development", "staging", "production"];

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.trim().match(/^https?:\/\/github\.com\/([^/]+)\/([^/?.]+?)(?:\.git)?(?:\/.*)?$/);
  return match?.[1] && match[2] ? { owner: match[1], repo: match[2] } : null;
}

export default function NewSession() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const createSession = useCreateSession();
  const { toast } = useToast();
  const { data: settings = [] } = useGetSettings();

  const query = new URLSearchParams(window.location.search);
  const initialRepo = query.get("repo") ?? localStorage.getItem("viba_last_repo") ?? "";
  const initialBranch = query.get("branch") ?? localStorage.getItem("viba_last_branch") ?? "";

  const [goal, setGoal] = useState("");
  const [autonomyMode, setAutonomyMode] = useState("Supervised");
  const [repoUrl, setRepoUrl] = useState(initialRepo);
  const [repoBranch, setRepoBranch] = useState(initialBranch);
  const [workspaceEnv, setWorkspaceEnv] = useState(localStorage.getItem("viba_last_env") ?? "development");
  const [workspaceOpen, setWorkspaceOpen] = useState(Boolean(initialRepo));
  const [vaultProviders, setVaultProviders] = useState<Set<string>>(new Set());
  const [manualRepo, setManualRepo] = useState<{ owner: string; repo: string } | null>(() => parseGithubUrl(initialRepo));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: githubRepos = [] } = useListGithubRepos({ query: { enabled: workspaceOpen, retry: false } as never });
  const { data: fetchedRepo, isFetching: repoFetching } = useGetGithubRepo(
    manualRepo ?? { owner: "", repo: "" },
    { query: { enabled: Boolean(manualRepo), retry: false } as never },
  );

  useEffect(() => {
    if (fetchedRepo?.defaultBranch && !repoBranch) setRepoBranch(fetchedRepo.defaultBranch);
  }, [fetchedRepo, repoBranch]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(PROVIDERS.map(async (provider): Promise<string | null> => {
      try {
        const response = await fetch(`/api/providers/${provider.id}/keys`, { credentials: "include" });
        if (!response.ok) return null;
        const body = await response.json() as { keys?: unknown[] };
        return body.keys?.length ? provider.id : null;
      } catch {
        return null;
      }
    })).then((results) => {
      if (!cancelled) setVaultProviders(new Set(results.filter((id): id is string => id !== null)));
    });
    return () => { cancelled = true; };
  }, []);

  const configuredKeys = useMemo(
    () => new Set(settings.filter((item) => Boolean(item.value)).map((item) => item.key.toUpperCase())),
    [settings],
  );

  const joinedTeam = useMemo(() => {
    return PROVIDERS.filter((provider) => configuredKeys.has(provider.key) || vaultProviders.has(provider.id)).map((provider) => ({
      name: provider.name,
      provider: provider.provider,
      role: provider.role,
      isMock: false,
      canUseTools: provider.canUseTools,
      credentialLabel: "default",
    }));
  }, [configuredKeys, vaultProviders]);

  const handleRepoChange = (value: string) => {
    setRepoUrl(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const parsed = parseGithubUrl(value);
    if (!parsed) {
      setManualRepo(null);
      return;
    }
    debounceRef.current = setTimeout(() => setManualRepo(parsed), 500);
  };

  const handleSubmit = () => {
    if (!goal.trim()) {
      toast({ title: "Goal required", description: "Describe what VIBA must accomplish.", variant: "destructive" });
      return;
    }
    if (joinedTeam.length === 0) {
      toast({
        title: "No joined AI services",
        description: "Connect at least one AI provider in Connections. VIBA will then choose the best provider for each task automatically.",
        variant: "destructive",
      });
      return;
    }

    const data: CreateSessionBody = {
      goal: goal.trim(),
      autonomyMode,
      agents: joinedTeam,
      ...(repoUrl.trim() ? { repoUrl: repoUrl.trim() } : {}),
      ...(repoBranch.trim() ? { repoBranch: repoBranch.trim() } : {}),
      ...(workspaceEnv ? { workspaceEnv } : {}),
    };

    createSession.mutate({ data }, {
      onSuccess: (session) => {
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        try {
          if (repoUrl.trim()) localStorage.setItem("viba_last_repo", repoUrl.trim());
          if (repoBranch.trim()) localStorage.setItem("viba_last_branch", repoBranch.trim());
          localStorage.setItem("viba_last_env", workspaceEnv);
        } catch {}
        navigate(`/sessions/${session.id}`);
      },
      onError: (error: unknown) => toast({
        title: "Session creation failed",
        description: error instanceof Error ? error.message : "VIBA could not create the mission.",
        variant: "destructive",
      }),
    });
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New VIBA Mission</h1>
          <p className="text-muted-foreground">You define the outcome. VIBA assembles and routes the AI team.</p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              onClick={() => setGoal(template.goal)}
              className="rounded-lg border border-border/60 bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
            >
              <Sparkles className="mb-2 h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">{template.label}</span>
            </button>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Target className="h-5 w-5" /> Mission goal</CardTitle>
            <CardDescription>State the result, evidence standard, and restrictions. VIBA creates and assigns the tasks.</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Verify and fix the real system. Do not claim success without evidence..."
              className="min-h-40 resize-none"
            />
          </CardContent>
        </Card>

        <Collapsible open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer select-none">
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="h-4 w-4" /> Repository and environment
                  <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${workspaceOpen ? "rotate-180" : ""}`} />
                </CardTitle>
                <CardDescription>Connect the real repository so tool-capable agents can inspect and modify it.</CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="grid gap-4 pt-0 sm:grid-cols-3">
                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Repository URL</Label>
                  {githubRepos.length > 0 && (
                    <Select value={repoUrl} onValueChange={(value) => {
                      const selected = githubRepos.find((repo) => repo.htmlUrl === value);
                      setRepoUrl(value);
                      if (selected?.defaultBranch) setRepoBranch(selected.defaultBranch);
                    }}>
                      <SelectTrigger><SelectValue placeholder="Select a connected GitHub repository" /></SelectTrigger>
                      <SelectContent>
                        {githubRepos.map((repo) => (
                          <SelectItem key={repo.htmlUrl} value={repo.htmlUrl ?? ""}>{repo.fullName}{repo.private ? " 🔒" : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="relative">
                    <Input value={repoUrl} onChange={(event) => handleRepoChange(event.target.value)} placeholder="https://github.com/owner/repository" />
                    {repoFetching && <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Branch</Label>
                  <Input value={repoBranch} onChange={(event) => setRepoBranch(event.target.value)} placeholder="main" />
                </div>
                <div className="space-y-1.5">
                  <Label>Environment</Label>
                  <Select value={workspaceEnv} onValueChange={setWorkspaceEnv}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{WORKSPACE_ENVS.map((env) => <SelectItem key={env} value={env}>{env}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Autonomy</CardTitle>
              <CardDescription>Critical and destructive actions remain approval-gated.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {["Manual", "Supervised", "Autonomous"].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAutonomyMode(mode)}
                  className={`w-full rounded-lg border p-3 text-left ${autonomyMode === mode ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <div className="font-semibold">{mode}</div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BrainCircuit className="h-5 w-5" />
                {autonomyMode === "Manual" ? "Manual AI assignment" : "Automatic AI routing"}
              </CardTitle>
              <CardDescription>
                {autonomyMode === "Manual"
                  ? "AI assignment is controlled manually for this mission."
                  : "VIBA automatically selects the best connected AI for each task."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Joined live services</span>
                <Badge variant={joinedTeam.length > 0 ? "default" : "destructive"}>{joinedTeam.length}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {autonomyMode === "Manual"
                  ? "Manual assignment mode is active. Provider choices and execution evidence remain visible in the mission log."
                  : "VIBA compares capability fit, tool access, reliability, quality threshold, and relative model cost for every task. The selected AI and routing reason are shown in the execution log."}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {joinedTeam.map((agent) => <Badge key={agent.provider} variant="secondary">{agent.name}</Badge>)}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardFooter className="flex items-center justify-between pt-6">
            <div className="text-sm text-muted-foreground">
              VIBA will create the task plan, choose each AI, and log the real execution evidence.
            </div>
            <Button onClick={handleSubmit} disabled={createSession.isPending || joinedTeam.length === 0}>
              {createSession.isPending ? "Creating…" : "Start mission"}<ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    </AppLayout>
  );
}
