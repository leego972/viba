import { type FormEvent, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Network, Play, ShieldCheck, SquareTerminal, Zap } from "lucide-react";
import { useAuth, useLogout } from "@/hooks/useAuth";
import AdobeExecutionBrain from "@/components/AdobeExecutionBrain";
import "./home-cinematic.css";
import "./home-cinematic-incidents.css";
import "./home-cinematic-v2.css";
import "./home-cinematic-live.css";
import "./home-cinematic-repo.css";

function isValidGithubRepo(value: string): boolean {
  return /^https?:\/\/github\.com\/[^/\s]+\/[^/\s?#]+(?:\.git)?(?:[/?#].*)?$/i.test(value.trim());
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
          <img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="" aria-hidden="true" />
          <div className="viba-brand-copy">
            <strong className="viba-brand-name">VIBA</strong>
            <span className="viba-nav-tagline">All as One</span>
          </div>
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
            <AdobeExecutionBrain phase="idle" className="viba-network" />
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
        <Link href="/" className="viba-brand-lockup" aria-label="VIBA home">
          <img src={`${import.meta.env.BASE_URL}viba-brain-logo.svg`} alt="" aria-hidden="true" />
          <div className="viba-brand-copy">
            <strong className="viba-brand-name">VIBA</strong>
            <span className="viba-nav-tagline">All as One</span>
          </div>
        </Link>
        <div className="viba-footer-legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
      </footer>
    </div>
  );
}
