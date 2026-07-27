import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowRight, Check, ChevronRight, CircleAlert, CloudOff, Code2, GitBranch,
  KeyRound, Network, Play, RefreshCw, ShieldCheck, Sparkles, SquareTerminal,
  TimerReset, Unplug, Zap,
} from "lucide-react";
import { useAuth, useLogout } from "@/hooks/useAuth";
import CinematicNeuralCanvas from "@/components/CinematicNeuralCanvas";
import LiveOrchestrationPanel from "@/components/LiveOrchestrationPanel";
import "./home-cinematic.css";
import "./home-cinematic-incidents.css";
import "./home-cinematic-v2.css";
import "./home-cinematic-live.css";
import "./home-cinematic-repo.css";

type Scene = "idle" | "planning" | "disconnect" | "repair" | "verify" | "complete";
type NodeId = "strategy" | "research" | "code" | "browser" | "deploy" | "verify";
type Incident = { id: string; label: string; shortLabel: string; detail: string; resolution: string; affectedNode: NodeId; icon: typeof CircleAlert };

const SCENES: Array<{ id: Scene; label: string; detail: string; duration: number }> = [
  { id: "idle", label: "System ready", detail: "Waiting for your instruction", duration: 2400 },
  { id: "planning", label: "Planning", detail: "Decomposing the request across specialists", duration: 3200 },
  { id: "disconnect", label: "Incident detected", detail: "A critical pathway has stopped responding", duration: 2700 },
  { id: "repair", label: "Self-repair", detail: "Isolating the failure and activating an alternate route", duration: 3100 },
  { id: "verify", label: "Verification", detail: "Testing the replacement pathway before continuing", duration: 3000 },
  { id: "complete", label: "All as One", detail: "One coordinated, verified result", duration: 3400 },
];

const INCIDENTS: Incident[] = [
  { id: "provider-timeout", label: "Provider timeout", shortLabel: "API TIMEOUT", detail: "The browser provider stopped responding during execution.", resolution: "Traffic rerouted through an available provider", affectedNode: "browser", icon: TimerReset },
  { id: "credential-failure", label: "Credential rejected", shortLabel: "AUTH FAILED", detail: "A deployment credential was rejected before release.", resolution: "Secure fallback credential verified", affectedNode: "deploy", icon: KeyRound },
  { id: "dependency-conflict", label: "Dependency conflict", shortLabel: "BUILD BLOCKED", detail: "Two required packages returned incompatible versions.", resolution: "Compatible dependency path selected and tested", affectedNode: "code", icon: Unplug },
  { id: "source-offline", label: "Research source offline", shortLabel: "SOURCE LOST", detail: "A primary evidence source became unavailable mid-task.", resolution: "Evidence recovered from an independent source", affectedNode: "research", icon: CloudOff },
];

const EXAMPLES = [
  "Audit my repository, find the highest-risk bugs and repair them",
  "Review my unfinished app and tell me what blocks production",
  "Test my frontend, API and deployment flow before release",
  "Inspect my codebase and finish the broken integration",
];

const NODES: Array<{ id: NodeId; label: string; x: number; y: number }> = [
  { id: "strategy", label: "Strategy", x: 13, y: 24 }, { id: "research", label: "Research", x: 16, y: 72 },
  { id: "code", label: "Code", x: 82, y: 20 }, { id: "browser", label: "Browser", x: 88, y: 52 },
  { id: "deploy", label: "Deploy", x: 77, y: 82 }, { id: "verify", label: "Verify", x: 45, y: 91 },
];

