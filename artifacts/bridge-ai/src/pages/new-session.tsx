import { useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useCreateSession, getListSessionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Bot, Target, ShieldCheck } from "lucide-react";

const AVAILABLE_PROVIDERS = [
  { id: "openai", name: "ChatGPT", provider: "OpenAI", defaultRole: "Strategist", color: "bg-green-500" },
  { id: "anthropic", name: "Claude", provider: "Anthropic", defaultRole: "Builder", color: "bg-orange-500" },
  { id: "manus", name: "Manus", provider: "Manus", defaultRole: "Code Reviewer", color: "bg-purple-500" },
  { id: "replit", name: "Replit", provider: "Replit", defaultRole: "Builder", color: "bg-blue-500" },
  { id: "gemini", name: "Gemini", provider: "Google", defaultRole: "Researcher", color: "bg-teal-500" },
  { id: "perplexity", name: "Perplexity", provider: "Perplexity", defaultRole: "Researcher", color: "bg-amber-500" },
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

export default function NewSession() {
  const [, setLocation] = useLocation();
  const createSession = useCreateSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [goal, setGoal] = useState("");
  const [autonomyMode, setAutonomyMode] = useState("Supervised");
  const [selectedAgents, setSelectedAgents] = useState<Record<string, { selected: boolean; role: string }>>(() => {
    const initial: Record<string, any> = {};
    AVAILABLE_PROVIDERS.forEach(p => {
      initial[p.id] = { selected: false, role: p.defaultRole };
    });
    // Default select a couple
    initial["openai"].selected = true;
    initial["anthropic"].selected = true;
    return initial;
  });

  const handleAgentToggle = (id: string) => {
    setSelectedAgents(prev => ({
      ...prev,
      [id]: { ...prev[id], selected: !prev[id].selected }
    }));
  };

  const handleRoleChange = (id: string, role: string) => {
    setSelectedAgents(prev => ({
      ...prev,
      [id]: { ...prev[id], role }
    }));
  };

  const handleAutoAssign = () => {
    const newAgents = { ...selectedAgents };
    AVAILABLE_PROVIDERS.forEach(p => {
      newAgents[p.id].role = p.defaultRole;
    });
    setSelectedAgents(newAgents);
  };

  const handleSubmit = () => {
    if (!goal.trim()) {
      toast({ title: "Goal required", description: "Please enter a project goal.", variant: "destructive" });
      return;
    }

    const agentsList = AVAILABLE_PROVIDERS
      .filter(p => selectedAgents[p.id].selected)
      .map(p => ({
        name: p.name,
        provider: p.provider,
        role: selectedAgents[p.id].role,
        isMock: false
      }));

    if (agentsList.length === 0) {
      toast({ title: "Agents required", description: "Please select at least one agent.", variant: "destructive" });
      return;
    }

    createSession.mutate(
      { data: { goal, autonomyMode, agents: agentsList } },
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
          <h1 className="text-3xl font-bold tracking-tight">New Bridge Session</h1>
          <p className="text-muted-foreground">Configure your AI team and project goals</p>
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
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${autonomyMode === mode.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                    onClick={() => setAutonomyMode(mode.value)}
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
              <div className="space-y-4">
                {AVAILABLE_PROVIDERS.map(provider => (
                  <div key={provider.id} className="flex items-center justify-between gap-4 p-2 rounded-md hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <Checkbox 
                        id={`agent-${provider.id}`} 
                        checked={selectedAgents[provider.id].selected}
                        onCheckedChange={() => handleAgentToggle(provider.id)}
                      />
                      <Label htmlFor={`agent-${provider.id}`} className="cursor-pointer flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${provider.color}`} />
                        <span className="font-medium">{provider.name}</span>
                        <span className="text-xs text-muted-foreground ml-1 hidden sm:inline-block">({provider.provider})</span>
                      </Label>
                    </div>
                    {selectedAgents[provider.id].selected && (
                      <Select 
                        value={selectedAgents[provider.id].role} 
                        onValueChange={(val) => handleRoleChange(provider.id, val)}
                      >
                        <SelectTrigger className="w-[140px] h-8 text-xs">
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
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end pt-4">
          <Button size="lg" className="px-8 gap-2" onClick={handleSubmit} disabled={createSession.isPending}>
            {createSession.isPending ? "Starting..." : "Start Bridge Session"} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
