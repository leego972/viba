import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Check, CircleAlert, CloudOff, GitBranch, KeyRound, Network, Play, RefreshCw, ShieldCheck, Sparkles, SquareTerminal, TimerReset, Unplug, Zap } from "lucide-react";
import { assetUrl, agents, execution, hero, type AssetRef } from "@/lib/assets";
import { useAuth, useLogout } from "@/hooks/useAuth";
import CinematicNeuralCanvas from "@/components/CinematicNeuralCanvas";
import "./home-cinematic.css";
import "./home-cinematic-incidents.css";
import "./home-cinematic-v2.css";
import "./home-cinematic-live.css";
import "./home-cinematic-repo.css";

type Scene = "idle" | "planning" | "disconnect" | "repair" | "verify" | "complete";
type NodeId = "strategy" | "research" | "code" | "browser" | "deploy" | "verify";
type Incident = { id: string; label: string; shortLabel: string; detail: string; resolution: string; affectedNode: NodeId; icon: typeof CircleAlert };

const SCENES: Array<{ id: Scene; label: string; detail: string; duration: number }> = [
  { id: "idle", label: "System ready", detail: "Waiting for your instruction", duration: 5200 },
  { id: "planning", label: "Planning", detail: "Breaking the audit into specialist tasks", duration: 6200 },
  { id: "disconnect", label: "Issue detected", detail: "A critical pathway stopped responding", duration: 5200 },
  { id: "repair", label: "Repairing", detail: "Rerouting work through an available pathway", duration: 6800 },
  { id: "verify", label: "Verifying", detail: "Checking the repair against evidence and tests", duration: 6200 },
  { id: "complete", label: "Audit complete", detail: "One consolidated release-readiness result", duration: 7000 },
];

const INCIDENTS: Incident[] = [
  { id: "provider-timeout", label: "Provider timeout", shortLabel: "API TIMEOUT", detail: "The browser provider stopped responding during execution.", resolution: "Traffic rerouted through an available provider", affectedNode: "browser", icon: TimerReset },
  { id: "credential-failure", label: "Credential rejected", shortLabel: "AUTH FAILED", detail: "A deployment credential was rejected before release.", resolution: "Secure fallback credential verified", affectedNode: "deploy", icon: KeyRound },
  { id: "dependency-conflict", label: "Dependency conflict", shortLabel: "BUILD BLOCKED", detail: "Required packages returned incompatible versions.", resolution: "Compatible dependency path selected and tested", affectedNode: "code", icon: Unplug },
  { id: "source-offline", label: "Source unavailable", shortLabel: "SOURCE LOST", detail: "A primary evidence source became unavailable mid-task.", resolution: "Evidence recovered from an independent source", affectedNode: "research", icon: CloudOff },
];

const NODES: Array<{ id: NodeId; label: string; x: number; y: number }> = [
  { id: "strategy", label: "Plan", x: 13, y: 24 }, { id: "research", label: "Inspect", x: 16, y: 72 },
  { id: "code", label: "Code", x: 82, y: 20 }, { id: "browser", label: "UI", x: 88, y: 52 },
  { id: "deploy", label: "Deploy", x: 77, y: 82 }, { id: "verify", label: "Verify", x: 45, y: 91 },
];

