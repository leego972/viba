import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Cpu, Settings, Activity, FlaskConical } from "lucide-react";

export function Navbar() {
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center gap-3">
        {/* Logo — always visible */}
        <Link href="/" className="flex items-center space-x-2 shrink-0">
          <Cpu className="h-6 w-6 text-primary" />
          <span className="font-bold hidden sm:inline-block">BridgeAI</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center space-x-6 text-sm font-medium flex-1">
          <Link
            href="/dashboard"
            className={`transition-colors hover:text-foreground/80 ${
              location.startsWith("/dashboard") || location.startsWith("/sessions")
                ? "text-foreground"
                : "text-foreground/60"
            }`}
          >
            Dashboard
          </Link>
          <Link
            href="/workbench"
            className={`transition-colors hover:text-foreground/80 flex items-center gap-1.5 ${
              location.startsWith("/workbench") ? "text-foreground" : "text-foreground/60"
            }`}
          >
            <FlaskConical className="h-3.5 w-3.5" />
            Workbench
          </Link>
          <Link
            href="/settings"
            className={`transition-colors hover:text-foreground/80 ${
              location === "/settings" ? "text-foreground" : "text-foreground/60"
            }`}
          >
            Settings
          </Link>
        </nav>

        {/* Mobile nav — icon + label buttons */}
        <nav className="flex md:hidden items-center gap-1 flex-1">
          <Link href="/dashboard">
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 px-2 gap-1 text-xs ${
                location.startsWith("/dashboard") || location.startsWith("/sessions")
                  ? "text-foreground"
                  : "text-foreground/60"
              }`}
            >
              <Activity className="h-3.5 w-3.5 shrink-0" />
              <span>Dashboard</span>
            </Button>
          </Link>
          <Link href="/workbench">
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 px-2 gap-1 text-xs ${
                location.startsWith("/workbench") ? "text-foreground" : "text-foreground/60"
              }`}
            >
              <FlaskConical className="h-3.5 w-3.5 shrink-0" />
              <span>Workbench</span>
            </Button>
          </Link>
          <Link href="/settings">
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 px-2 gap-1 text-xs ${
                location === "/settings" ? "text-foreground" : "text-foreground/60"
              }`}
            >
              <Settings className="h-3.5 w-3.5 shrink-0" />
              <span>Settings</span>
            </Button>
          </Link>
        </nav>

        {/* New Session button — always visible */}
        <Link href="/sessions/new" className="shrink-0">
          <Button variant="default" size="sm" className="h-8 gap-2">
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">New Session</span>
          </Button>
        </Link>
      </div>
    </header>
  );
}
