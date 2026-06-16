import { useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useCreateSession, getListSessionsQueryKey, useGetSettings, type CreateSessionBody } from "@workspace/api-client-react";
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
import { ArrowRight, Bot, Target, ShieldCheck, Zap, AlertTriangle, FlaskConical, GitBranch, ChevronDown, Wrench } from "lucide-react";

const AVAILABLE_PROVIDERS = [
  { id: "openai",     name: "ChatGPT",    provider: "OpenAI",     defaultRole: "Strategist",    color: "bg-green-500",  apiKey: "OPENAI_API_KEY",     canUseTools: false },
  { id: "anthropic",  name: "Claude",     provider: "Anthropic",  defaultRole: "Builder",       color: "bg-orange-500", apiKey: "ANTHROPIC_API_KEY",  canUseTools: false },
  { id: "manus",      name: "Manus",      provider: "Manus",      defaultRole: "Code Reviewer", color: "bg-purple-500", apiKey: "MANUS_API_KEY",      canUseTools: true  },
  { id: "replit",     name: "Replit",     provider: "Replit",     defaultRole: "Builder",       color: "bg-blue-500",   apiKey: "REPLIT_API_KEY",     canUseTools: true  },
  { id: "gemini",     name: "Gemini",     provider: "Google",     defaultRole: "Researcher",    color: "bg-teal-500",   apiKey: "GEMINI_API_KEY",     canUseTools: false },
  { id: "perplexity", name: "Perplexity", provider: "Perplexity", defaultRole: "Researcher",    color: "bg-amber-500",  apiKey: "PERPLEXITY_API_KEY", canUseTools: false },
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

export default function NewSession() {
  const [, setLocation] = useLocation();
  const createSession = useCreateSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading: isSettingsLoading } = useGetSettings();

  const [goal, setGoal] = useState("");
  const [autonomyMode, setAutonomyMode] = useState("Supervised");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoBranch, setRepoBranch] = useState("");
  const [workspaceEnv, setWorkspaceEnv] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  const [selectedAgents, setSelectedAgents] = useState<Record<string, { selected: boolean; role: string }>>(() => {
    const initial: Record<string, { selected: boolean; role: string }> = {};
    AVAILABLE_PROVIDERS.forEach(p => {
      initial[p.id] = { selected: false, role: p.defaultRole };
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

  const selectedToolCapable = AVAILABLE_PROVIDERS
    .filter(p => selectedAgents[p.id]!.selected && p.canUseTools)
    .map(p => p.name);

  const handleAgentToggle = (id: string) => {
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

  const handleAutoAssign = () => {
    const newAgents = { ...selectedAgents };
    AVAILABLE_PROVIDERS.forEach(p => {
      newAgents[p.id] = { ...newAgents[p.id]!, role: p.defaultRole };
    });
    setSelectedAgents(newAgents);
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
        isMock: !isLive(p.id)
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
                  {(repoUrl || repoBranch || workspaceEnv) && (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">configured</Badge>
                  )}
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
                  <Input
                    placeholder="https://github.com/owner/repo"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    className="h-8 text-sm"
                  />
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
                  <CardDescription>Select agents and assign roles.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={handleAutoAssign}>Auto-assign</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {AVAILABLE_PROVIDERS.map(provider => {
                  const live = isLive(provider.id);
                  return (
                    <div key={provider.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-2 rounded-md hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Checkbox 
                          id={`agent-${provider.id}`} 
                          checked={selectedAgents[provider.id]!.selected}
                          onCheckedChange={() => handleAgentToggle(provider.id)}
                        />
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
                          {provider.canUseTools && (
                            <Badge variant="outline" className="text-blue-500 border-blue-500/30 bg-blue-500/10 gap-1 px-1.5 py-0 text-[10px] flex-shrink-0" title="Can execute tools, code, and git operations">
                              <Wrench className="h-2.5 w-2.5" /> Tools
                            </Badge>
                          )}
                        </Label>
                      </div>
                      {selectedAgents[provider.id]!.selected && (
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
