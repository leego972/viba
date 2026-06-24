import { Link } from "wouter";
import {
  Stethoscope, XCircle, AlertTriangle, Info, CheckCircle2, Shield, GitBranch,
  ArrowRight, ChevronLeft, ChevronDown, ChevronUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";

function PublicHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.06] bg-background/90 backdrop-blur-xl">
      <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
      <div className="container flex h-[60px] max-w-screen-2xl items-center justify-between gap-4">
        <Link href="/demo" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-4 w-4" /> Back to Demo
        </Link>
        <Link href="/signup">
          <Button size="sm" className="h-8 text-xs gap-1.5"
            style={{ background: "linear-gradient(135deg, hsl(239,84%,62%) 0%, hsl(262,72%,58%) 100%)" }}>
            Try with your repo <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
    </header>
  );
}

type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

interface Finding {
  severity: FindingSeverity;
  area: string;
  title: string;
  recommendation: string;
  evidence: string;
  prReady: boolean;
}

const FINDINGS: Finding[] = [
  {
    severity: "critical",
    area: "Environment / Deployment",
    title: "Missing DATABASE_URL in production environment",
    recommendation: "Set DATABASE_URL in your Railway (or deployment platform) environment variables. Use a managed PostgreSQL provider like Neon or Railway's own Postgres.",
    evidence: ".env.example references DATABASE_URL but Railway config shows no value set.",
    prReady: false,
  },
  {
    severity: "high",
    area: "Health & Availability",
    title: "Health endpoint /health returns 404",
    recommendation: "Implement a GET /health route that returns HTTP 200 with { status: 'ok' }. Railway uses this for deployment health checks.",
    evidence: "curl https://demo-company.up.railway.app/health → 404 Not Found",
    prReady: false,
  },
  {
    severity: "medium",
    area: "Build Configuration",
    title: "nixpacks.toml does not pin Node.js version",
    recommendation: "Add providers = [\"nodejs_24\"] to nixpacks.toml to prevent unexpected Node.js version upgrades in future deployments.",
    evidence: "nixpacks.toml exists but has no nodejs_XX provider directive.",
    prReady: true,
  },
  {
    severity: "medium",
    area: "Documentation",
    title: "Missing CONTRIBUTING.md",
    recommendation: "Add CONTRIBUTING.md describing the development workflow, branch naming conventions, and PR requirements.",
    evidence: "CONTRIBUTING.md not found at repository root.",
    prReady: true,
  },
  {
    severity: "low",
    area: "Documentation",
    title: "README.md lacks deployment instructions",
    recommendation: "Add a Deployment section to README.md documenting required environment variables, Railway setup, and the deployment process.",
    evidence: "README.md exists but has no Deployment section.",
    prReady: true,
  },
  {
    severity: "info",
    area: "Audit Trail",
    title: "No VIBA Doctor audit record",
    recommendation: "Run VIBA Doctor scan and merge the repair PR to create VIBA-DOCTOR-AUDIT.md — a machine-readable health record for this repo.",
    evidence: "VIBA-DOCTOR-AUDIT.md not found.",
    prReady: true,
  },
];

function sevIcon(s: FindingSeverity) {
  if (s === "critical") return <XCircle className="h-4 w-4 text-red-400 shrink-0" />;
  if (s === "high") return <AlertTriangle className="h-4 w-4 text-orange-400 shrink-0" />;
  if (s === "medium") return <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />;
  if (s === "low") return <Info className="h-4 w-4 text-blue-400 shrink-0" />;
  return <Info className="h-4 w-4 text-zinc-400 shrink-0" />;
}

function sevBadge(s: FindingSeverity) {
  const map: Record<FindingSeverity, string> = {
    critical: "bg-red-500/12 text-red-400 border-red-500/30",
    high: "bg-orange-500/12 text-orange-400 border-orange-500/30",
    medium: "bg-amber-500/12 text-amber-400 border-amber-500/30",
    low: "bg-blue-500/12 text-blue-400 border-blue-500/30",
    info: "bg-zinc-500/12 text-zinc-400 border-zinc-500/30",
  };
  return map[s];
}

