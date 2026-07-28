import { useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Bot, ChevronDown, ChevronUp, Github, Rocket, ShieldCheck, Sparkles } from "lucide-react";

const DEPLOY_PROVIDERS = [
  { id: "none", label: "Decide later" },
  { id: "render", label: "Render" },
  { id: "railway", label: "Railway" },
  { id: "vercel", label: "Vercel" },
  { id: "digitalocean", label: "DigitalOcean" },
  { id: "custom", label: "Another provider" },
];

export default function OnboardingPage() {
  const [goal, setGoal] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [deployProvider, setDeployProvider] = useState("none");
  const [showOptions, setShowOptions] = useState(false);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  function startTask() {
    if (!goal.trim()) {
      toast({
        title: "Enter a task",
        description: "A short description is enough. VIBA will work out the steps.",
        variant: "destructive",
      });
      return;
    }

    const params = new URLSearchParams({ goal: goal.trim() });
    if (repoUrl.trim()) params.set("repo", repoUrl.trim());
    if (deployProvider !== "none") params.set("deploy", deployProvider);
    navigate(`/sessions/new?${params.toString()}`);
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl py-6">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Enter a new task</h1>
          <p className="mt-2 text-muted-foreground">
            Describe the outcome. VIBA will plan the work, choose agents and tools, and ask only when approval is needed.
          </p>
        </div>

        <div className="space-y-5 rounded-2xl border border-border/60 bg-card p-5 shadow-sm sm:p-7">
          <div className="space-y-2">
            <Label htmlFor="goal">Task description</Label>
            <Textarea
              id="goal"
              autoFocus
              rows={6}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="For example: Audit my repository, fix the failing deployment, run the tests, and prepare a pull request."
              className="resize-none text-base"
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") startTask();
              }}
            />
            <p className="text-xs text-muted-foreground">Press Ctrl/⌘ + Enter to start.</p>
          </div>

          <button
            type="button"
            onClick={() => setShowOptions((current) => !current)}
            className="flex w-full items-center justify-between rounded-xl border border-border/50 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40"
            aria-expanded={showOptions}
          >
            <span>
              <span className="font-medium">Optional setup</span>
              <span className="ml-2 text-muted-foreground">Repository and deployment target</span>
            </span>
            {showOptions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showOptions && (
            <div className="grid gap-5 rounded-xl border border-border/40 bg-muted/20 p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="repo-url" className="flex items-center gap-2">
                  <Github className="h-4 w-4" />
                  GitHub repository
                </Label>
                <Input
                  id="repo-url"
                  value={repoUrl}
                  onChange={(event) => setRepoUrl(event.target.value)}
                  placeholder="https://github.com/owner/repository"
                />
                <p className="text-xs text-muted-foreground">Leave blank for a new project.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="deploy-provider">Deployment target</Label>
                <select
                  id="deploy-provider"
                  value={deployProvider}
                  onChange={(event) => setDeployProvider(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {DEPLOY_PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">You can change this during execution.</p>
              </div>
            </div>
          )}

          <Button size="lg" className="w-full gap-2" onClick={startTask} disabled={!goal.trim()}>
            <Rocket className="h-5 w-5" />
            Start task
          </Button>

          <div className="grid gap-3 border-t border-border/40 pt-5 text-sm text-muted-foreground sm:grid-cols-3">
            <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> AI is selected automatically</div>
            <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-400" /> Risky actions require approval</div>
            <div className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" /> Agents coordinate the work</div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
