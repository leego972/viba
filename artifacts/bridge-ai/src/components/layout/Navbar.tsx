import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Activity, AlertTriangle, BarChart3, BookOpen, BrainCircuit, Building2,
  ChevronDown, CreditCard, FileText, FlaskConical, FolderInput, Globe,
  History, LayoutDashboard, Megaphone, Menu, Moon, PenTool, Plug, Radio,
  Rocket, Search, Server, Settings, ShieldAlert, ShieldCheck, Smartphone,
  Sun, Terminal, TrendingDown, Wallet, Wrench, X, Bot, ClipboardCheck,
} from "lucide-react";

interface DropItem { href: string; label: string; icon: React.ElementType }
interface NavGroup { label: string; icon: React.ElementType; items: DropItem[]; matchPaths: string[] }

const GROUPS: NavGroup[] = [
  {
    label: "Diagnostics", icon: AlertTriangle,
    matchPaths: ["/ui-audit", "/doctor", "/launch-readiness", "/security-center", "/production-ops", "/qa-release-gate", "/market-readiness"],
    items: [
      { href: "/doctor", label: "Doctor", icon: Wrench },
      { href: "/launch-readiness", label: "Launch Readiness", icon: Rocket },
      { href: "/security-center", label: "Security Center", icon: ShieldAlert },
      { href: "/production-ops", label: "Production Ops", icon: Activity },
      { href: "/qa-release-gate", label: "QA Gate", icon: ClipboardCheck },
      { href: "/market-readiness", label: "Market Readiness", icon: BarChart3 },
    ],
  },
  {
    label: "Command", icon: Terminal,
    matchPaths: ["/workbench", "/agent-console", "/tool-console", "/bridge", "/assisted-browser"],
    items: [
      { href: "/workbench", label: "Workbench", icon: FlaskConical },
      { href: "/agent-console", label: "Agent Console", icon: Terminal },
      { href: "/tool-console", label: "Tool Console", icon: Wrench },
      { href: "/bridge", label: "Bridge", icon: Radio },
      { href: "/assisted-browser", label: "Assisted Browser", icon: Bot },
    ],
  },
  {
    label: "Connections", icon: Plug,
    matchPaths: ["/connections", "/providers", "/credentials", "/render-connector", "/domain-setup", "/project-import", "/app-publisher"],
    items: [
      { href: "/connections", label: "Providers & Vault", icon: Plug },
      { href: "/credentials", label: "Secure Vault", icon: ShieldCheck },
      { href: "/render-connector", label: "Render", icon: Server },
      { href: "/domain-setup", label: "Domain Setup", icon: Globe },
      { href: "/project-import", label: "Project Import", icon: FolderInput },
      { href: "/app-publisher", label: "Publish Apps", icon: Smartphone },
    ],
  },
  {
    label: "Growth", icon: Search,
    matchPaths: ["/seo", "/advertising", "/content-creator", "/brand-outreach"],
    items: [
      { href: "/seo", label: "SEO", icon: Search },
      { href: "/advertising", label: "Advertising", icon: Megaphone },
      { href: "/content-creator", label: "Content Creator", icon: PenTool },
      { href: "/brand-outreach", label: "Brand Outreach", icon: Building2 },
    ],
  },
  {
    label: "AI", icon: BrainCircuit,
    matchPaths: ["/ai-optimizer", "/ai-savings", "/usage-history", "/budgets", "/project-memory"],
    items: [
      { href: "/ai-optimizer", label: "AI Optimiser", icon: BrainCircuit },
      { href: "/ai-savings", label: "Savings", icon: TrendingDown },
      { href: "/usage-history", label: "Usage History", icon: History },
      { href: "/budgets", label: "Budgets", icon: Wallet },
      { href: "/project-memory", label: "Project Memory", icon: BookOpen },
    ],
  },
  {
    label: "Reports", icon: FileText,
    matchPaths: ["/proof-report", "/demo", "/sessions", "/dashboard"],
    items: [
      { href: "/dashboard", label: "Session History", icon: BarChart3 },
      { href: "/demo/proof-report", label: "Sample Proof Report", icon: FileText },
      { href: "/demo/doctor-report", label: "Sample Doctor Report", icon: FileText },
    ],
  },
];

