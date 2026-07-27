import { useMemo } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleDot,
  Cloud,
  Code2,
  Database,
  Eye,
  FileSearch,
  GitBranch,
  Globe2,
  Image,
  Layers3,
  LockKeyhole,
  Megaphone,
  Search,
  ServerCog,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  TestTube2,
  Workflow,
  Wrench,
} from "lucide-react";

type Scene = "idle" | "planning" | "disconnect" | "repair" | "verify" | "complete";

type Specialist = {
  id: string;
  label: string;
  group: string;
  keywords: string[];
  icon: typeof Bot;
};

const SPECIALISTS: Specialist[] = [
  { id: "planner", label: "Planning", group: "Core", keywords: [], icon: Workflow },
  { id: "reasoning", label: "Reasoning", group: "Core", keywords: [], icon: Sparkles },
  { id: "memory", label: "Memory", group: "Core", keywords: [], icon: Layers3 },
  { id: "verification", label: "Verification", group: "Core", keywords: [], icon: ShieldCheck },
  { id: "research", label: "Research", group: "Knowledge", keywords: ["research", "market", "evidence", "source"], icon: Search },
  { id: "browser", label: "Browser", group: "Knowledge", keywords: ["website", "browser", "online", "web"], icon: Globe2 },
  { id: "documents", label: "Documents", group: "Knowledge", keywords: ["document", "pdf", "report", "file"], icon: FileSearch },
  { id: "vision", label: "Vision", group: "Knowledge", keywords: ["image", "visual", "photo", "design"], icon: Eye },
  { id: "frontend", label: "Frontend", group: "Build", keywords: ["website", "app", "ui", "frontend", "dashboard"], icon: Code2 },
  { id: "backend", label: "Backend", group: "Build", keywords: ["api", "backend", "server", "saas", "platform"], icon: ServerCog },
  { id: "database", label: "Database", group: "Build", keywords: ["database", "data", "schema", "crm"], icon: Database },
  { id: "automation", label: "Automation", group: "Build", keywords: ["automate", "workflow", "connect", "integration"], icon: Workflow },
  { id: "debugger", label: "Debugger", group: "Engineering", keywords: ["debug", "repair", "error", "audit", "broken"], icon: Wrench },
  { id: "testing", label: "Testing", group: "Engineering", keywords: ["test", "audit", "verify", "quality"], icon: TestTube2 },
  { id: "github", label: "GitHub", group: "Engineering", keywords: ["repository", "github", "code", "branch"], icon: GitBranch },
  { id: "terminal", label: "Terminal", group: "Engineering", keywords: ["deploy", "build", "command", "server"], icon: TerminalSquare },
  { id: "deployment", label: "Deployment", group: "Infrastructure", keywords: ["deploy", "render", "cloud", "production"], icon: Cloud },
  { id: "security", label: "Security", group: "Infrastructure", keywords: ["security", "auth", "credential", "privacy"], icon: LockKeyhole },
  { id: "operations", label: "Operations", group: "Infrastructure", keywords: ["monitor", "operations", "reliability", "uptime"], icon: Activity },
  { id: "image", label: "Image Generation", group: "Creative", keywords: ["image", "logo", "art", "visual"], icon: Image },
  { id: "copy", label: "Copywriting", group: "Growth", keywords: ["copy", "content", "launch", "landing"], icon: Megaphone },
  { id: "marketing", label: "Marketing", group: "Growth", keywords: ["marketing", "launch", "campaign", "market"], icon: Megaphone },
  { id: "seo", label: "SEO", group: "Growth", keywords: ["seo", "search", "traffic", "ranking"], icon: Globe2 },
  { id: "synthesis", label: "Final Synthesis", group: "Core", keywords: [], icon: Bot },
];

const PROVIDERS = ["OpenAI", "Claude", "Gemini", "Grok", "Perplexity", "Local AI"];
const TOOLS = ["GitHub", "Render", "Cloudflare", "Docker", "Stripe", "Supabase", "Browser", "Filesystem"];

