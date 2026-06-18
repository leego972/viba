import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Settings, FlaskConical, CreditCard, Zap, LayoutDashboard, Radio } from "lucide-react";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard",  icon: LayoutDashboard, match: (l: string) => l.startsWith("/dashboard") || l.startsWith("/sessions") },
  { href: "/workbench", label: "Workbench",  icon: FlaskConical,     match: (l: string) => l.startsWith("/workbench") },
  { href: "/bridge",    label: "Bridge",     icon: Radio,            match: (l: string) => l.startsWith("/bridge") },
  { href: "/billing",   label: "Billing",    icon: CreditCard,       match: (l: string) => l.startsWith("/billing") || l.startsWith("/pricing") },
  { href: "/settings",  label: "Settings",   icon: Settings,         match: (l: string) => l === "/settings" },
];

export function Navbar() {
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center gap-3">
        {/* Logo */}
        <Link href="/" className="flex items-center shrink-0">
          <img
            src="/viba-logo.png"
            alt="VIBA"
            className="h-9 w-auto object-contain"
          />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center flex-1 h-full">
          {NAV_LINKS.map(({ href, label, match }) => {
            const active = match(location);
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex items-center h-full px-4 text-sm font-medium transition-colors border-b-2 ${
                  active
                    ? "text-foreground border-primary"
                    : "text-foreground/60 border-transparent hover:text-foreground/80 hover:border-border"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Mobile nav */}
        <nav className="flex md:hidden items-center gap-1 flex-1">
          {NAV_LINKS.map(({ href, label, icon: Icon, match }) => {
            const active = match(location);
            return (
              <Link key={href} href={href}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-8 px-2 gap-1 text-xs ${
                    active ? "text-foreground bg-accent/30" : "text-foreground/60"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden xs:inline">{label}</span>
                </Button>
              </Link>
            );
          })}
        </nav>

        {/* New Session CTA */}
        <Link href="/sessions/new" className="shrink-0">
          <Button variant="default" size="sm" className="h-8 gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New Session</span>
          </Button>
        </Link>
      </div>
    </header>
  );
}
