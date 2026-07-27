import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useCreateSession, useGetGithubRepo, useGetSettings, getListSessionsQueryKey, type CreateSessionBody } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  Code2,
  GitBranch,
  Github,
  Loader2,
  LockKeyhole,
  Play,
  ServerCog,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";

const DEFAULT_GOAL = "Audit this repository for production blockers. Check build and type errors, broken imports and routes, frontend/API integration, authentication and environment configuration, security risks, mobile UI failures, and Render deployment readiness. Rank findings by severity, include exact file references, repair the highest-risk issues where safe, run available validation, and provide one consolidated release-readiness result.";

const AUDIT_SCOPE = [
  { icon: Code2, label: "Code and build", detail: "Typecheck, dependencies, routes and imports" },
  { icon: ShieldCheck, label: "Security and integration", detail: "Authentication, APIs and environment configuration" },
  { icon: Smartphone, label: "Mobile and runtime", detail: "Responsive UI, browser behaviour and failure states" },
  { icon: ServerCog, label: "Render readiness", detail: "Deployment configuration, startup and release blockers" },
];

function parseGithubUrl(value: string): { owner: string; repo: string } | null {
  const match = value.trim().match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (!match?.[1] || !match[2]) return null;
  return { owner: match[1], repo: match[2] };
}

