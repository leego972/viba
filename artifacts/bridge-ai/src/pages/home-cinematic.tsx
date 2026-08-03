import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Network, Play, ShieldCheck, SquareTerminal, Zap } from "lucide-react";
import { useAuth, useLogout } from "@/hooks/useAuth";
import ExecutionOrbOverlay from "@/components/ExecutionOrbOverlay";
import "@/components/execution-orb-overlay.css";
import "./home-cinematic.css";
import "./home-cinematic-incidents.css";
import "./home-cinematic-v2.css";
import "./home-cinematic-live.css";
import "./home-cinematic-repo.css";

const ADOBE_BRAIN_FRAMES = [
  "https://platform-cs-jpn3.adobe.io/rendition/id/urn:aaid:sc:AP:da498ddc-22a2-4762-b7f5-86c08a1548c4?size=1200",
  "https://platform-cs-jpn3.adobe.io/rendition/id/urn:aaid:sc:AP:22b22ddb-1b95-4682-8cad-029e4dccbaac?size=1200",
  "https://platform-cs-jpn3.adobe.io/rendition/id/urn:aaid:sc:AP:9a0cd621-8524-4bc7-858d-65e4e46070e7?size=1200",
  "https://platform-cs-jpn3.adobe.io/rendition/id/urn:aaid:sc:AP:a5d1763c-afdd-49a7-b852-1ad994764866?size=1200",
  "https://platform-cs-jpn3.adobe.io/rendition/id/urn:aaid:sc:AP:def911ca-2100-4f08-8b13-e1e7af778814?size=1200",
  "https://platform-cs-jpn3.adobe.io/rendition/id/urn:aaid:sc:AP:f50e9f20-acd9-4f29-8c11-021ca593d433?size=1200",
  "https://platform-cs-jpn3.adobe.io/rendition/id/urn:aaid:sc:AP:fc2cd941-a5b4-4089-89b8-cd5da98cb548?size=1200",
] as const;

const FRAME_PHASES = ["idle", "planning", "working", "working", "verifying", "working", "complete"] as const;

function isValidGithubRepo(value: string): boolean {
  return /^https?:\/\/github\.com\/[^/\s]+\/[^/\s?#]+(?:\.git)?(?:[/?#].*)?$/i.test(value.trim());
}

function AdobeBrainSequence() {
  const [activeFrame, setActiveFrame] = useState(0);

  useEffect(() => {
    ADOBE_BRAIN_FRAMES.forEach((src) => {
      const image = new Image();
      image.src = src;
    });

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setActiveFrame((current) => (current + 1) % ADOBE_BRAIN_FRAMES.length);
    }, 2200);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="viba-network"
      aria-label="VIBA cinematic brain orchestration animation"
      style={{ position: "relative", overflow: "hidden", isolation: "isolate" }}
    >
      <div className="viba-grid" />
      <div className="viba-aurora viba-aurora-one" />
      <div className="viba-aurora viba-aurora-two" />
      {ADOBE_BRAIN_FRAMES.map((src, index) => (
        <img
          key={src}
          src={src}
          alt={index === 0 ? "VIBA cinematic neural brain" : ""}
          aria-hidden={index !== 0}
          loading={index === 0 ? "eager" : "lazy"}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: index === activeFrame ? 1 : 0,
            transform: index === activeFrame ? "scale(1.02)" : "scale(1.06)",
            transition: "opacity 1.15s ease, transform 2.2s ease",
            filter: "saturate(1.08) contrast(1.04)",
            zIndex: 2,
          }}
        />
      ))}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 3,
          background: "linear-gradient(180deg, rgba(4,8,22,.04), rgba(4,8,22,.34))",
          pointerEvents: "none",
        }}
      />
      <ExecutionOrbOverlay phase={FRAME_PHASES[activeFrame]} />
    </div>
  );
}

