import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useTheme } from "@/contexts/ThemeContext";
import {
  LayoutDashboard, Plus, Zap, CreditCard, Settings, Sun, Moon,
  ChevronDown, FlaskConical, Terminal, Wrench, Radio, Bot, ClipboardCheck,
  Rocket, ShieldAlert, Activity, ShieldCheck, Globe, FolderInput, Server,
  Plug, FileText, Search, Megaphone, PenTool, Building2,
  AlertTriangle, BarChart3, BrainCircuit, TrendingDown, History, Wallet, BookOpen,
} from "lucide-react";

interface DropItem { href: string; label: string; icon: React.ElementType }
interface NavGroup { label: string; icon: React.ElementType; items: DropItem[]; matchPaths: string[] }

const GROUPS: NavGroup[] = [
  {
    label: "Diagnostics", icon: AlertTriangle,
    matchPaths: ["/ui-audit", "/doctor", "/launch-readiness", "/security-center", "/production-ops", "/qa-release-gate", "/market-readiness", "/launch-readiness"],
    items: [
      { href: "/doctor",           label: "Doctor",            icon: Wrench },
      { href: "/launch-readiness", label: "Launch Readiness",  icon: Rocket },
      { href: "/security-center",  label: "Security Center",   icon: ShieldAlert },
      { href: "/production-ops",   label: "Production Ops",    icon: Activity },
      { href: "/qa-release-gate",  label: "QA Gate",           icon: ClipboardCheck },
      { href: "/market-readiness", label: "Market Readiness",  icon: BarChart3 },
    ],
  },
  {
    label: "Command", icon: Terminal,
    matchPaths: ["/workbench", "/agent-console", "/tool-console", "/bridge", "/assisted-browser"],
    items: [
      { href: "/workbench",        label: "Workbench",         icon: FlaskConical },
      { href: "/agent-console",    label: "Agent Console",     icon: Terminal },
      { href: "/tool-console",     label: "Tool Console",      icon: Wrench },
      { href: "/bridge",           label: "Bridge",            icon: Radio },
      { href: "/assisted-browser", label: "Assisted Browser",  icon: Bot },
    ],
  },
  {
    label: "Reports", icon: FileText,
    matchPaths: ["/proof-report", "/demo", "/sessions"],
    items: [
      { href: "/sessions",              label: "Session History",   icon: BarChart3 },
      { href: "/demo/proof-report",     label: "Sample Proof Report", icon: FileText },
      { href: "/demo/doctor-report",    label: "Sample Doctor Report", icon: FileText },
    ],
  },
  {
    label: "Connections", icon: Plug,
    matchPaths: ["/connections", "/providers", "/credentials", "/render-connector", "/domain-setup", "/project-import"],
    items: [
      { href: "/connections",      label: "Providers & Vault",  icon: Plug },
      { href: "/credentials",      label: "Secure Vault",       icon: ShieldCheck },
      { href: "/render-connector", label: "Render",             icon: Server },
      { href: "/domain-setup",     label: "Domain Setup",       icon: Globe },
      { href: "/project-import",   label: "Project Import",     icon: FolderInput },
    ],
  },
  {
    label: "Growth", icon: Search,
    matchPaths: ["/seo", "/advertising", "/content-creator", "/brand-outreach"],
    items: [
      { href: "/seo",              label: "SEO",                icon: Search },
      { href: "/advertising",      label: "Advertising",        icon: Megaphone },
      { href: "/content-creator",  label: "Content Creator",    icon: PenTool },
      { href: "/brand-outreach",   label: "Brand Outreach",     icon: Building2 },
    ],
  },
  {
    label: "AI", icon: BrainCircuit,
    matchPaths: ["/ai-optimizer", "/ai-savings", "/usage-history", "/budgets", "/project-memory"],
    items: [
      { href: "/ai-optimizer",   label: "AI Optimiser",      icon: BrainCircuit },
      { href: "/ai-savings",     label: "Savings",           icon: TrendingDown },
      { href: "/usage-history",  label: "Usage History",     icon: History },
      { href: "/budgets",        label: "Budgets",           icon: Wallet },
      { href: "/project-memory", label: "Project Memory",    icon: BookOpen },
    ],
  },
];

