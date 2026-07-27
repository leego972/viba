import { useEffect, useMemo, useState } from "react";
import { Activity, Bot, CheckCircle2, CircleDot, Code2, GitBranch, Globe2, Palette, ShieldCheck, Workflow } from "lucide-react";

type Scene = "idle" | "planning" | "disconnect" | "repair" | "verify" | "complete";
type TaskType = "research" | "creative_direction" | "build" | "code_review" | "deployment_approval" | "planning" | "final_qa";
type ProviderInfo = { id: string; label: string; enabled: boolean; status: "not_configured" | "configured" | "disabled" };

type ProductionTask = {
  type: TaskType;
  label: string;
  phase: "discover" | "create" | "verify" | "deliver";
  tools: string[];
  icon: typeof Bot;
};

// These are the existing task types and phases used by instructionOrchestrator.ts.
const PRODUCTION_TASKS: ProductionTask[] = [
  { type: "research", label: "Research and Evidence", phase: "discover", tools: ["web_search"], icon: Globe2 },
  { type: "creative_direction", label: "Creative and UX Direction", phase: "create", tools: [], icon: Palette },
  { type: "build", label: "Build and Implementation", phase: "create", tools: ["github", "browser", "storage"], icon: Code2 },
  { type: "code_review", label: "Review and Validation", phase: "verify", tools: ["github", "browser"], icon: ShieldCheck },
  { type: "deployment_approval", label: "Deployment and Connector Check", phase: "verify", tools: ["github", "deployment"], icon: GitBranch },
  { type: "planning", label: "Direct Planning", phase: "create", tools: [], icon: Workflow },
  { type: "final_qa", label: "Final Merge and User Answer", phase: "deliver", tools: [], icon: Bot },
];

const STATUS_BY_SCENE: Record<Scene, string[]> = {
  idle: ["Awaiting objective", "Production task router ready", "Configured providers on standby"],
  planning: ["Classifying objective", "Creating the smallest useful plan", "Routing tasks to best-fit agents", "Estimating agent calls"],
  disconnect: ["Provider response interrupted", "Preserving completed work", "Freezing affected route", "Checking fallback pool"],
  repair: ["Selecting available provider", "Rebinding required tools", "Resuming from checkpoint", "Testing repaired route"],
  verify: ["Running validation task", "Checking logs and evidence", "Resolving conflicting outputs", "Preparing final QA"],
  complete: ["Tasks completed", "Final QA completed", "Verification state recorded", "Result ready"],
};

function inferProductionTasks(instruction: string): ProductionTask[] {
  const text = instruction.toLowerCase();
  const selected = new Set<TaskType>();
  if (/research|lookup|find|compare|price|pricing|competitor|market|latest|web/.test(text)) selected.add("research");
  if (/design|creative|brand|logo|copy|advert|ux|ui|landing|visual/.test(text)) selected.add("creative_direction");
  if (/build|code|repo|backend|frontend|api|database|fix|debug|implement|wire|connect|integration|orchestrator|system/.test(text)) selected.add("build");
  if (/review|audit|test|qa|bug|error|security|check|validate|verify/.test(text)) selected.add("code_review");
  if (/deploy|render|railway|docker|release|production|environment|github|commit|pull request/.test(text)) selected.add("deployment_approval");
  if (selected.size === 0) selected.add("planning");
  if (selected.size > 1) selected.add("final_qa");
  return PRODUCTION_TASKS.filter((task) => selected.has(task.type));
}

export default function LiveOrchestrationPanel({ instruction, scene }: { instruction: string; scene: Scene }) {
  const objective = instruction.trim() || "Audit my repository, identify production blockers and repair the highest-risk issues";
  const selectedTasks = useMemo(() => inferProductionTasks(objective), [objective]);
  const toolRequirements = useMemo(() => [...new Set(selectedTasks.flatMap((task) => task.tools))], [selectedTasks]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/providers", { credentials: "include" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { providers?: ProviderInfo[] }) => { if (!cancelled) setProviders(data.providers ?? []); })
      .catch(() => { if (!cancelled) setProviders([]); });
    return () => { cancelled = true; };
  }, []);

  const configuredProviders = providers.filter((provider) => provider.enabled && provider.status === "configured");
  const statuses = STATUS_BY_SCENE[scene];
  const specialistCalls = selectedTasks.length;
  const executionMode = selectedTasks.length === 1 ? "SINGLE AGENT" : "MULTI AGENT";

  return (
    <section className={`viba-live-panel viba-live-panel-${scene}`} id="live-network">
      <div className="viba-live-heading">
        <div><span>PRODUCTION ORCHESTRATION PREVIEW</span><h2>The landing experience now follows V.I.B.A.'s real task model.</h2><p>It uses the same task types, phases and tool requirement names already implemented by the instruction orchestrator. No parallel agent registry has been introduced.</p></div>
        <div className="viba-objective-card"><small>CURRENT OBJECTIVE</small><strong>{objective}</strong><span><CircleDot /> {executionMode}</span></div>
      </div>

      <div className="viba-live-grid">
        <article className="viba-specialist-board">
          <header><div><Bot />ROUTED PRODUCTION TASKS</div><span>{selectedTasks.length} SELECTED</span></header>
          <div className="viba-specialist-cloud">
            {PRODUCTION_TASKS.map((task, index) => {
              const active = selectedTasks.some((selected) => selected.type === task.type);
              const Icon = task.icon;
              return <div key={task.type} className={`viba-specialist-chip ${active ? "is-active" : ""}`} style={{ animationDelay: `${index * 45}ms` }}><Icon /><div><strong>{task.label}</strong><small>{task.phase.toUpperCase()} · {task.type}</small></div><i /></div>;
            })}
          </div>
        </article>

        <article className="viba-activity-console">
          <header><div><Activity />ORCHESTRATION LOG</div><span className="viba-console-live">LIVE</span></header>
          <div className="viba-console-objective">{objective}</div>
          <div className="viba-activity-list">{statuses.map((status, index) => <div key={status} className={index === statuses.length - 1 ? "is-current" : "is-complete"}>{index === statuses.length - 1 && scene !== "complete" ? <span className="viba-log-spinner" /> : <CheckCircle2 />}<span>{status}</span><time>00:{String(index * 3 + 2).padStart(2, "0")}</time></div>)}</div>
          <div className="viba-runtime-metrics"><div><small>EST. AGENT CALLS</small><strong>{specialistCalls}</strong></div><div><small>EXECUTION MODE</small><strong>{selectedTasks.length === 1 ? "DIRECT" : "PARALLEL"}</strong></div><div><small>RECOVERY</small><strong>{scene === "disconnect" ? "ACTIVE" : scene === "repair" ? "ROUTED" : "READY"}</strong></div></div>
        </article>
      </div>

      <div className="viba-provider-rail">
        <div><small>CONFIGURED PROVIDERS</small>{configuredProviders.length ? configuredProviders.map((provider) => <span key={provider.id} className="is-on">{provider.label}</span>) : <span>Sign in to load provider configuration</span>}</div>
        <div><small>REQUIRED TOOLS</small>{toolRequirements.length ? toolRequirements.map((tool) => <span key={tool} className="is-on">{tool}</span>) : <span>No external tool required</span>}</div>
      </div>
    </section>
  );
}
