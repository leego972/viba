import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Navbar } from "@/components/layout/Navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  CircleDot,
  Clock,
  Code2,
  Eye,
  FileText,
  GitBranch,
  Layers,
  MessageSquare,
  Play,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type IconComponent = LucideIcon;

type CapabilityStatus =
  | "executable"
  | "planning_only"
  | "credential_required"
  | "external_setup_required"
  | "adapter_required"
  | "failed"
  | "blocked";

interface ToolEntry {
  toolId: string;
  label: string;
  category: string;
  riskLevel: string;
  requiresApproval: boolean;
  supportsDryRun: boolean;
  requiresSafeBuild: boolean;
  credentialStatus: "configured" | "missing" | "not_required";
  rawValuesReturned: false;
}

interface CapabilityRecord {
  toolId: string;
  label: string;
  category: string;
  status: CapabilityStatus;
  canRunNow: boolean;
  truthfulClaim: string;
  missingForFullExecution: string[];
  rawValuesReturned: false;
}

interface Invocation {
  id?: number;
  tool_id?: string;
  toolLabel?: string;
  status?: string;
  risk_level?: string;
  created_at?: string;
  agent_name?: string | null;
}

interface RouteResponse {
  jobType?: string;
  sequence?: string[];
  toolSequence?: string[];
  rawValuesReturned?: false;
}

interface ProviderResponse {
  providers?: Array<{ id: string; status: string; label?: string }>;
}

interface WorkflowDefinition {
  type: string;
  label: string;
  icon: IconComponent;
  prompt: string;
  commandTone: string;
}

interface MetricCardDefinition {
  label: string;
  value: number;
  icon: IconComponent;
}

interface AgentNodeDefinition {
  name: string;
  role: string;
  icon: IconComponent;
  status: string;
  className: string;
}

const STATUS_STYLE: Record<CapabilityStatus, string> = {
  executable: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  planning_only: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  credential_required: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  external_setup_required: "border-purple-500/30 bg-purple-500/10 text-purple-300",
  adapter_required: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  failed: "border-red-500/30 bg-red-500/10 text-red-300",
  blocked: "border-red-500/30 bg-red-500/10 text-red-300",
};

const WORKFLOWS: WorkflowDefinition[] = [
  {
    type: "repair",
    label: "Repair",
    icon: Wrench,
    prompt: "VIBA inspects the fault, ranks causes, prepares the safest repair path, then demands proof before success is declared.",
    commandTone: "Find the break. Contain the risk. Prove the fix.",
  },
  {
    type: "design",
    label: "Design",
    icon: Eye,
    prompt: "VIBA studies the interface like a creative director: hierarchy, trust, motion, mobile pressure points, and conversion clarity.",
    commandTone: "Make it sharper, cleaner, and harder to ignore.",
  },
  {
    type: "upgrade",
    label: "Upgrade",
    icon: Sparkles,
    prompt: "VIBA turns a working system into a professional system: architecture, reliability, gates, reports, and polish.",
    commandTone: "Raise the standard. Keep the build safe.",
  },
  {
    type: "deploy",
    label: "Deploy",
    icon: Zap,
    prompt: "VIBA checks readiness, provider setup, environment safety, rollback notes, and evidence before release pressure is applied.",
    commandTone: "No blind launches. Only proven movement.",
  },
];

const AGENTS: AgentNodeDefinition[] = [
  { name: "Director", role: "Routes the mission", icon: Brain, status: "Command", className: "left-4 top-8" },
  { name: "Builder", role: "Plans the build", icon: Code2, status: "Ready", className: "right-4 top-10" },
  { name: "Designer", role: "Sharpens the UI", icon: Eye, status: "Watching", className: "left-1 bottom-12" },
  { name: "QA", role: "Demands proof", icon: TestTube2, status: "Guarding", className: "right-1 bottom-12" },
];

