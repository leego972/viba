import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight, BrainCircuit, Check, ChevronRight, CircleAlert, Cloud,
  Code2, Database, GitBranch, Globe2, Network, Play, Search,
  ShieldCheck, Sparkles, TerminalSquare, TestTube2, WandSparkles, Zap,
} from "lucide-react";
import { useAuth, useLogout } from "@/hooks/useAuth";
import { CinematicNeuralCanvas } from "@/components/CinematicNeuralCanvas";
import "./home-cinematic.css";

type Scene = "idle" | "planning" | "disconnect" | "repair" | "verify" | "complete";
type Specialist = { id: string; label: string; group: number; icon: typeof Sparkles; keywords: string[] };

const SCENES: Array<{ id: Scene; label: string; detail: string; duration: number }> = [
  { id: "idle", label: "System ready", detail: "Waiting for your objective", duration: 2400 },
  { id: "planning", label: "Planning", detail: "Selecting specialists, tools and execution order", duration: 3300 },
  { id: "disconnect", label: "Pathway interrupted", detail: "A live dependency stopped responding", duration: 2600 },
  { id: "repair", label: "Self-repair", detail: "Isolating the fault and activating an alternate route", duration: 3100 },
  { id: "verify", label: "Verification", detail: "Testing the recovery against the original objective", duration: 3000 },
  { id: "complete", label: "All as One", detail: "One coordinated and verified result", duration: 3500 },
];

const SPECIALISTS: Specialist[] = [
  { id: "strategy", label: "Strategy", group: 0, icon: BrainCircuit, keywords: ["plan", "strategy", "business", "launch"] },
  { id: "research", label: "Research", group: 1, icon: Search, keywords: ["research", "market", "compare", "latest"] },
  { id: "design", label: "Design", group: 2, icon: WandSparkles, keywords: ["design", "ui", "ux", "brand", "landing"] },
  { id: "browser", label: "Browser", group: 3, icon: Globe2, keywords: ["browser", "website", "form", "audit"] },
  { id: "code", label: "Code", group: 4, icon: Code2, keywords: ["build", "code", "app", "saas", "api"] },
  { id: "data", label: "Data", group: 5, icon: Database, keywords: ["database", "data", "schema", "sql"] },
  { id: "deploy", label: "Deploy", group: 6, icon: Cloud, keywords: ["deploy", "render", "cloud", "production"] },
  { id: "verify", label: "Verify", group: 7, icon: TestTube2, keywords: ["test", "verify", "audit", "security", "repair"] },
];

const EXAMPLES = [
  "Build and deploy a SaaS platform",
  "Audit my repository and repair every error",
  "Research the market and create a launch strategy",
  "Design a premium landing page and test it",
];

const FAILURE_MESSAGES = [
  "Provider timeout detected",
  "Deployment credential rejected",
  "Dependency version conflict",
  "Research source became unavailable",
];

function selectSpecialists(instruction: string) {
  const lower = instruction.toLowerCase();
  const matched = SPECIALISTS.filter((specialist) => specialist.keywords.some((keyword) => lower.includes(keyword)));
  return matched.length ? matched : [SPECIALISTS[0], SPECIALISTS[4], SPECIALISTS[7]];
}