export default function RepositoryAuditPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialRepo = params.get("repo") ?? "";
  const initialGoal = params.get("goal") ?? DEFAULT_GOAL;
  const [repoUrl, setRepoUrl] = useState(initialRepo);
  const [goal, setGoal] = useState(initialGoal);
  const parsedRepo = useMemo(() => parseGithubUrl(repoUrl), [repoUrl]);
  const { data: repo, isFetching, isError } = useGetGithubRepo(parsedRepo ?? { owner: "", repo: "" }, {
    query: { enabled: !!parsedRepo, retry: false } as never,
  });
  const { data: settings = [] } = useGetSettings();
  const createSession = useCreateSession();

  useEffect(() => {
    if (!initialRepo) {
      try {
        const pending = JSON.parse(localStorage.getItem("viba_pending_repo_audit") ?? "null") as { repo?: string; goal?: string } | null;
        if (pending?.repo) setRepoUrl(pending.repo);
        if (pending?.goal) setGoal(pending.goal);
      } catch {}
    }
  }, [initialRepo]);

  const configured = new Set(settings.filter((item) => item.value && item.value !== "").map((item) => item.key.toUpperCase()));
  const repositoryReady = !!parsedRepo && !!repo && !isError;
  const privateRepo = repo?.private === true;
  const liveProviderCount = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY"].filter((key) => configured.has(key)).length;
  const canStart = repositoryReady && !isFetching && !createSession.isPending && goal.trim().length > 0;

  const startAudit = () => {
    if (!parsedRepo) {
      toast({ title: "Valid GitHub repository required", description: "Enter a repository URL such as https://github.com/owner/repository.", variant: "destructive" });
      return;
    }
    if (!repositoryReady) {
      toast({ title: "Repository access not verified", description: "Confirm the repository exists and connect GitHub access for private repositories.", variant: "destructive" });
      return;
    }

    const agents: CreateSessionBody["agents"] = [
      { name: "ChatGPT", provider: "OpenAI", role: "Strategist", isMock: !configured.has("OPENAI_API_KEY"), canUseTools: true },
      { name: "Claude", provider: "Anthropic", role: "Code Reviewer", isMock: !configured.has("ANTHROPIC_API_KEY"), canUseTools: true },
      { name: "Groq", provider: "Groq", role: "Final QA", isMock: !configured.has("GROQ_API_KEY"), canUseTools: true },
    ];

    const data: CreateSessionBody = {
      goal: goal.trim() || DEFAULT_GOAL,
      autonomyMode: "Supervised",
      agents,
      repoUrl: repoUrl.trim(),
      repoBranch: repo.defaultBranch ?? "main",
      workspaceEnv: "production",
    };

    createSession.mutate({ data }, {
      onSuccess: (session) => {
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        try {
          localStorage.removeItem("viba_pending_repo_audit");
          localStorage.setItem("viba_last_repo", repoUrl.trim());
          localStorage.setItem("viba_last_branch", repo.defaultBranch ?? "main");
          localStorage.setItem("viba_last_env", "production");
        } catch {}
        navigate(`/sessions/${session.id}`);
      },
      onError: () => toast({ title: "Audit session could not be created", description: "Check provider and GitHub connections, then try again.", variant: "destructive" }),
    });
  };

  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-6xl space-y-6 pb-28 sm:pb-8">
        <button type="button" onClick={() => navigate("/")} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md">
          <ArrowLeft className="h-4 w-4" /> Back to V.I.B.A.
        </button>

        <section className="overflow-hidden rounded-2xl border bg-gradient-to-br from-background via-background to-primary/5 shadow-sm">
          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.35fr_0.65fr] lg:p-10">
            <div>
              <Badge variant="outline" className="mb-4 gap-1.5 bg-background/80"><ShieldCheck className="h-3.5 w-3.5" /> Production repository audit</Badge>
              <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">Verify the repository before release.</h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">V.I.B.A. checks the repository, creates a supervised multi-agent audit and returns one evidence-based release decision.</p>
              <div className="mt-6 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border bg-background/70 px-3 py-1.5">No duplicate workflow</span>
                <span className="rounded-full border bg-background/70 px-3 py-1.5">Exact file references</span>
                <span className="rounded-full border bg-background/70 px-3 py-1.5">Approval before sensitive changes</span>
              </div>
            </div>

            <div className="rounded-xl border bg-background/80 p-5 shadow-sm backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Preflight status</p>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-4"><span className="text-sm text-muted-foreground">Repository</span><span className="inline-flex items-center gap-1.5 text-sm font-medium">{repositoryReady ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <CircleDot className="h-4 w-4 text-muted-foreground" />}{repositoryReady ? "Verified" : "Waiting"}</span></div>
                <div className="flex items-center justify-between gap-4"><span className="text-sm text-muted-foreground">Execution</span><span className="text-sm font-medium">Supervised</span></div>
                <div className="flex items-center justify-between gap-4"><span className="text-sm text-muted-foreground">Environment</span><span className="text-sm font-medium">Production</span></div>
                <div className="flex items-center justify-between gap-4"><span className="text-sm text-muted-foreground">Live providers</span><span className="text-sm font-medium">{liveProviderCount}/3 configured</span></div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <Card className="overflow-hidden">
              <CardHeader className="border-b bg-muted/20">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg border bg-background p-2"><Github className="h-5 w-5" /></div>
                  <div><CardTitle>Repository preflight</CardTitle><CardDescription className="mt-1">Confirm the exact repository V.I.B.A. should inspect.</CardDescription></div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                <div className="space-y-2">
                  <Label htmlFor="repository-url">GitHub repository URL</Label>
                  <div className="relative">
                    <Github className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="repository-url" value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="https://github.com/owner/repository" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="h-11 pl-9" aria-describedby="repository-help repository-status" />
                  </div>
                  <p id="repository-help" className="text-xs text-muted-foreground">Public repositories verify directly. Private repositories require connected GitHub access.</p>
                </div>

                <div id="repository-status" aria-live="polite">
                  {!parsedRepo && repoUrl.trim() && <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-semibold">Invalid GitHub repository URL</p><p className="mt-1 text-destructive/80">Use the complete URL, for example https://github.com/owner/repository.</p></div></div>}
                  {parsedRepo && isFetching && <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Verifying repository access…</div>}
                  {repositoryReady && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /><p className="truncate font-semibold">{repo.fullName ?? `${parsedRepo.owner}/${parsedRepo.repo}`}</p></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><span className="inline-flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" />{repo.defaultBranch ?? "main"}</span><span>{privateRepo ? "Private repository" : "Public repository"}</span></div></div><Badge className="w-fit gap-1.5 bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />Access verified</Badge></div></div>}
                  {parsedRepo && isError && <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" /><div><p className="font-semibold">Repository access could not be verified</p><p className="mt-1 text-sm text-muted-foreground">The repository may be private, unavailable or not connected to your GitHub account.</p></div></div>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b bg-muted/20"><CardTitle>Audit objective</CardTitle><CardDescription>Review the scope before the session is created. This becomes the active V.I.B.A. goal.</CardDescription></CardHeader>
              <CardContent className="pt-6">
                <Label htmlFor="audit-objective" className="sr-only">Audit objective</Label>
                <Textarea id="audit-objective" value={goal} onChange={(event) => setGoal(event.target.value)} className="min-h-[220px] resize-y leading-6" maxLength={4000} />
                <div className="mt-2 flex items-center justify-between gap-4 text-xs text-muted-foreground"><span>Be specific about the release risks you want prioritised.</span><span>{goal.length.toLocaleString()}/4,000</span></div>
              </CardContent>
              <CardFooter className="hidden justify-between gap-4 border-t bg-muted/10 sm:flex"><p className="text-xs text-muted-foreground">Supervised execution · production context · consolidated result</p><Button size="lg" onClick={startAudit} disabled={!canStart}><Play className="mr-2 h-4 w-4" />{createSession.isPending ? "Creating audit…" : "Start production audit"}</Button></CardFooter>
            </Card>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" />What V.I.B.A. will check</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {AUDIT_SCOPE.map(({ icon: Icon, label, detail }) => <div key={label} className="flex gap-3"><div className="mt-0.5 rounded-md border bg-muted/30 p-2"><Icon className="h-4 w-4" /></div><div><p className="text-sm font-semibold">{label}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</p></div></div>)}
              </CardContent>
            </Card>

            <Card className="border-primary/20 bg-primary/[0.03]">
              <CardContent className="p-5"><p className="text-sm font-semibold">Before starting</p><p className="mt-2 text-sm leading-6 text-muted-foreground">V.I.B.A. will create a supervised session. It will not merge, deploy or make sensitive production changes without approval.</p></CardContent>
            </Card>
          </aside>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur sm:hidden">
        <Button className="h-12 w-full" onClick={startAudit} disabled={!canStart}><Play className="mr-2 h-4 w-4" />{createSession.isPending ? "Creating audit…" : "Start production audit"}</Button>
      </div>
    </AppLayout>
  );
}
