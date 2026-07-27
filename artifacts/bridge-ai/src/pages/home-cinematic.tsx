import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Code2,
  GitBranch,
  Network,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Zap,
} from "lucide-react";
import { useAuth, useLogout } from "@/hooks/useAuth";
import "./home-cinematic.css";

type Scene = "idle" | "planning" | "disconnect" | "repair" | "verify" | "complete";

const SCENES: Array<{ id: Scene; label: string; detail: string; duration: number }> = [
  { id: "idle", label: "System ready", detail: "Waiting for your instruction", duration: 2600 },
  { id: "planning", label: "Planning", detail: "Decomposing the request across specialists", duration: 3400 },
  { id: "disconnect", label: "Pathway interrupted", detail: "Provider timeout detected", duration: 2700 },
  { id: "repair", label: "Self-repair", detail: "Rerouting work through a verified pathway", duration: 3200 },
  { id: "verify", label: "Verification", detail: "Reconciling outputs and validating evidence", duration: 3200 },
  { id: "complete", label: "All as One", detail: "One coordinated, verified result", duration: 3600 },
];

const EXAMPLES = [
  "Build and deploy a SaaS platform",
  "Audit my repository and repair the errors",
  "Research the market and create a launch plan",
  "Connect my tools and automate the workflow",
];

const NODES = [
  { id: "strategy", label: "Strategy", x: 13, y: 24 },
  { id: "research", label: "Research", x: 16, y: 72 },
  { id: "code", label: "Code", x: 82, y: 20 },
  { id: "browser", label: "Browser", x: 88, y: 52 },
  { id: "deploy", label: "Deploy", x: 77, y: 82 },
  { id: "verify", label: "Verify", x: 45, y: 91 },
];