export default function CinematicHome() {
  const { isAuthenticated } = useAuth();
  const logout = useLogout();
  const [sceneIndex, setSceneIndex] = useState(0);
  const [instruction, setInstruction] = useState("");
  const [objective, setObjective] = useState(EXAMPLES[0]);
  const [runSeed, setRunSeed] = useState(17);
  const [failureIndex, setFailureIndex] = useState(0);
  const scene = SCENES[sceneIndex];
  const selected = useMemo(() => selectSpecialists(objective), [objective]);
  const activeGroups = selected.map((specialist) => String(specialist.group));
  const failedSpecialist = selected[Math.min(1, selected.length - 1)] ?? SPECIALISTS[3];

  useEffect(() => {
    const timer = window.setTimeout(() => setSceneIndex((current) => (current + 1) % SCENES.length), scene.duration);
    return () => window.clearTimeout(timer);
  }, [scene.duration, sceneIndex]);

  const progress = ((sceneIndex + 1) / SCENES.length) * 100;
  const activity = useMemo(() => {
    const labels = selected.map((item) => item.label);
    if (scene.id === "idle") return ["Awaiting objective", "Project memory available", "Connectors standing by"];
    if (scene.id === "planning") return labels.slice(0, 3).map((label) => `${label} specialist activated`);
    if (scene.id === "disconnect") return [`${failedSpecialist.label} pathway interrupted`, FAILURE_MESSAGES[failureIndex], "Remaining work preserved"];
    if (scene.id === "repair") return ["Fault isolated", `Alternate ${failedSpecialist.label} route selected`, "Execution resumed"];
    if (scene.id === "verify") return ["Running verification checks", "Reconciling specialist outputs", "Validating evidence and tests"];
    return ["Objective complete", `${selected.length} specialist outputs unified`, "Final result ready"];
  }, [failedSpecialist.label, failureIndex, scene.id, selected]);

  function runDemo(event: FormEvent) {
    event.preventDefault();
    const nextObjective = instruction.trim() || EXAMPLES[0];
    setObjective(nextObjective);
    setInstruction(nextObjective);
    setRunSeed((value) => value + nextObjective.length + 7);
    setFailureIndex((value) => (value + 1) % FAILURE_MESSAGES.length);
    setSceneIndex(1);
  }

  return (
    <div className="viba-cinematic-page">
      <header className="viba-cinematic-nav">
        <Link href="/" className="viba-brand-lockup" aria-label="VIBA home"><img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="" /><div><strong>V.I.B.A.</strong><span>All as One</span></div></Link>
        <nav><a href="#orchestration">Orchestration</a><a href="#network">Network</a><a href="#resilience">Resilience</a><Link href="/pricing">Pricing</Link></nav>
        <div className="viba-nav-actions">{isAuthenticated ? <button className="viba-nav-link" onClick={() => void logout()}>Sign out</button> : <Link href="/login" className="viba-nav-link">Sign in</Link>}<Link href={isAuthenticated ? "/dashboard" : "/signup"} className="viba-nav-primary">{isAuthenticated ? "Dashboard" : "Enter VIBA"}<ArrowRight /></Link></div>
      </header>

      <main>
        <section className="viba-hero" id="orchestration">
          <div className="viba-hero-copy">
            <div className="viba-eyebrow"><span className="viba-live-dot" />LIVE AUTONOMOUS ORCHESTRATION</div>
            <h1>Every intelligence.<br /><em>All as One.</em></h1>
            <p className="viba-hero-lead">Give V.I.B.A. one objective. It selects the right specialists, activates the required tools, detects failures, reroutes the work and verifies the result before delivery.</p>
            <form className="viba-command" onSubmit={runDemo}>
              <div className="viba-command-top"><TerminalSquare /><span>Give V.I.B.A. an objective</span><kbd>REACTIVE DEMO</kbd></div>
              <div className="viba-command-entry"><input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Build and deploy a SaaS platform…" aria-label="Instruction" /><button type="submit"><Play />Orchestrate</button></div>
              <div className="viba-example-row">{EXAMPLES.slice(0, 3).map((example) => <button type="button" key={example} onClick={() => setInstruction(example)}>{example}<ChevronRight /></button>)}</div>
            </form>
            <div className="viba-proof-row"><span><ShieldCheck />Evidence-aware verification</span><span><Network />Automatic rerouting</span><span><Zap />Cost-aware model selection</span></div>
          </div>

          <div className="viba-hero-stage">
            <div className={`viba-world viba-world-${scene.id}`}>
              <div className="viba-world-grid" />
              <CinematicNeuralCanvas scene={scene.id} activeNodeIds={activeGroups} failedNodeId={failedSpecialist.id} seed={runSeed} />
              <div className="viba-brain-mark"><img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="VIBA neural orchestration core" /><span>V.I.B.A.</span><small>{scene.id === "complete" ? "UNIFIED OUTPUT" : scene.id === "idle" ? "READY" : "ORCHESTRATING"}</small></div>
              <div className="viba-specialist-ring">{SPECIALISTS.map((specialist, index) => { const Icon = specialist.icon; const isActive = selected.some((item) => item.id === specialist.id) && scene.id !== "idle"; const isFailed = specialist.id === failedSpecialist.id && scene.id === "disconnect"; const isRepairing = specialist.id === failedSpecialist.id && scene.id === "repair"; return <div key={specialist.id} className={`viba-specialist viba-specialist-${index} ${isActive ? "is-active" : ""} ${isFailed ? "is-failed" : ""} ${isRepairing ? "is-repairing" : ""}`}><i><Icon /></i><span>{specialist.label}</span><small>{isFailed ? "OFFLINE" : isRepairing ? "REROUTING" : isActive ? "ACTIVE" : "STANDBY"}</small></div>; })}</div>
              <div className="viba-world-flash"><CircleAlert /><strong>{FAILURE_MESSAGES[failureIndex]}</strong></div>
              <div className="viba-world-repair"><GitBranch /><strong>Alternate path verified</strong></div>
              <div className="viba-world-complete"><Check /><strong>ALL AS ONE</strong><span>Objective completed</span></div>
            </div>

            <aside className="viba-live-console">
              <div className="viba-console-head"><span><i />LIVE EXECUTION</span><strong>{scene.label}</strong></div>
              <p className="viba-current-objective">“{objective}”</p>
              <div className="viba-console-log">{activity.map((entry, index) => <div key={`${scene.id}-${entry}`} className="viba-log-row"><span>{String(index + 1).padStart(2, "0")}</span><i className={index === 0 ? "is-live" : ""} /><p>{entry}</p></div>)}</div>
              <div className="viba-progress"><i style={{ width: `${progress}%` }} /></div>
              <div className="viba-console-foot"><span>Scene {sceneIndex + 1}/{SCENES.length}</span><span>{selected.length} specialists selected</span></div>
            </aside>
          </div>
        </section>

        <section className="viba-signal-strip"><div><strong>40+</strong><span>specialist capabilities</span></div><div><strong>1</strong><span>coordinated objective</span></div><div><strong>∞</strong><span>automatic reroutes</span></div><div><strong>1</strong><span>verified final result</span></div></section>

        <section className="viba-network-section" id="network"><div className="viba-story-heading"><span>THE INTELLIGENCE NETWORK</span><h2>A complete operating layer, not another chatbot.</h2><p>V.I.B.A. coordinates planning, research, design, coding, data, browsers, deployment, security and verification as one execution system.</p></div><div className="viba-capability-cloud">{["Planning","Research","UI/UX","Frontend","Backend","Database","Browser","Vision","Security","Testing","GitHub","Render","Cloudflare","Stripe","Analytics","SEO","Content","Memory","Local AI","Verification"].map((label, index) => <span key={label} style={{ animationDelay: `${index * -0.23}s` }}>{label}</span>)}</div></section>

        <section className="viba-story" id="resilience"><div className="viba-story-heading"><span>BUILT FOR REAL WORK</span><h2>It becomes valuable when something breaks.</h2><p>Provider timeouts, rejected credentials, dependency conflicts and unavailable sources become visible system states with recoverable paths.</p></div><div className="viba-story-grid"><article><div className="viba-story-icon error"><CircleAlert /></div><small>01 — DETECT</small><h3>See the failure instantly</h3><p>V.I.B.A. identifies the broken pathway without discarding the rest of the workflow.</p></article><article><div className="viba-story-icon repair"><GitBranch /></div><small>02 — REROUTE</small><h3>Activate another path</h3><p>The affected route is isolated and an available specialist or connector takes over.</p></article><article><div className="viba-story-icon verify"><Code2 /></div><small>03 — VERIFY</small><h3>Prove the recovery</h3><p>Tests, logs and evidence are checked against the original objective before completion.</p></article></div></section>

        <section className="viba-final-cta"><div className="viba-final-orb"><img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="" /></div><div><span>THE ORCHESTRATION LAYER</span><h2>Stop managing separate AIs.<br />Give the objective to V.I.B.A.</h2></div><Link href={isAuthenticated ? "/sessions/new" : "/signup"} className="viba-final-button">Start orchestrating<ArrowRight /></Link></section>
      </main>
      <footer className="viba-cinematic-footer"><div className="viba-brand-lockup"><img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="" /><div><strong>V.I.B.A.</strong><span>All as One</span></div></div><p>Intelligent orchestration for complex work.</p><div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div></footer>
    </div>
  );
}