const NODE_ICON: Record<NodeId, AssetRef> = {
  strategy: execution.plan, research: execution.review, code: agents.developer,
  browser: agents.designer, deploy: agents.deploymentAgent, verify: execution.verify,
};

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
        <defs>
          <linearGradient id="pathGlow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#53e7ff" /><stop offset="0.52" stopColor="#7a7cff" /><stop offset="1" stopColor="#d55cff" /></linearGradient>
          <linearGradient id="repairGlow" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#3fffc1" /><stop offset="1" stopColor="#53e7ff" /></linearGradient>
          <filter id="softGlow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <g className="viba-line-group" filter="url(#softGlow)">
          <path className="viba-line viba-line-a" d="M130 170 C310 180 330 310 490 350" /><path className="viba-line viba-line-b" d="M150 520 C280 500 350 390 490 350" />
          <path className="viba-line viba-line-c" d="M490 350 C650 250 720 130 825 150" /><path className="viba-line viba-line-d" d="M490 350 C680 350 760 360 885 370" />
          <path className="viba-line viba-line-e" d="M490 350 C660 470 715 565 790 590" /><path className="viba-line viba-line-f" d="M490 350 C480 470 470 560 455 645" />
          <path className="viba-line viba-line-break" d="M490 350 C680 350 760 360 885 370" />
          {repairActive && <path className="viba-line viba-line-repair" d="M490 350 C615 455 730 420 885 370" />}
        </g>
      </svg>
      <div className="viba-brain-shell"><div className="viba-brain-halo" /><div className="viba-brain-core"><img src={assetUrl(hero.brain)} width={hero.brain.width} height={hero.brain.height} alt="VIBA orchestration brain" /><div className="viba-core-scan" /><div className="viba-core-flare" /></div><div className="viba-core-caption"><span>V.I.B.A.</span><small>{scene === "complete" ? "VERIFIED" : isBusy ? "ORCHESTRATING" : "READY"}</small></div></div>
      {NODES.map((node, index) => {
        const affected = node.id === incident.affectedNode && failureActive;
        const restored = node.id === incident.affectedNode && (scene === "repair" || scene === "verify");
        return <div key={node.id} className={`viba-agent-node ${affected ? "is-affected" : ""} ${restored ? "is-restored" : ""}`} style={{ left: `${node.x}%`, top: `${node.y}%`, animationDelay: `${index * -0.7}s` }}><div className="viba-node-ring" /><div className="viba-node-dot">{affected ? <IncidentIcon /> : restored ? <RefreshCw /> : <img src={assetUrl(NODE_ICON[node.id])} width={20} height={20} alt="" style={{ width: 20, height: 20, objectFit: "contain" }} />}</div><span>{node.label}</span><small>{affected ? "BLOCKED" : restored ? "RESTORED" : isBusy ? "ACTIVE" : "STANDBY"}</small></div>;
      })}
      <div className="viba-packet viba-packet-one" /><div className="viba-packet viba-packet-two" /><div className="viba-packet viba-packet-three" />
      <div className="viba-error-shock"><CircleAlert /><span>PATHWAY LOST</span></div><div className="viba-repair-label"><GitBranch /><span>NEW PATH VERIFIED</span></div>
      <div className="viba-incident-badge"><IncidentIcon /><span>{incident.shortLabel}</span></div><div className="viba-incident-resolution"><ShieldCheck /><span>{incident.resolution}</span></div>
      <div className="viba-complete-wave" /><div className="viba-complete-message"><Check /><strong>AUDIT READY</strong><span>Consolidated result prepared</span></div>
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
  const scene = SCENES[sceneIndex];
  const incident = INCIDENTS[incidentIndex];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSceneIndex((current) => {
        const next = (current + 1) % SCENES.length;
        if (next === 0) setIncidentIndex((active) => (active + 1) % INCIDENTS.length);
        return next;
      });
    }, scene.duration);
    return () => window.clearTimeout(timer);
  }, [sceneIndex, scene.duration]);

  const progress = useMemo(() => ((sceneIndex + 1) / SCENES.length) * 100, [sceneIndex]);

  function runDemo(event: FormEvent) {
    event.preventDefault();
    const objective = instruction.trim();
    const repo = repoUrl.trim();
    if (!repo || !isValidGithubRepo(repo)) { setRepoError("Enter a valid GitHub repository URL."); return; }
    if (!objective) { setRepoError("Tell V.I.B.A. what you need."); return; }
    setRepoError(""); setManualRun(true); setSceneIndex(1);
    const params = new URLSearchParams({ goal: objective, repo });
    const nextPath = `/repository-audit?${params.toString()}`;
    try { localStorage.setItem("viba_pending_repo_audit", JSON.stringify({ goal: objective, repo, createdAt: new Date().toISOString() })); } catch {}
    window.setTimeout(() => navigate(isAuthenticated ? nextPath : `/login?returnTo=${encodeURIComponent(nextPath)}`), 650);
  }

  function selectIncident(index: number) { setIncidentIndex(index); setManualRun(true); setSceneIndex(2); }

  return (
    <div className="viba-cinematic-page viba-concise-home">
      <header className="viba-cinematic-nav"><Link href="/" className="viba-brand-lockup" aria-label="VIBA home"><img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="VIBA" /><span className="viba-nav-tagline">All as One</span></Link><nav><a href="#audit">Repository audit</a><Link href="/pricing">Pricing</Link></nav><div className="viba-nav-actions">{isAuthenticated ? <button className="viba-nav-link" onClick={() => void logout()}>Sign out</button> : <Link href="/login" className="viba-nav-link">Sign in</Link>}<Link href={isAuthenticated ? "/dashboard" : "/signup"} className="viba-nav-primary">{isAuthenticated ? "Dashboard" : "Enter VIBA"}<ArrowRight /></Link></div></header>
      <main>
        <section className="viba-hero viba-concise-hero" id="audit">
          <div className="viba-hero-copy"><div className="viba-eyebrow"><span className="viba-live-dot" />AI REPOSITORY AUDIT</div><h1>Know what is broken.<br /><em>Before users do.</em></h1><p className="viba-hero-lead">Paste a GitHub repository. V.I.B.A. coordinates specialist AIs to inspect, test and rank the production blockers in one verified report.</p>
            <form className="viba-command viba-concise-command" onSubmit={runDemo}><div className="viba-command-top"><SquareTerminal /><span>Run a production preflight</span><kbd>LIVE AUDIT</kbd></div><div className="viba-repo-entry"><input value={repoUrl} onChange={(event) => { setRepoUrl(event.target.value); if (repoError) setRepoError(""); }} placeholder="https://github.com/owner/repository" aria-label="GitHub repository URL" autoCapitalize="none" autoCorrect="off" /></div><div className="viba-command-entry"><input value={instruction} onChange={(event) => { setInstruction(event.target.value); if (repoError) setRepoError(""); }} placeholder="What do you need?" aria-label="What do you need?" /><button type="submit"><Play />Audit repository</button></div>{repoError && <div className="viba-repo-error" role="alert">{repoError}</div>}</form>
            <div className="viba-proof-row"><span><ShieldCheck />Evidence-based findings</span><span><Network />Multi-agent review</span><span><Zap />One release verdict</span></div>
          </div>
          <div className="viba-hero-stage"><BrainNetwork scene={scene.id} incident={incident} /><div className="viba-stage-status"><div className="viba-status-icon">{scene.id === "disconnect" ? <CircleAlert /> : scene.id === "repair" ? <RefreshCw /> : scene.id === "complete" ? <Check /> : <Sparkles />}</div><div><small>LIVE AUDIT FLOW</small><strong>{scene.label}</strong><span>{scene.id === "disconnect" ? incident.detail : scene.id === "repair" ? incident.resolution : scene.detail}</span></div><div className="viba-scene-count">0{sceneIndex + 1}<small>/0{SCENES.length}</small></div><div className="viba-progress"><i style={{ width: `${progress}%` }} /></div></div></div>
        </section>
        <section className="viba-incident-visual" aria-label="Failure scenarios"><div><span>SEE V.I.B.A. RESPOND</span><h2>Choose a failure scenario.</h2></div><div className="viba-incident-deck">{INCIDENTS.map((item, index) => <button key={item.id} type="button" className={`viba-incident-button ${index === incidentIndex ? "is-active" : ""}`} onClick={() => selectIncident(index)}><small>SCENARIO {String(index + 1).padStart(2, "0")}</small><strong>{item.label}</strong><i /></button>)}</div></section>
        <section className="viba-compact-proof" aria-label="Audit stages"><div><strong>01</strong><span>Inspect</span><small>Code, routes, auth and configuration</small></div><div><strong>02</strong><span>Test</span><small>Build, typecheck, UI and deployment</small></div><div><strong>03</strong><span>Prioritise</span><small>Critical blockers first, with file evidence</small></div><div><strong>04</strong><span>Decide</span><small>One clear release-readiness verdict</small></div></section>
        <section className="viba-final-cta viba-concise-cta"><div className="viba-final-orb"><img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="" /></div><div><span>READY TO CHECK YOUR BUILD?</span><h2>Paste the repository.<br />Get the production verdict.</h2></div><a href="#audit" className="viba-final-button">Start the audit<ArrowRight /></a></section>
      </main>
      <footer className="viba-cinematic-footer viba-footer-leego-only"><img src={`${import.meta.env.BASE_URL}leego-logo-transparent.png`} alt="Leego" className="viba-footer-leego-logo" /><div className="viba-footer-legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div></footer>
    </div>
  );
}
