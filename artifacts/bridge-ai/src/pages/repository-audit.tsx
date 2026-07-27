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
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, GitBranch, Loader2, LockKeyhole, Play, ShieldCheck } from "lucide-react";

const DEFAULT_GOAL = "Audit this repository for production blockers. Check build and type errors, broken imports and routes, frontend/API integration, authentication and environment configuration, security risks, mobile UI failures, and Render deployment readiness. Rank findings by severity, include exact file references, repair the highest-risk issues where safe, run available validation, and provide one consolidated release-readiness result.";

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

  const configured = new Set(
    settings.filter((item) => item.value && item.value !== "").map((item) => item.key.toUpperCase()),
  );
  const repositoryReady = !!parsedRepo && !!repo && !isError;
  const privateRepo = repo?.private === true;

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
      { name: "ChatGPT", provider: "OpenAI", role: "Strategist", isMock: !configured.has("OPENAI_API_KEY"), canUseTools: true, credentialLabel: "default" },
      { name: "Claude", provider: "Anthropic", role: "Code Reviewer", isMock: !configured.has("ANTHROPIC_API_KEY"), canUseTools: true, credentialLabel: "default" },
      { name: "Groq", provider: "Groq", role: "Final QA", isMock: !configured.has("GROQ_API_KEY"), canUseTools: true, credentialLabel: "default" },
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
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <Badge variant="outline" className="mb-3 gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Production repository audit</Badge>
          <h1 className="text-3xl font-bold tracking-tight">Verify the repository before release</h1>
          <p className="text-muted-foreground mt-2">V.I.B.A. will use the existing session, agents, GitHub tools and audit trail. Nothing is duplicated.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5" /> Repository preflight</CardTitle>
            <CardDescription>Public repositories can be verified directly. Private repositories require connected GitHub access.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="https://github.com/owner/repository" autoCapitalize="none" autoCorrect="off" />
            {!parsedRepo && repoUrl.trim() && <div className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="h-4 w-4" /> Invalid GitHub repository URL.</div>}
            {parsedRepo && isFetching && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Verifying repository access…</div>}
            {repositoryReady && <div className="rounded-lg border bg-muted/30 p-4 flex items-start justify-between gap-4"><div><p className="font-semibold">{repo.fullName ?? `${parsedRepo.owner}/${parsedRepo.repo}`}</p><p className="text-sm text-muted-foreground mt-1">Branch: {repo.defaultBranch ?? "main"}</p></div><Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> {privateRepo ? "Private access verified" : "Public access verified"}</Badge></div>}
            {parsedRepo && isError && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3"><LockKeyhole className="h-5 w-5 text-amber-500 shrink-0" /><div><p className="font-semibold">Repository access could not be verified</p><p className="text-sm text-muted-foreground mt-1">The repository may be private, unavailable, or not connected to your GitHub account.</p></div></div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Audit objective</CardTitle><CardDescription>This becomes the existing V.I.B.A. session goal.</CardDescription></CardHeader>
          <CardContent><Textarea value={goal} onChange={(event) => setGoal(event.target.value)} className="min-h-[190px]" /></CardContent>
          <CardFooter className="justify-between gap-4 flex-wrap"><p className="text-xs text-muted-foreground">Supervised execution · production context · consolidated result</p><Button onClick={startAudit} disabled={createSession.isPending || isFetching || !repositoryReady}><Play className="h-4 w-4 mr-2" />{createSession.isPending ? "Creating audit…" : "Start production audit"}</Button></CardFooter>
        </Card>
      </div>
    </AppLayout>
  );
}