export default function CinematicHome() {
  const { isAuthenticated } = useAuth();
  const logout = useLogout();
  const [, navigate] = useLocation();
  const [instruction, setInstruction] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoError, setRepoError] = useState("");

  function runAudit(event: FormEvent) {
    event.preventDefault();
    const objective = instruction.trim();
    const repo = repoUrl.trim();
    if (!repo || !isValidGithubRepo(repo)) {
      setRepoError("Enter a valid GitHub repository URL.");
      return;
    }
    if (!objective) {
      setRepoError("Tell V.I.B.A. what you need.");
      return;
    }
    setRepoError("");
    const params = new URLSearchParams({ goal: objective, repo });
    const nextPath = `/repository-audit?${params.toString()}`;
    try {
      localStorage.setItem("viba_pending_repo_audit", JSON.stringify({ goal: objective, repo, createdAt: new Date().toISOString() }));
    } catch {}
    navigate(isAuthenticated ? nextPath : `/login?returnTo=${encodeURIComponent(nextPath)}`);
  }

  return (
    <div className="viba-cinematic-page viba-concise-home">
      <header className="viba-cinematic-nav">
        <Link href="/" className="viba-brand-lockup" aria-label="VIBA home">
          <img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="VIBA" />
          <span className="viba-nav-tagline">All as One</span>
        </Link>
        <nav><a href="#audit">Repository audit</a><Link href="/pricing">Pricing</Link></nav>
        <div className="viba-nav-actions">
          {isAuthenticated ? <button className="viba-nav-link" onClick={() => void logout()}>Sign out</button> : <Link href="/login" className="viba-nav-link">Sign in</Link>}
          <Link href={isAuthenticated ? "/dashboard" : "/signup"} className="viba-nav-primary">
            {isAuthenticated ? "Dashboard" : "Enter VIBA"}<ArrowRight />
          </Link>
        </div>
      </header>

      <main>
        <section className="viba-hero viba-concise-hero" id="audit">
          <div className="viba-hero-copy">
            <div className="viba-eyebrow"><span className="viba-live-dot" />AI REPOSITORY AUDIT</div>
            <h1>Know what is broken.<br /><em>Before users do.</em></h1>
            <p className="viba-hero-lead">Paste a GitHub repository. V.I.B.A. selects the available AI and tools needed to inspect, test and rank production blockers in one evidence-based report.</p>
            <form className="viba-command viba-concise-command" onSubmit={runAudit}>
              <div className="viba-command-top"><SquareTerminal /><span>Run a production preflight</span><kbd>REAL AUDIT</kbd></div>
              <div className="viba-repo-entry">
                <input value={repoUrl} onChange={(event) => { setRepoUrl(event.target.value); if (repoError) setRepoError(""); }} placeholder="https://github.com/owner/repository" aria-label="GitHub repository URL" autoCapitalize="none" autoCorrect="off" />
              </div>
              <div className="viba-command-entry">
                <input value={instruction} onChange={(event) => { setInstruction(event.target.value); if (repoError) setRepoError(""); }} placeholder="What do you need?" aria-label="What do you need?" />
                <button type="submit"><Play />Audit repository</button>
              </div>
              {repoError && <div className="viba-repo-error" role="alert">{repoError}</div>}
            </form>
            <div className="viba-proof-row"><span><ShieldCheck />Evidence-based findings</span><span><Network />Automatic AI routing</span><span><Zap />One release verdict</span></div>
          </div>

          <div className="viba-hero-stage">
            <AdobeBrainSequence />
          </div>
        </section>

        <section className="viba-compact-proof" aria-label="Audit stages">
          <div><strong>01</strong><span>Inspect</span><small>Code, routes, auth and configuration</small></div>
          <div><strong>02</strong><span>Test</span><small>Build, typecheck, UI and deployment</small></div>
          <div><strong>03</strong><span>Prioritise</span><small>Critical blockers first, with file evidence</small></div>
          <div><strong>04</strong><span>Decide</span><small>One clear release-readiness verdict</small></div>
        </section>

        <section className="viba-final-cta viba-concise-cta">
          <div className="viba-final-orb"><img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="" /></div>
          <div><span>READY TO CHECK YOUR BUILD?</span><h2>Paste the repository.<br />Get the production verdict.</h2></div>
          <a href="#audit" className="viba-final-button">Start the audit<ArrowRight /></a>
        </section>
      </main>

      <footer className="viba-cinematic-footer">
        <Link href="/" className="viba-brand-lockup" aria-label="VIBA home"><img src={`${import.meta.env.BASE_URL}viba-logo.png`} alt="VIBA" /></Link>
        <div className="viba-footer-legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
      </footer>
    </div>
  );
}