function countByStatus(items: CapabilityRecord[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
}

function stageForTool(toolId: string): { label: string; icon: IconComponent; tone: string } {
  if (toolId.includes("diagnose") || toolId.includes("blueprint")) return { label: "Understand", icon: Brain, tone: "reads the work" };
  if (toolId.includes("plan") || toolId.includes("criteria") || toolId.includes("spec")) return { label: "Design", icon: Layers, tone: "sets the order" };
  if (toolId.includes("github") || toolId.includes("patch")) return { label: "Change", icon: GitBranch, tone: "prepares movement" };
  if (toolId.includes("test") || toolId.includes("build") || toolId.includes("gate")) return { label: "Verify", icon: TestTube2, tone: "checks the proof" };
  if (toolId.includes("report")) return { label: "Prove", icon: FileText, tone: "writes the evidence" };
  return { label: "Act", icon: CircleDot, tone: "waits for command" };
}

function statusText(status: CapabilityStatus): string {
  return status.replace(/_/g, " ");
}

function CommandOrb({ active, warnings, selected }: { active: number; warnings: number; selected: WorkflowDefinition }) {
  const OrbIcon = selected.icon;
  const brainColor = warnings > 0 ? "text-amber-300" : active > 0 ? "text-blue-300" : "text-emerald-300";

  return (
    <div className="relative mx-auto flex h-[22rem] max-w-[22rem] items-center justify-center">
      <div className="absolute inset-0 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute h-[22rem] w-[22rem] rounded-full border border-primary/20 animate-pulse" />
      <div className="absolute h-72 w-72 rounded-full border border-blue-400/20" />
      <div className="absolute h-52 w-52 rounded-full border border-purple-400/20" />
      <div className="absolute h-36 w-36 rounded-full border border-emerald-400/20" />

      {AGENTS.map((agent) => {
        const Icon = agent.icon;
        return (
          <div key={agent.name} className={`absolute ${agent.className} hidden w-32 rounded-2xl border border-white/[0.07] bg-black/50 p-3 shadow-xl backdrop-blur-xl sm:block`}>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold">{agent.name}</div>
                <div className="text-[10px] text-muted-foreground">{agent.status}</div>
              </div>
            </div>
            <div className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{agent.role}</div>
          </div>
        );
      })}

      <div className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-emerald-400 shadow-[0_0_22px_rgba(52,211,153,.95)]" />
      <div className="absolute right-8 top-24 h-2.5 w-2.5 rounded-full bg-blue-400 shadow-[0_0_22px_rgba(96,165,250,.95)]" />
      <div className="absolute bottom-12 left-12 h-2.5 w-2.5 rounded-full bg-purple-400 shadow-[0_0_22px_rgba(192,132,252,.95)]" />

      <div className="relative z-10 flex h-40 w-40 flex-col items-center justify-center rounded-full border border-white/10 bg-black/55 shadow-2xl backdrop-blur-xl">
        <Brain className={`h-10 w-10 ${brainColor}`} />
        <div className="mt-2 text-[10px] uppercase tracking-[0.32em] text-muted-foreground">VIBA</div>
        <div className="text-sm font-semibold text-foreground">Mission Control</div>
        <div className="mt-2 flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-muted-foreground">
          <OrbIcon className="h-3 w-3 text-primary" />
          {selected.label} mode
        </div>
      </div>
    </div>
  );
}

function WorkflowRail({ route }: { route: RouteResponse | null }) {
  const sequence = route?.toolSequence ?? route?.sequence ?? [
    "builder.project.blueprint",
    "builder.feature.plan",
    "builder.patch.plan",
    "builder.test.plan",
    "builder.release.gate",
  ];

  return (
    <div className="relative space-y-3">
      <div className="absolute bottom-5 left-[1.15rem] top-5 w-px bg-gradient-to-b from-primary/50 via-blue-400/20 to-transparent" />
      {sequence.map((toolId, index) => {
        const stage = stageForTool(toolId);
        const Icon = stage.icon;
        return (
          <div key={`${toolId}-${index}`} className="relative flex gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 transition hover:border-primary/25 hover:bg-white/[0.045]">
            <div className="z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-black text-primary shadow-[0_0_18px_rgba(99,102,241,.18)]">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {index + 1}. {stage.label}
                </div>
                <Badge variant="outline" className="border-white/10 bg-black/20 text-[10px] text-muted-foreground">queued</Badge>
              </div>
              <div className="mt-1 truncate font-mono text-xs text-foreground/90">{toolId}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{stage.tone}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CapabilityCard({ item }: { item: CapabilityRecord }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 transition hover:border-primary/20 hover:bg-white/[0.045]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{item.label}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">{item.toolId}</div>
        </div>
        <Badge variant="outline" className={`shrink-0 text-[10px] ${STATUS_STYLE[item.status]}`}>
          {statusText(item.status)}
        </Badge>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{item.truthfulClaim}</p>
    </div>
  );
}

function MetricCard({ item }: { item: MetricCardDefinition }) {
  const Icon = item.icon;
  return (
    <Card className="group border-white/[0.06] bg-white/[0.025] transition hover:border-primary/25 hover:bg-white/[0.045]">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] shadow-[0_0_18px_rgba(99,102,241,.10)] group-hover:border-primary/25">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <div className="text-2xl font-bold">{item.value}</div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{item.label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProofMeter({ executable, warnings }: { executable: number; warnings: number }) {
  const score = Math.max(0, Math.min(100, executable * 12 - warnings * 8 + 35));
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/25 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Proof discipline</div>
          <div className="text-xs text-muted-foreground">How much of the toolbox can act or prove honestly.</div>
        </div>
        <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">{score}%</Badge>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-gradient-to-r from-blue-500 via-primary to-emerald-400" style={{ width: `${score}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-2">Executable: {executable}</div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-2">Warnings: {warnings}</div>
      </div>
    </div>
  );
}

export default function ToolConsolePage() {
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityRecord[]>([]);
  const [invocations, setInvocations] = useState<Invocation[]>([]);
  const [providers, setProviders] = useState<Array<{ id: string; status: string; label?: string }>>([]);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [jobType, setJobType] = useState("repair");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    try {
      const [toolsRes, capRes, invRes, routeRes, providerRes] = await Promise.all([
        fetch(`${BASE}/api/tools`, { credentials: "include" }),
        fetch(`${BASE}/api/tools/capabilities`, { credentials: "include" }),
        fetch(`${BASE}/api/tools/invocations?limit=20`, { credentials: "include" }),
        fetch(`${BASE}/api/tools/route-job?type=${encodeURIComponent(jobType)}`, { credentials: "include" }),
        fetch(`${BASE}/api/providers`, { credentials: "include" }),
      ]);

      if (toolsRes.ok) {
        const payload = (await toolsRes.json()) as { tools?: ToolEntry[] };
        setTools(payload.tools ?? []);
      } else {
        setTools([]);
      }

      if (capRes.ok) {
        const payload = (await capRes.json()) as { capabilities?: CapabilityRecord[] };
        setCapabilities(payload.capabilities ?? []);
      } else {
        setCapabilities([]);
        setError("Capability route is not mounted yet. VIBA is showing the command surface, not pretending unavailable backend data is live.");
      }

      if (invRes.ok) {
        const payload = (await invRes.json()) as { invocations?: Invocation[] };
        setInvocations(payload.invocations ?? []);
      } else {
        setInvocations([]);
      }

      setRoute(routeRes.ok ? ((await routeRes.json()) as RouteResponse) : null);

      if (providerRes.ok) {
        const payload = (await providerRes.json()) as ProviderResponse;
        setProviders(payload.providers ?? []);
      } else {
        setProviders([]);
      }
    } catch {
      setError("Could not load live VIBA data. Check API server and session auth.");
    } finally {
      setLoading(false);
    }
  }, [jobType]);

  useEffect(() => {
    void fetchBrain();
  }, [fetchBrain]);

  useEffect(() => {
    const timer = setInterval(() => {
      void fetchBrain(true);
    }, 5000);
    return () => clearInterval(timer);
  }, [fetchBrain]);

  const counts = useMemo(() => countByStatus(capabilities), [capabilities]);
  const selected = WORKFLOWS.find((workflow) => workflow.type === jobType) ?? WORKFLOWS[0];
  const SelectedIcon = selected.icon;
  const liveProviders = providers.filter((provider) => provider.status === "configured").length;
  const executableCount = counts.executable ?? 0;
  const planningCount = counts.planning_only ?? 0;
  const warnings = (counts.adapter_required ?? 0) + (counts.blocked ?? 0) + (counts.failed ?? 0);
  const metrics: MetricCardDefinition[] = [
    { label: "Can Act", value: executableCount, icon: CheckCircle2 },
    { label: "Can Plan", value: planningCount, icon: Brain },
    { label: "Need Keys", value: counts.credential_required ?? 0, icon: ShieldCheck },
    { label: "Need Build", value: warnings, icon: Wrench },
    { label: "Providers", value: liveProviders, icon: Bot },
  ];

  const recentEvents = invocations.slice(0, 8);
  const headline = recentEvents.length > 0 ? "Agents are leaving a trail" : "No agent trail yet";

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(99,102,241,0.20),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(14,165,233,0.16),transparent_30%),radial-gradient(circle_at_50%_100%,rgba(168,85,247,0.16),transparent_30%)]" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "42px 42px",
          }}
        />

        <div className="relative mx-auto max-w-screen-2xl px-4 py-6 space-y-6">
          <div className="overflow-hidden rounded-[2rem] border border-white/[0.08] bg-black/25 p-5 shadow-2xl backdrop-blur-xl md:p-7">
            <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
              <div className="space-y-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.34em] text-primary">
                      <Sparkles className="h-4 w-4" />
                      Director command chair
                    </div>
                    <h1 className="mt-3 max-w-4xl text-4xl font-black tracking-tight md:text-6xl">
                      Watch VIBA move the work.
                    </h1>
                    <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground md:text-base">
                      The user sits above the system: VIBA routes agents, shows the work path, exposes blockers, demands proof, and lets the owner interrupt before anything risky moves.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => void fetchBrain()} disabled={loading} className="gap-2">
                      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                      Refresh command room
                    </Button>
                    <Link href="/sessions/new">
                      <Button className="gap-2 shadow-[0_0_28px_rgba(99,102,241,.35)]">
                        <Play className="h-4 w-4" />
                        Start mission
                      </Button>
                    </Link>
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    <AlertTriangle className="h-4 w-4" />
                    {error}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  {metrics.map((metric) => <MetricCard key={metric.label} item={metric} />)}
                </div>

                <div className="rounded-[1.5rem] border border-primary/15 bg-primary/5 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                        <SelectedIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold uppercase tracking-wider text-primary">Current order: {selected.label}</div>
                        <div className="text-xs text-muted-foreground">{selected.commandTone}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {WORKFLOWS.map((flow) => {
                        const Icon = flow.icon;
                        return (
                          <button
                            key={flow.type}
                            onClick={() => setJobType(flow.type)}
                            className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                              jobType === flow.type
                                ? "border-primary/40 bg-primary/15 text-primary shadow-[0_0_18px_rgba(99,102,241,.18)]"
                                : "border-white/[0.07] bg-white/[0.025] text-muted-foreground hover:border-white/15 hover:text-foreground"
                            }`}
                          >
                            <Icon className="mr-1.5 inline h-3.5 w-3.5" />
                            {flow.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-white/[0.07] bg-black/30 p-4">
                <CommandOrb active={executableCount + planningCount} warnings={warnings} selected={selected} />
                <ProofMeter executable={executableCount} warnings={warnings} />
              </div>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
            <div className="space-y-6">
              <Card className="border-white/[0.06] bg-black/20 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Route className="h-4 w-4 text-primary" />
                    Mission route theatre
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-5 lg:grid-cols-[1fr_260px]">
                  <WorkflowRail route={route} />
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                      <div className="text-sm font-semibold">What the user sees</div>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">VIBA does not disappear into a black box. Each stage tells the user what role is moving, what tool is being prepared, and where proof must appear.</p>
                    </div>
                    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                      <div className="text-sm font-semibold">Where the user steers</div>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Live instructions and stops happen inside the active session workspace, where VIBA already keeps the mission context.</p>
                    </div>
                    <Link href="/sessions/new">
                      <Button className="w-full gap-2">
                        <Play className="h-4 w-4" />
                        Start a controlled mission
                      </Button>
                    </Link>
                    <Link href="/agent-console">
                      <Button variant="secondary" className="w-full gap-2">
                        <Code2 className="h-4 w-4" />
                        Open agent console
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/[0.06] bg-black/20 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="h-4 w-4 text-primary" />
                    Live activity trail
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
                    <div>
                      <div className="text-sm font-semibold">{headline}</div>
                      <div className="text-xs text-muted-foreground">Tool invocations appear here as the command room moves.</div>
                    </div>
                    <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">{recentEvents.length} events</Badge>
                  </div>
                  {recentEvents.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">No recent tool activity yet. Start a mission to populate the trail.</p>
                  ) : (
                    recentEvents.map((item, index) => (
                      <div key={item.id ?? index} className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{item.toolLabel ?? item.tool_id ?? "Tool"}</div>
                          <div className="text-xs text-muted-foreground">{item.agent_name ?? "agent"} · {item.status ?? "tracked"}</div>
                        </div>
                        <Badge variant="outline" className="text-[10px]">{item.risk_level ?? "logged"}</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="border-white/[0.06] bg-black/20 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    Owner command path
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                    <div className="text-sm font-semibold">Give orders inside a mission</div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      To comment, change direction, pause, or demand proof, start a VIBA session. The session workspace is the live control surface for user instructions.
                    </p>
                  </div>
                  <Link href="/sessions/new">
                    <Button className="w-full gap-2">
                      <Play className="h-4 w-4" />
                      Start mission
                    </Button>
                  </Link>
                  <Link href="/dashboard">
                    <Button variant="outline" className="w-full gap-2">
                      <Activity className="h-4 w-4" />
                      View sessions
                    </Button>
                  </Link>
                </CardContent>
              </Card>

              <Card className="border-white/[0.06] bg-black/20 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Wrench className="h-4 w-4 text-primary" />
                    Capability truth board
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {capabilities.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">No capability data yet.</p>
                  ) : (
                    capabilities.slice(0, 8).map((item) => <CapabilityCard key={item.toolId} item={item} />)
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
