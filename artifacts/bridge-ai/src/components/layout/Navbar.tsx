import { Link, useLocation } from "wouter";
import { Settings, FlaskConical, CreditCard, Zap, LayoutDashboard, Radio, Plus, Rocket, Bot, ShieldCheck, Terminal, Wrench, ClipboardCheck, FolderInput, Activity, ShieldAlert, Globe, Sun, Moon, Plug, Search, Megaphone, PenTool, Building2, Server } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

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
  { href: "/connections",      label: "Connections",  icon: Plug,            match: (l) => l.startsWith("/connections") || l.startsWith("/providers") || l.startsWith("/credentials") },
  { href: "/ui-audit",         label: "UI Tester",    icon: ClipboardCheck,  match: (l) => l.startsWith("/ui-audit") },
  { href: "/agent-console",    label: "Agent Console",icon: Terminal,        match: (l) => l.startsWith("/agent-console") },
  { href: "/tool-console",     label: "Tools",        icon: Wrench,          match: (l) => l.startsWith("/tool-console"), desktopOnly: true },
  { href: "/credentials",      label: "Vault",        icon: ShieldCheck,     match: (l) => l.startsWith("/credentials"), desktopOnly: true },
  { href: "/bridge",           label: "Bridge",       icon: Radio,           match: (l) => l.startsWith("/bridge") },
  { href: "/billing",          label: "Billing",      icon: CreditCard,      match: (l) => l.startsWith("/billing") || l.startsWith("/pricing") },
  { href: "/settings",         label: "Settings",     icon: Settings,        match: (l) => l === "/settings" },
  { href: "/market-readiness", label: "Launch",       icon: Rocket,          match: (l) => l.startsWith("/market-readiness"), desktopOnly: true },
  { href: "/assisted-browser", label: "Browser",      icon: Bot,             match: (l) => l.startsWith("/assisted-browser"), desktopOnly: true },
  { href: "/qa-release-gate",  label: "QA Gate",      icon: ClipboardCheck,  match: (l) => l.startsWith("/qa-release-gate"), desktopOnly: true },
  { href: "/project-import",   label: "Project Import", icon: FolderInput,   match: (l) => l.startsWith("/project-import"), desktopOnly: true },
  { href: "/production-ops",   label: "Production Ops", icon: Activity,      match: (l) => l.startsWith("/production-ops"), desktopOnly: true },
  { href: "/security-center",  label: "Security Center", icon: ShieldAlert,  match: (l) => l.startsWith("/security-center"), desktopOnly: true },
  { href: "/domain-setup",     label: "Domain Setup", icon: Globe,           match: (l) => l.startsWith("/domain-setup"), desktopOnly: true },
  { href: "/launch-readiness", label: "Launch Readiness", icon: Rocket,      match: (l) => l.startsWith("/launch-readiness"), desktopOnly: true },
  { href: "/seo",              label: "SEO",          icon: Search,          match: (l) => l.startsWith("/seo"), desktopOnly: true },
  { href: "/advertising",      label: "Growth Autopilot", icon: Megaphone,   match: (l) => l.startsWith("/advertising"), desktopOnly: true },
  { href: "/content-creator",  label: "Content Creator", icon: PenTool,      match: (l) => l.startsWith("/content-creator"), desktopOnly: true },
  { href: "/brand-outreach",   label: "Brand Outreach", icon: Building2,     match: (l) => l.startsWith("/brand-outreach"), desktopOnly: true },
  { href: "/render-connector", label: "Render",       icon: Server,          match: (l) => l.startsWith("/render-connector"), desktopOnly: true },
];

export function Navbar() {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const mobileLinks = NAV_LINKS.filter((l) => !l.desktopOnly).slice(0, 5);

  return (
    <header className="sticky top-0 z-50 w-full overflow-hidden border-b border-border/70 bg-background/95 backdrop-blur-xl">
      <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

      <div className="mx-auto flex h-[58px] w-full max-w-screen-2xl min-w-0 items-center gap-2 px-3 sm:px-4 md:h-[64px] md:gap-4 md:px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-2">
          <div className="relative rounded-xl bg-[#fffdf4]/95 px-1.5 py-1 shadow-sm ring-1 ring-black/20">
            <div className="absolute inset-0 rounded-xl bg-primary/10 blur-md opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <img
              src="/viba-logo.png"
              alt="VIBA"
              className="viba-logo-outline relative h-9 w-auto object-contain sm:h-10 md:h-12"
            />
          </div>
        </Link>

        <div className="hidden h-5 w-px shrink-0 bg-border/60 md:block" />

        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:flex">
          {NAV_LINKS.map(({ href, label, icon: Icon, match }) => {
            const active = match(location);
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-all duration-150 ${
                  active
                    ? "border-primary/25 bg-primary/10 text-foreground shadow-[0_0_12px_rgba(99,102,241,0.15)]"
                    : "border-transparent text-foreground/60 hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-primary" : ""}`} />
                {label}
                {active && <span className="absolute bottom-0 left-1/2 h-[2px] w-6 -translate-x-1/2 translate-y-[1px] rounded-full bg-primary/70" />}
              </Link>
            );
          })}
        </nav>

        <nav className="flex min-w-0 flex-1 items-center justify-around gap-1 md:hidden">
          {mobileLinks.map(({ href, icon: Icon, match }) => {
            const active = match(location);
            return (
              <Link key={href} href={href} className="shrink-0">
                <button
                  className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
                    active
                      ? "border-primary/35 bg-primary/10 text-primary shadow-[0_0_10px_rgba(99,102,241,0.18)]"
                      : "border-transparent text-foreground/55 hover:border-border/50 hover:text-foreground/85"
                  }`}
                  aria-label={href.replace("/", "") || "home"}
                >
                  <Icon className="h-4.5 w-4.5 shrink-0" />
                </button>
              </Link>
            );
          })}
        </nav>

        <button
          onClick={toggleTheme}
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 text-foreground/65 transition-all duration-150 hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06] md:flex"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <Link href="/sessions/new" className="hidden shrink-0 md:block">
          <button
            className="relative flex h-9 items-center gap-1.5 overflow-hidden rounded-lg border border-primary/40 px-4 text-sm font-semibold text-white shadow-[0_0_20px_rgba(99,102,241,0.25)] transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_0_28px_rgba(99,102,241,0.4)] active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg, hsl(239,84%,62%) 0%, hsl(262,72%,58%) 100%)" }}
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span>New Session</span>
          </button>
        </Link>
      </div>
    </header>
  );
}