const STATUS_BY_SCENE: Record<Scene, string[]> = {
  idle: ["Awaiting objective", "Specialists on standby", "Tool gateway ready"],
  planning: ["Classifying objective", "Selecting specialist team", "Building execution graph", "Estimating model calls"],
  disconnect: ["Provider response interrupted", "Freezing affected pathway", "Preserving completed work", "Scanning fallback routes"],
  repair: ["Activating fallback provider", "Rebinding tool permissions", "Resuming from checkpoint", "Testing repaired pathway"],
  verify: ["Running validation checks", "Comparing outputs", "Checking evidence and logs", "Preparing unified result"],
  complete: ["Objective completed", "Outputs synthesised", "Verification passed", "Result ready"],
};

function chooseSpecialists(instruction: string) {
  const text = instruction.toLowerCase();
  const required = new Set(["planner", "reasoning", "verification", "synthesis"]);
  SPECIALISTS.forEach((specialist) => {
    if (specialist.keywords.some((keyword) => text.includes(keyword))) required.add(specialist.id);
  });
  if (required.size < 8) {
    ["research", "frontend", "backend", "testing"].forEach((id) => required.add(id));
  }
  return SPECIALISTS.filter((specialist) => required.has(specialist.id));
}

export default function LiveOrchestrationPanel({ instruction, scene }: { instruction: string; scene: Scene }) {
  const objective = instruction.trim() || "Build and deploy a SaaS platform";
  const activeSpecialists = useMemo(() => chooseSpecialists(objective), [objective]);
  const statuses = STATUS_BY_SCENE[scene];
  const visibleCount = activeSpecialists.length;

  return (
    <section className={`viba-live-panel viba-live-panel-${scene}`} id="live-network">
      <div className="viba-live-heading">
        <div>
          <span>LIVE EXECUTION MAP</span>
          <h2>The network changes with the objective.</h2>
          <p>V.I.B.A. selects only the specialists, providers and tools needed for the instruction instead of activating everything blindly.</p>
        </div>
        <div className="viba-objective-card">
          <small>CURRENT OBJECTIVE</small>
          <strong>{objective}</strong>
          <span><CircleDot /> {visibleCount} specialists selected</span>
        </div>
      </div>

      <div className="viba-live-grid">
        <article className="viba-specialist-board">
          <header><div><Bot />SPECIALIST NETWORK</div><span>{visibleCount}/24 ACTIVE</span></header>
          <div className="viba-specialist-cloud">
            {SPECIALISTS.map((specialist, index) => {
              const active = activeSpecialists.some((item) => item.id === specialist.id);
              const Icon = specialist.icon;
              return (
                <div key={specialist.id} className={`viba-specialist-chip ${active ? "is-active" : ""}`} style={{ animationDelay: `${index * 35}ms` }}>
                  <Icon />
                  <div><strong>{specialist.label}</strong><small>{specialist.group}</small></div>
                  <i />
                </div>
              );
            })}
          </div>
        </article>

        <article className="viba-activity-console">
          <header><div><Activity />ORCHESTRATION LOG</div><span className="viba-console-live">LIVE</span></header>
          <div className="viba-console-objective">{objective}</div>
          <div className="viba-activity-list">
            {statuses.map((status, index) => (
              <div key={status} className={index === statuses.length - 1 ? "is-current" : "is-complete"}>
                {index === statuses.length - 1 && scene !== "complete" ? <span className="viba-log-spinner" /> : <CheckCircle2 />}
                <span>{status}</span>
                <time>00:{String(index * 3 + 2).padStart(2, "0")}</time>
              </div>
            ))}
          </div>
          <div className="viba-runtime-metrics">
            <div><small>MODEL CALLS</small><strong>{Math.max(1, Math.ceil(visibleCount / 3))}</strong></div>
            <div><small>PARALLEL PATHS</small><strong>{Math.min(6, Math.ceil(visibleCount / 2))}</strong></div>
            <div><small>RECOVERY</small><strong>{scene === "disconnect" ? "ACTIVE" : scene === "repair" ? "ROUTED" : "READY"}</strong></div>
          </div>
        </article>
      </div>

      <div className="viba-provider-rail">
        <div><small>AI PROVIDERS</small>{PROVIDERS.map((provider, index) => <span key={provider} className={index < Math.min(4, Math.ceil(visibleCount / 3)) ? "is-on" : ""}>{provider}</span>)}</div>
        <div><small>CONNECTED TOOLS</small>{TOOLS.map((tool, index) => <span key={tool} className={index < Math.min(TOOLS.length, Math.ceil(visibleCount / 2)) ? "is-on" : ""}>{tool}</span>)}</div>
      </div>
    </section>
  );
}