function DropMenu({ group, location }: { group: NavGroup; location: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = group.matchPaths.some((path) => location.startsWith(path));

  useEffect(() => {
    function close(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`relative flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${active ? "border-primary/25 bg-primary/10 text-foreground" : "border-transparent text-foreground/55 hover:bg-white/[0.05] hover:text-foreground/90"}`}
      >
        <group.icon className={`h-3.5 w-3.5 ${active ? "text-primary" : ""}`} />
        {group.label}<ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-50 mt-1.5 min-w-[210px] overflow-hidden rounded-xl border border-border/60 bg-card py-1 shadow-xl">
          {group.items.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>
              <div role="menuitem" className={`flex cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-sm ${location.startsWith(href) ? "bg-primary/10 text-primary" : "text-foreground/70 hover:bg-accent/40 hover:text-foreground"}`}>
                <Icon className="h-3.5 w-3.5" />{label}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Navbar() {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const check = () => setIsAdmin(!!sessionStorage.getItem("viba_admin_token"));
    check();
    window.addEventListener("storage", check);
    return () => window.removeEventListener("storage", check);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);

  const isDashboard = location.startsWith("/dashboard") || location.startsWith("/sessions");
  const isBilling = location.startsWith("/billing") || location.startsWith("/pricing");
  const isSettings = location === "/settings";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.06] bg-background/92 backdrop-blur-xl">
      <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
      <div className="container flex h-[60px] max-w-screen-2xl items-center gap-2 px-3 sm:px-4">
        <Link href="/" className="flex shrink-0 items-center">
          <img src={`${import.meta.env.BASE_URL}viba-logo.png`} alt="VIBA" className="h-10 w-auto object-contain xl:h-14" />
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 xl:flex" aria-label="Main navigation">
          <Link href="/dashboard"><button type="button" className={`flex h-9 items-center gap-1.5 rounded-lg border px-3.5 text-sm font-medium ${isDashboard ? "border-primary/25 bg-primary/10" : "border-transparent text-foreground/55 hover:bg-white/[0.05]"}`}><LayoutDashboard className="h-3.5 w-3.5" />Dashboard</button></Link>
          {GROUPS.map((group) => <DropMenu key={group.label} group={group} location={location} />)}
          <Link href="/billing"><button type="button" className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium ${isBilling ? "border-primary/25 bg-primary/10" : "border-transparent text-foreground/55 hover:bg-white/[0.05]"}`}><CreditCard className="h-3.5 w-3.5" />Billing</button></Link>
          <Link href="/settings"><button type="button" className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium ${isSettings ? "border-primary/25 bg-primary/10" : "border-transparent text-foreground/55 hover:bg-white/[0.05]"}`}><Settings className="h-3.5 w-3.5" />Settings</button></Link>
          {isAdmin && <Link href="/admin"><button type="button" className="flex h-9 items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/10 px-3 text-sm font-medium"><ShieldCheck className="h-3.5 w-3.5" />Admin</button></Link>}
        </nav>

        <div className="ml-auto flex items-center gap-1 xl:hidden">
          <Link href="/dashboard">
            <button type="button" aria-label="Dashboard" title="Dashboard" className={`flex h-9 w-9 items-center justify-center rounded-lg border ${isDashboard ? "border-primary/30 bg-primary/10 text-primary" : "border-transparent text-foreground/55"}`}>
              <LayoutDashboard className="h-4 w-4" />
            </button>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen((value) => !value)}
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border ${mobileOpen ? "border-primary/30 bg-primary/10 text-primary" : "border-border/40 text-foreground/60"}`}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/50 text-foreground/60 hover:bg-white/[0.06]"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>

      {mobileOpen && (
        <nav aria-label="Mobile navigation" className="absolute left-0 right-0 top-full max-h-[calc(100vh-60px)] overflow-y-auto border-b border-border/60 bg-background/98 px-3 py-3 shadow-2xl backdrop-blur-xl xl:hidden">
          <div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {GROUPS.map((group) => (
              <section key={group.label} className="rounded-xl border border-border/50 bg-card/60 p-2.5">
                <div className="mb-1.5 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <group.icon className="h-3.5 w-3.5" />{group.label}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {group.items.map(({ href, label, icon: Icon }) => (
                    <Link key={href} href={href}>
                      <div className={`flex min-h-10 items-center gap-2 rounded-lg px-2.5 py-2 text-xs ${location.startsWith(href) ? "bg-primary/10 text-primary" : "text-foreground/70 hover:bg-accent/40 hover:text-foreground"}`}>
                        <Icon className="h-3.5 w-3.5 shrink-0" /><span className="leading-tight">{label}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="mx-auto mt-3 flex max-w-4xl flex-wrap gap-2 border-t border-border/40 pt-3">
            <Link href="/billing"><button type="button" className="flex h-9 items-center gap-2 rounded-lg border border-border/50 px-3 text-sm text-foreground/70"><CreditCard className="h-4 w-4" />Billing</button></Link>
            <Link href="/settings"><button type="button" className="flex h-9 items-center gap-2 rounded-lg border border-border/50 px-3 text-sm text-foreground/70"><Settings className="h-4 w-4" />Settings</button></Link>
            {isAdmin && <Link href="/admin"><button type="button" className="flex h-9 items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 text-sm text-red-300"><ShieldCheck className="h-4 w-4" />Admin</button></Link>}
          </div>
        </nav>
      )}
    </header>
  );
}