function DropMenu({ group, location }: { group: NavGroup; location: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = group.matchPaths.some(p => location.startsWith(p));

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`relative flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium transition-all duration-150 select-none ${
          active
            ? "text-foreground bg-primary/10 border border-primary/25"
            : "text-foreground/55 hover:text-foreground/90 hover:bg-white/[0.05] border border-transparent"
        }`}
      >
        <group.icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-primary" : ""}`} />
        {group.label}
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        {active && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[1px] h-[2px] w-5 rounded-full bg-primary/70" />}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 min-w-[190px] rounded-xl border border-border/60 bg-card shadow-lg overflow-hidden py-1">
          {group.items.map(({ href, label, icon: Icon }) => {
            const itemActive = location.startsWith(href);
            return (
              <Link key={href} href={href} onClick={() => setOpen(false)}>
                <div className={`flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors cursor-pointer ${
                  itemActive ? "bg-primary/8 text-primary" : "text-foreground/70 hover:bg-accent/40 hover:text-foreground"
                }`}>
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${itemActive ? "text-primary" : "text-muted-foreground"}`} />
                  {label}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Navbar() {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const check = () => setIsAdmin(!!sessionStorage.getItem("viba_admin_token"));
    check();
    window.addEventListener("storage", check);
    return () => window.removeEventListener("storage", check);
  }, []);

  const isDashboard = location.startsWith("/dashboard") || location.startsWith("/sessions");
  const isBilling   = location.startsWith("/billing") || location.startsWith("/pricing");
  const isSettings  = location === "/settings";
  const isAdmin_    = location === "/admin";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.06] bg-background/90 backdrop-blur-xl">
      <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

      <div className="container flex h-[60px] max-w-screen-2xl items-center gap-1.5 sm:gap-3 px-3 sm:px-4">
        {/* Logo */}
        <Link href="/" className="flex items-center shrink-0">
          <img src={`${import.meta.env.BASE_URL}viba-logo.png`} alt="VIBA" className="h-10 sm:h-14 w-auto object-contain" />
        </Link>

        <div className="hidden md:block h-5 w-px bg-border/50 shrink-0" />

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-0.5 flex-1 min-w-0">
          {/* Dashboard */}
          <Link href="/dashboard">
            <button className={`relative flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium transition-all duration-150 ${
              isDashboard
                ? "text-foreground bg-primary/10 border border-primary/25 shadow-[0_0_12px_rgba(99,102,241,0.15)]"
                : "text-foreground/55 hover:text-foreground/90 hover:bg-white/[0.05] border border-transparent"
            }`}>
              <LayoutDashboard className={`h-3.5 w-3.5 shrink-0 ${isDashboard ? "text-primary" : ""}`} />
              Dashboard
              {isDashboard && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[1px] h-[2px] w-5 rounded-full bg-primary/70" />}
            </button>
          </Link>

          {/* Dropdown groups */}
          {GROUPS.map(g => <DropMenu key={g.label} group={g} location={location} />)}

          {/* Billing */}
          <Link href="/billing">
            <button className={`relative flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium transition-all duration-150 ${
              isBilling
                ? "text-foreground bg-primary/10 border border-primary/25"
                : "text-foreground/55 hover:text-foreground/90 hover:bg-white/[0.05] border border-transparent"
            }`}>
              <CreditCard className={`h-3.5 w-3.5 shrink-0 ${isBilling ? "text-primary" : ""}`} />
              Billing
              {isBilling && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[1px] h-[2px] w-5 rounded-full bg-primary/70" />}
            </button>
          </Link>

          {/* Settings */}
          <Link href="/settings">
            <button className={`relative flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium transition-all duration-150 ${
              isSettings
                ? "text-foreground bg-primary/10 border border-primary/25"
                : "text-foreground/55 hover:text-foreground/90 hover:bg-white/[0.05] border border-transparent"
            }`}>
              <Settings className={`h-3.5 w-3.5 shrink-0 ${isSettings ? "text-primary" : ""}`} />
              Settings
              {isSettings && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[1px] h-[2px] w-5 rounded-full bg-primary/70" />}
            </button>
          </Link>

          {/* Admin — only visible once the admin token is stored in session */}
          {isAdmin && (
            <Link href="/admin">
              <button className={`relative flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                isAdmin_
                  ? "text-foreground bg-red-500/10 border border-red-500/25"
                  : "text-foreground/55 hover:text-foreground/90 hover:bg-red-500/[0.05] border border-transparent"
              }`}>
                <ShieldCheck className={`h-3.5 w-3.5 shrink-0 ${isAdmin_ ? "text-red-400" : ""}`} />
                Admin
                {isAdmin_ && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[1px] h-[2px] w-5 rounded-full bg-red-400/70" />}
              </button>
            </Link>
          )}
        </nav>

        {/* Mobile nav — 4 core actions only */}
        <nav className="flex md:hidden items-center gap-0.5 flex-1">
          {[
            { href: "/dashboard", icon: LayoutDashboard, match: isDashboard },
            { href: "/connections", icon: Plug, match: location.startsWith("/connections") },
            { href: "/billing", icon: CreditCard, match: isBilling },
            { href: "/settings", icon: Settings, match: isSettings },
          ].map(({ href, icon: Icon, match }) => (
            <Link key={href} href={href}>
              <button className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all ${
                match
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-transparent text-foreground/50 hover:border-border/50 hover:text-foreground/80"
              }`}>
                <Icon className="h-4 w-4 shrink-0" />
              </button>
            </Link>
          ))}
        </nav>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="shrink-0 flex items-center justify-center h-9 w-9 rounded-lg border border-border/50 text-foreground/60 hover:text-foreground hover:bg-white/[0.06] transition-all duration-150"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* New Session CTA */}
        <Link href="/sessions/new" className="shrink-0">
          <button
            className="relative flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-semibold text-white overflow-hidden transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] border border-primary/40 shadow-[0_0_20px_rgba(99,102,241,0.25)] hover:shadow-[0_0_28px_rgba(99,102,241,0.4)]"
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
