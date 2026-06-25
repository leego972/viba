import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Settings, FlaskConical, CreditCard, Zap, LayoutDashboard, Radio, Plus, Cpu, Rocket, Bot, ShieldCheck, Terminal, Wrench, ClipboardCheck, FolderInput, Activity, ShieldAlert, Globe } from "lucide-react";

interface NavLink {
  href: string;
  label: string;
  icon: React.ElementType;
  match: (l: string) => boolean;
  desktopOnly?: boolean;
}

const NAV_LINKS: NavLink[] = [
  { href: "/dashboard",        label: "Dashboard",    icon: LayoutDashboard, match: (l) => l.startsWith("/dashboard") || l.startsWith("/sessions") },
  { href: "/workbench",        label: "Workbench",    icon: FlaskConical,    match: (l) => l.startsWith("/workbench") },
  { href: "/providers",        label: "AI Providers", icon: Cpu,             match: (l) => l.startsWith("/providers") || l.startsWith("/doctor") },
  { href: "/agent-console",    label: "Agent Console",icon: Terminal,        match: (l) => l.startsWith("/agent-console") },
  { href: "/tool-console",     label: "Tools",        icon: Wrench,          match: (l) => l.startsWith("/tool-console"), desktopOnly: true },
  { href: "/credentials",      label: "Vault",        icon: ShieldCheck,     match: (l) => l.startsWith("/credentials"), desktopOnly: true },
  { href: "/bridge",           label: "Bridge",       icon: Radio,           match: (l) => l.startsWith("/bridge") },
  { href: "/billing",          label: "Billing",      icon: CreditCard,      match: (l) => l.startsWith("/billing") || l.startsWith("/pricing") },
  { href: "/settings",         label: "Settings",     icon: Settings,        match: (l) => l === "/settings" },
  { href: "/market-readiness", label: "Launch",       icon: Rocket,          match: (l) => l.startsWith("/market-readiness"), desktopOnly: true },
  { href: "/assisted-browser", label: "Browser",      icon: Bot,             match: (l) => l.startsWith("/assisted-browser"), desktopOnly: true },
  { href: "/qa-release-gate",  label: "QA Gate",        icon: ClipboardCheck,  match: (l) => l.startsWith("/qa-release-gate"), desktopOnly: true },
  { href: "/project-import",   label: "Project Import", icon: FolderInput,     match: (l) => l.startsWith("/project-import"), desktopOnly: true },
  { href: "/production-ops",   label: "Production Ops",  icon: Activity,     match: (l) => l.startsWith("/production-ops"),  desktopOnly: true },
  { href: "/security-center",  label: "Security Center", icon: ShieldAlert,  match: (l) => l.startsWith("/security-center"), desktopOnly: true },
  { href: "/domain-setup",     label: "Domain Setup",    icon: Globe,        match: (l) => l.startsWith("/domain-setup"),     desktopOnly: true },
];

export function Navbar() {
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.06] bg-background/90 backdrop-blur-xl">
      {/* Indigo accent line at very top */}
      <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

      <div className="container flex h-[60px] max-w-screen-2xl items-center gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
          <div className="relative">
            <div className="absolute inset-0 rounded-lg bg-primary/20 blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <img
              src="/viba-logo.png"
              alt="VIBA"
              className="relative h-8 w-auto object-contain"
            />
          </div>
        </Link>

        {/* Divider */}
        <div className="hidden md:block h-5 w-px bg-border/50 shrink-0" />

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-0.5 flex-1">
          {NAV_LINKS.map(({ href, label, icon: Icon, match }) => {
            const active = match(location);
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  active
                    ? "text-foreground bg-primary/10 border border-primary/25 shadow-[0_0_12px_rgba(99,102,241,0.15)]"
                    : "text-foreground/55 hover:text-foreground/90 hover:bg-white/[0.05] border border-transparent"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-primary" : ""}`} />
                {label}
                {active && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[1px] h-[2px] w-6 rounded-full bg-primary/70" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Mobile nav — show only first 5 links (no desktopOnly) */}
        <nav className="flex md:hidden items-center gap-1 flex-1">
          {NAV_LINKS.filter((l) => !l.desktopOnly).slice(0, 5).map(({ href, icon: Icon, match }) => {
            const active = match(location);
            return (
              <Link key={href} href={href}>
                <button
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-all ${
                    active
                      ? "border-primary/30 bg-primary/10 text-primary shadow-[0_0_10px_rgba(99,102,241,0.15)]"
                      : "border-transparent text-foreground/50 hover:border-border/50 hover:text-foreground/80"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                </button>
              </Link>
            );
          })}
        </nav>

        {/* New Session CTA */}
        <Link href="/sessions/new" className="shrink-0">
          <button className="relative flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-semibold text-white overflow-hidden transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] border border-primary/40 shadow-[0_0_20px_rgba(99,102,241,0.25)] hover:shadow-[0_0_28px_rgba(99,102,241,0.4)]"
            style={{ background: "linear-gradient(135deg, hsl(239,84%,62%) 0%, hsl(262,72%,58%) 100%)" }}
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">New Session</span>
            <span className="sm:hidden"><Zap className="h-3.5 w-3.5" /></span>
          </button>
        </Link>
      </div>
    </header>
  );
}