function BrainNetwork({ scene }: { scene: Scene }) {
  const repairActive = scene === "repair" || scene === "verify" || scene === "complete";
  const isBusy = scene !== "idle";

  return (
    <div className={`viba-network viba-scene-${scene}`} aria-label={`VIBA orchestration visualisation: ${scene}`}>
      <div className="viba-grid" />
      <div className="viba-aurora viba-aurora-one" />
      <div className="viba-aurora viba-aurora-two" />
      <div className="viba-orbit viba-orbit-outer" />
      <div className="viba-orbit viba-orbit-inner" />

      <svg className="viba-paths" viewBox="0 0 1000 720" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="pathGlow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#53e7ff" />
            <stop offset="0.52" stopColor="#7a7cff" />
            <stop offset="1" stopColor="#d55cff" />
          </linearGradient>
          <linearGradient id="repairGlow" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#3fffc1" />
            <stop offset="1" stopColor="#53e7ff" />
          </linearGradient>
          <filter id="softGlow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <g className="viba-line-group" filter="url(#softGlow)">
          <path className="viba-line viba-line-a" d="M130 170 C310 180 330 310 490 350" />
          <path className="viba-line viba-line-b" d="M150 520 C280 500 350 390 490 350" />
          <path className="viba-line viba-line-c" d="M490 350 C650 250 720 130 825 150" />
          <path className="viba-line viba-line-d" d="M490 350 C680 350 760 360 885 370" />
          <path className="viba-line viba-line-e" d="M490 350 C660 470 715 565 790 590" />
          <path className="viba-line viba-line-f" d="M490 350 C480 470 470 560 455 645" />
          <path className="viba-line viba-line-cross" d="M150 520 C410 620 620 620 790 590" />
          <path className="viba-line viba-line-break" d="M490 350 C680 350 760 360 885 370" />
          {repairActive && <path className="viba-line viba-line-repair" d="M490 350 C615 455 730 420 885 370" />}
        </g>
      </svg>

      <div className="viba-brain-shell">
        <div className="viba-brain-halo" />
        <div className="viba-brain-core">
          <img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="VIBA orchestration brain" />
          <div className="viba-core-scan" />
          <div className="viba-core-flare" />
        </div>
        <div className="viba-core-caption">
          <span>V.I.B.A.</span>
          <small>{scene === "complete" ? "UNIFIED OUTPUT" : isBusy ? "ORCHESTRATING" : "READY"}</small>
        </div>
      </div>

      {NODES.map((node, index) => {
        const disconnected = node.id === "browser" && scene === "disconnect";
        const recovering = node.id === "browser" && scene === "repair";
        return (
          <div
            key={node.id}
            className={`viba-agent-node ${disconnected ? "is-disconnected" : ""} ${recovering ? "is-recovering" : ""}`}
            style={{ left: `${node.x}%`, top: `${node.y}%`, animationDelay: `${index * -0.7}s` }}
          >
            <div className="viba-node-ring" />
            <div className="viba-node-dot">{disconnected ? <CircleAlert /> : recovering ? <RefreshCw /> : <Sparkles />}</div>
            <span>{node.label}</span>
            <small>{disconnected ? "OFFLINE" : recovering ? "REROUTING" : isBusy ? "ACTIVE" : "STANDBY"}</small>
          </div>
        );
      })}

      <div className="viba-packet viba-packet-one" />
      <div className="viba-packet viba-packet-two" />
      <div className="viba-packet viba-packet-three" />
      <div className="viba-error-shock"><CircleAlert /><span>API PATH LOST</span></div>
      <div className="viba-repair-label"><GitBranch /><span>NEW PATH VERIFIED</span></div>
      <div className="viba-complete-wave" />
      <div className="viba-complete-message"><Check /><strong>ALL AS ONE</strong><span>Orchestration complete</span></div>
    </div>
  );
}

export default function CinematicHome() {
  const { isAuthenticated } = useAuth();
  const logout = useLogout();
  const [sceneIndex, setSceneIndex] = useState(0);
  const [instruction, setInstruction] = useState("");
  const [manualRun, setManualRun] = useState(false);
  const scene = SCENES[sceneIndex];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSceneIndex((current) => (current + 1) % SCENES.length);
    }, manualRun ? Math.max(1800, scene.duration - 700) : scene.duration);
    return () => window.clearTimeout(timer);
  }, [sceneIndex, manualRun, scene.duration]);

  const progress = useMemo(() => ((sceneIndex + 1) / SCENES.length) * 100, [sceneIndex]);

  function runDemo(event: FormEvent) {
    event.preventDefault();
    if (!instruction.trim()) setInstruction(EXAMPLES[0]);
    setManualRun(true);
    setSceneIndex(1);
  }

  return (
    <div className="viba-cinematic-page">
      <header className="viba-cinematic-nav">
        <Link href="/" className="viba-brand-lockup" aria-label="VIBA home">
          <img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="" />
          <div><strong>V.I.B.A.</strong><span>All as One</span></div>
        </Link>
        <nav>
          <a href="#orchestration">Orchestration</a>
          <a href="#resilience">Resilience</a>
          <Link href="/pricing">Pricing</Link>
        </nav>
        <div className="viba-nav-actions">
          {isAuthenticated ? (
            <button className="viba-nav-link" onClick={() => void logout()}>Sign out</button>
          ) : <Link href="/login" className="viba-nav-link">Sign in</Link>}
          <Link href={isAuthenticated ? "/dashboard" : "/signup"} className="viba-nav-primary">
            {isAuthenticated ? "Dashboard" : "Enter VIBA"}<ArrowRight />
          </Link>
        </div>
      </header>

      <main>
        <section className="viba-hero" id="orchestration">
          <div className="viba-hero-copy">
            <div className="viba-eyebrow"><span className="viba-live-dot" />AUTONOMOUS AI ORCHESTRATION</div>
            <h1>Every intelligence.<br /><em>All as One.</em></h1>
            <p className="viba-hero-lead">
              Give V.I.B.A. one objective. It plans the work, activates the right intelligences, connects the tools, detects broken pathways and keeps moving until the result is complete.
            </p>

            <form className="viba-command" onSubmit={runDemo}>
              <div className="viba-command-top"><TerminalSquare /><span>Give V.I.B.A. an objective</span><kbd>LIVE DEMO</kbd></div>
              <div className="viba-command-entry">
                <input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Build and deploy a SaaS platform…" aria-label="Instruction" />
                <button type="submit"><Play />Orchestrate</button>
              </div>
              <div className="viba-example-row">
                {EXAMPLES.slice(0, 3).map((example) => <button type="button" key={example} onClick={() => setInstruction(example)}>{example}<ChevronRight /></button>)}
              </div>
            </form>

            <div className="viba-proof-row">
              <span><ShieldCheck />Evidence-aware verification</span>
              <span><Network />Automatic rerouting</span>
              <span><Zap />Cost-aware model selection</span>
            </div>
          </div>

          <div className="viba-hero-stage">
            <BrainNetwork scene={scene.id} />
            <div className="viba-stage-status">
              <div className="viba-status-icon">{scene.id === "disconnect" ? <CircleAlert /> : scene.id === "repair" ? <RefreshCw /> : scene.id === "complete" ? <Check /> : <Sparkles />}</div>
              <div><small>LIVE ORCHESTRATION</small><strong>{scene.label}</strong><span>{scene.detail}</span></div>
              <div className="viba-scene-count">0{sceneIndex + 1}<small>/0{SCENES.length}</small></div>
              <div className="viba-progress"><i style={{ width: `${progress}%` }} /></div>
            </div>
          </div>
        </section>

        <section className="viba-signal-strip">
          <div><strong>6</strong><span>specialist pathways</span></div>
          <div><strong>1</strong><span>coordinated objective</span></div>
          <div><strong>∞</strong><span>automatic reroutes</span></div>
          <div><strong>1</strong><span>verified final result</span></div>
        </section>

        <section className="viba-story" id="resilience">
          <div className="viba-story-heading"><span>BUILT FOR REAL WORK</span><h2>It gets interesting when something breaks.</h2><p>Perfect demos are forgettable. V.I.B.A. is designed for the point where providers time out, credentials fail, dependencies conflict and deployments stop.</p></div>
          <div className="viba-story-grid">
            <article><div className="viba-story-icon error"><CircleAlert /></div><small>01 — DETECT</small><h3>See the failure instantly</h3><p>Disconnected tools, blocked dependencies and conflicting model outputs become visible system states—not hidden surprises.</p></article>
            <article><div className="viba-story-icon repair"><GitBranch /></div><small>02 — REROUTE</small><h3>Find another pathway</h3><p>V.I.B.A. isolates the affected route, selects an available alternative and preserves the rest of the workflow.</p></article>
            <article><div className="viba-story-icon verify"><Code2 /></div><small>03 — VERIFY</small><h3>Prove the recovery</h3><p>Repairs are checked against logs, tests, evidence and the original objective before execution continues.</p></article>
          </div>
        </section>

        <section className="viba-final-cta">
          <div className="viba-final-orb"><img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="" /></div>
          <div><span>THE ORCHESTRATION LAYER</span><h2>Stop managing separate AIs.<br />Give the objective to V.I.B.A.</h2></div>
          <Link href={isAuthenticated ? "/sessions/new" : "/signup"} className="viba-final-button">Start orchestrating<ArrowRight /></Link>
        </section>
      </main>

      <footer className="viba-cinematic-footer"><div className="viba-brand-lockup"><img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="" /><div><strong>V.I.B.A.</strong><span>All as One</span></div></div><p>Intelligent orchestration for complex work.</p><div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div></footer>
    </div>
  );
}