const HEALTH_SCORE = 48;
const SCAN_DATE = "2026-06-24T03:00:00Z";
const REPO = { owner: "demo-company", name: "landing-site", branch: "main" };

export default function DemoDoctorReport() {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  function toggle(i: number) {
    setExpanded((prev) => ({ ...prev, [i]: !prev[i] }));
  }

  const prReady = FINDINGS.filter((f) => f.prReady);
  const manual = FINDINGS.filter((f) => !f.prReady);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />

      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        {/* Demo banner */}
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
          <Info className="h-4 w-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-200/80">
            <span className="font-medium text-amber-300">Sample data.</span>{" "}
            This is a simulated Doctor report for the fictional repo{" "}
            <code className="text-amber-200 bg-amber-500/15 px-1 rounded">demo-company/landing-site</code>.
            Your real scan uses live GitHub data.
          </p>
        </div>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Stethoscope className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">VIBA Doctor Report</h1>
            <p className="text-sm text-muted-foreground">
              {REPO.owner}/{REPO.name} · branch: {REPO.branch} · {new Date(SCAN_DATE).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Score card */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Health Score", value: `${HEALTH_SCORE}/100`, color: "text-red-400" },
            { label: "Findings", value: String(FINDINGS.length), color: "text-foreground" },
            { label: "PR-Ready", value: String(prReady.length), color: "text-emerald-400" },
            { label: "Manual Only", value: String(manual.length), color: "text-amber-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Findings */}
        <div className="space-y-2">
          <h2 className="text-sm font-medium">All Findings</h2>
          {FINDINGS.map((f, i) => (
            <div key={i} className="rounded-lg border border-white/[0.07] bg-white/[0.02] overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                onClick={() => toggle(i)}
              >
                {sevIcon(f.severity)}
                <span className="flex-1 text-sm">{f.title}</span>
                <Badge className={`text-[11px] border ${sevBadge(f.severity)}`}>{f.severity}</Badge>
                {f.prReady ? (
                  <Badge className="text-[11px] gap-1 bg-primary/10 text-primary border-primary/25 hidden sm:flex">
                    <GitBranch className="h-2.5 w-2.5" /> PR-ready
                  </Badge>
                ) : (
                  <Badge className="text-[11px] bg-zinc-500/10 text-zinc-400 border-zinc-500/25 hidden sm:flex">Manual</Badge>
                )}
                {expanded[i] ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              </button>
              {expanded[i] && (
                <div className="px-4 pb-4 pt-1 border-t border-white/[0.05] space-y-2">
                  <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/60">Area:</span> {f.area}</p>
                  <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/60">Recommendation:</span> {f.recommendation}</p>
                  <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/60">Evidence:</span> {f.evidence}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Repair proposal */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-4">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" /> Repair Proposal
          </h2>
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground/70">{prReady.length} items VIBA would patch automatically:</p>
            {prReady.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                <span className="text-foreground/80">{f.title}</span>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground/70">{manual.length} items requiring manual action (skipped):</p>
            {manual.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <Shield className="h-3.5 w-3.5 text-zinc-500 mt-0.5 shrink-0" />
                <span className="text-muted-foreground">{f.title}</span>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-white/[0.08] bg-background/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/60">Files changed:</span> VIBA-DOCTOR-AUDIT.md (audit record only — no code changes)
          </div>
        </div>

        {/* CTA */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-6 text-center space-y-4">
          <h3 className="font-medium">Run this on your own repository</h3>
          <p className="text-sm text-muted-foreground">Create a free VIBA account and scan your repo in under 30 seconds. No paid provider calls required.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup">
              <Button className="gap-2" style={{ background: "linear-gradient(135deg, hsl(239,84%,62%) 0%, hsl(262,72%,58%) 100%)" }}>
                Create account <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/demo/proof-report">
              <Button variant="outline" className="gap-2">
                See sample proof report
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <footer className="border-t border-white/[0.06] py-8 px-4 text-center text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} VIBA — All data on this page is sample/demo data.</p>
      </footer>
    </div>
  );
}