function isValidGithubRepo(value: string): boolean {
  return /^https?:\/\/github\.com\/[^/\s]+\/[^/\s?#]+(?:\.git)?(?:[/?#].*)?$/i.test(value.trim());
}

function BrainNetwork({ scene, incident }: { scene: Scene; incident: Incident }) {
  const repairActive = scene === "repair" || scene === "verify" || scene === "complete";
  const failureActive = scene === "disconnect";
  const isBusy = scene !== "idle";
  const IncidentIcon = incident.icon;
  return (
    <div className={`viba-network viba-scene-${scene}`} aria-label={`VIBA orchestration visualisation: ${scene}. ${incident.label}`}>
      <div className="viba-grid" /><div className="viba-aurora viba-aurora-one" /><div className="viba-aurora viba-aurora-two" />
      <div className="viba-orbit viba-orbit-outer" /><div className="viba-orbit viba-orbit-inner" />
      <CinematicNeuralCanvas scene={scene} affectedNode={incident.affectedNode} />
      <svg className="viba-paths" viewBox="0 0 1000 720" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="pathGlow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#53e7ff" /><stop offset="0.52" stopColor="#7a7cff" /><stop offset="1" stopColor="#d55cff" /></linearGradient><linearGradient id="repairGlow" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#3fffc1" /><stop offset="1" stopColor="#53e7ff" /></linearGradient><filter id="softGlow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        <g className="viba-line-group" filter="url(#softGlow)"><path className="viba-line viba-line-a" d="M130 170 C310 180 330 310 490 350" /><path className="viba-line viba-line-b" d="M150 520 C280 500 350 390 490 350" /><path className="viba-line viba-line-c" d="M490 350 C650 250 720 130 825 150" /><path className="viba-line viba-line-d" d="M490 350 C680 350 760 360 885 370" /><path className="viba-line viba-line-e" d="M490 350 C660 470 715 565 790 590" /><path className="viba-line viba-line-f" d="M490 350 C480 470 470 560 455 645" /><path className="viba-line viba-line-cross" d="M150 520 C410 620 620 620 790 590" /><path className="viba-line viba-line-break" d="M490 350 C680 350 760 360 885 370" />{repairActive && <path className="viba-line viba-line-repair" d="M490 350 C615 455 730 420 885 370" />}</g>
      </svg>
      <div className="viba-brain-shell"><div className="viba-brain-halo" /><div className="viba-brain-core"><img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="VIBA orchestration brain" /><div className="viba-core-scan" /><div className="viba-core-flare" /></div><div className="viba-core-caption"><span>V.I.B.A.</span><small>{scene === "complete" ? "UNIFIED OUTPUT" : isBusy ? "ORCHESTRATING" : "READY"}</small></div></div>
      {NODES.map((node, index) => { const affected = node.id === incident.affectedNode && failureActive; const restored = node.id === incident.affectedNode && (scene === "repair" || scene === "verify"); return <div key={node.id} className={`viba-agent-node ${affected ? "is-affected" : ""} ${restored ? "is-restored" : ""}`} style={{ left: `${node.x}%`, top: `${node.y}%`, animationDelay: `${index * -0.7}s` }}><div className="viba-node-ring" /><div className="viba-node-dot">{affected ? <IncidentIcon /> : restored ? <RefreshCw /> : <Sparkles />}</div><span>{node.label}</span><small>{affected ? "INTERRUPTED" : restored ? "RESTORED" : isBusy ? "ACTIVE" : "STANDBY"}</small></div>; })}
      <div className="viba-packet viba-packet-one" /><div className="viba-packet viba-packet-two" /><div className="viba-packet viba-packet-three" /><div className="viba-error-shock"><CircleAlert /><span>PATHWAY LOST</span></div><div className="viba-repair-label"><GitBranch /><span>NEW PATH VERIFIED</span></div><div className="viba-incident-badge"><IncidentIcon /><span>{incident.shortLabel}</span></div><div className="viba-incident-resolution"><ShieldCheck /><span>{incident.resolution}</span></div><div className="viba-complete-wave" /><div className="viba-complete-message"><Check /><strong>ALL AS ONE</strong><span>Orchestration complete</span></div>
    </div>
  );
}

export default function CinematicHome() {
  const { isAuthenticated } = useAuth();
  const logout = useLogout();
  const [, navigate] = useLocation();
  const [sceneIndex, setSceneIndex] = useState(0);
  const [incidentIndex, setIncidentIndex] = useState(0);
  const [instruction, setInstruction] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoError, setRepoError] = useState("");
  const [manualRun, setManualRun] = useState(false);
  const scene = SCENES[sceneIndex]; const incident = INCIDENTS[incidentIndex];

  useEffect(() => { const timer = window.setTimeout(() => { setSceneIndex((current) => { const next = (current + 1) % SCENES.length; if (next === 0) setIncidentIndex((active) => (active + 1) % INCIDENTS.length); return next; }); }, manualRun ? Math.max(1800, scene.duration - 700) : scene.duration); return () => window.clearTimeout(timer); }, [sceneIndex, manualRun, scene.duration]);
  const progress = useMemo(() => ((sceneIndex + 1) / SCENES.length) * 100, [sceneIndex]);

  function runDemo(event: FormEvent) {
    event.preventDefault();
    const objective = instruction.trim() || EXAMPLES[0];
    const repo = repoUrl.trim();
    if (!repo || !isValidGithubRepo(repo)) { setRepoError("Enter a valid GitHub repository URL."); return; }
    setRepoError(""); setInstruction(objective); setManualRun(true); setSceneIndex(1);
    const params = new URLSearchParams({ goal: objective, repo });
    const nextPath = `/repository-audit?${params.toString()}`;
    try { localStorage.setItem("viba_pending_repo_audit", JSON.stringify({ goal: objective, repo, createdAt: new Date().toISOString() })); } catch {}
    window.setTimeout(() => navigate(isAuthenticated ? nextPath : `/login?returnTo=${encodeURIComponent(nextPath)}`), 650);
  }

  function selectIncident(index: number) { setIncidentIndex(index); setManualRun(true); setSceneIndex(2); }

  return (
    <div className="viba-cinematic-page">
      <header className="viba-cinematic-nav"><Link href="/" className="viba-brand-lockup" aria-label="VIBA home"><img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="" /><div><strong>V.I.B.A.</strong><span>All as One</span></div></Link><nav><a href="#orchestration">Orchestration</a><a href="#live-network">Execution map</a><a href="#resilience">Resilience</a><Link href="/pricing">Pricing</Link></nav><div className="viba-nav-actions">{isAuthenticated ? <button className="viba-nav-link" onClick={() => void logout()}>Sign out</button> : <Link href="/login" className="viba-nav-link">Sign in</Link>}<Link href={isAuthenticated ? "/dashboard" : "/signup"} className="viba-nav-primary">{isAuthenticated ? "Dashboard" : "Enter VIBA"}<ArrowRight /></Link></div></header>
      <main>
        <section className="viba-hero" id="orchestration"><div className="viba-hero-copy"><div className="viba-eyebrow"><span className="viba-live-dot" />AUTONOMOUS AI ORCHESTRATION</div><h1>Every intelligence.<br /><em>All as One.</em></h1><p className="viba-hero-lead">Give V.I.B.A. one objective. It plans the work, activates the right intelligences, connects the tools, detects broken pathways and keeps moving until the result is complete.</p>
          <form className="viba-command" onSubmit={runDemo}><div className="viba-command-top"><SquareTerminal /><span>Test your repository before release</span><kbd>REPO AUDIT</kbd></div><div className="viba-repo-entry"><input value={repoUrl} onChange={(event) => { setRepoUrl(event.target.value); if (repoError) setRepoError(""); }} placeholder="https://github.com/owner/repository" aria-label="GitHub repository URL" autoCapitalize="none" autoCorrect="off" /><small>Public repositories work immediately. Private repositories connect after sign-in.</small></div><div className="viba-command-entry"><input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Audit my repository and repair the highest-risk errors…" aria-label="Audit objective" /><button type="submit"><Play />Audit repository</button></div>{repoError && <div className="viba-repo-error" role="alert">{repoError}</div>}<div className="viba-example-row">{EXAMPLES.slice(0, 3).map((example) => <button type="button" key={example} onClick={() => setInstruction(example)}>{example}<ChevronRight /></button>)}</div></form>
          <div className="viba-incident-deck" aria-label="Failure scenarios">{INCIDENTS.map((item, index) => <button key={item.id} type="button" className={`viba-incident-button ${index === incidentIndex ? "is-active" : ""}`} onClick={() => selectIncident(index)}><small>SIMULATE {String(index + 1).padStart(2, "0")}</small><strong>{item.label}</strong><i /></button>)}</div><div className="viba-proof-row"><span><ShieldCheck />Evidence-aware verification</span><span><Network />Automatic rerouting</span><span><Zap />Cost-aware model selection</span></div></div>
          <div className="viba-hero-stage"><BrainNetwork scene={scene.id} incident={incident} /><div className="viba-stage-status"><div className="viba-status-icon">{scene.id === "disconnect" ? <CircleAlert /> : scene.id === "repair" ? <RefreshCw /> : scene.id === "complete" ? <Check /> : <Sparkles />}</div><div><small>LIVE ORCHESTRATION</small><strong>{scene.label}</strong><span>{scene.id === "disconnect" ? incident.detail : scene.id === "repair" ? incident.resolution : scene.detail}</span></div><div className="viba-scene-count">0{sceneIndex + 1}<small>/0{SCENES.length}</small></div><div className="viba-progress"><i style={{ width: `${progress}%` }} /></div></div></div></section>
        <section className="viba-signal-strip"><div><strong>300</strong><span>live neural particles</span></div><div><strong>7</strong><span>production task types</span></div><div><strong>∞</strong><span>automatic reroutes</span></div><div><strong>1</strong><span>verified final result</span></div></section>
        <LiveOrchestrationPanel instruction={instruction} scene={scene.id} />
        <section className="viba-story" id="resilience"><div className="viba-story-heading"><span>BUILT FOR REAL WORK</span><h2>It gets interesting when something breaks.</h2><p>Perfect demos are forgettable. V.I.B.A. is designed for the point where providers time out, credentials fail, dependencies conflict and deployments stop.</p></div><div className="viba-story-grid"><article><div className="viba-story-icon error"><CircleAlert /></div><small>01 — DETECT</small><h3>See the failure instantly</h3><p>Disconnected tools, blocked dependencies and conflicting model outputs become visible system states—not hidden surprises.</p></article><article><div className="viba-story-icon repair"><GitBranch /></div><small>02 — REROUTE</small><h3>Find another pathway</h3><p>V.I.B.A. isolates the affected route, selects an available alternative and preserves the rest of the workflow.</p></article><article><div className="viba-story-icon verify"><Code2 /></div><small>03 — VERIFY</small><h3>Prove the recovery</h3><p>Repairs are checked against logs, tests, evidence and the original objective before execution continues.</p></article></div></section>
        <section className="viba-final-cta"><div className="viba-final-orb"><img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="" /></div><div><span>THE ORCHESTRATION LAYER</span><h2>Stop managing separate AIs.<br />Give the objective to V.I.B.A.</h2></div><Link href={isAuthenticated ? "/sessions/new?template=code-review" : "/signup"} className="viba-final-button">Start orchestrating<ArrowRight /></Link></section>
      </main>
      <footer className="viba-cinematic-footer"><div className="viba-brand-lockup"><img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="" /><div><strong>V.I.B.A.</strong><span>All as One</span></div></div><p>Intelligent orchestration for complex work.</p><div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div></footer>
    </div>
  );
}
