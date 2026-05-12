import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Cpu, Settings, Activity } from "lucide-react";

export function Navbar() {
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center">
        <div className="mr-4 hidden md:flex">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <Cpu className="h-6 w-6 text-primary" />
            <span className="hidden font-bold sm:inline-block">
              BridgeAI
            </span>
          </Link>
          <nav className="flex items-center space-x-6 text-sm font-medium">
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
              href="/settings"
              className={`transition-colors hover:text-foreground/80 ${
                location === "/settings" ? "text-foreground" : "text-foreground/60"
              }`}
            >
              Settings
            </Link>
          </nav>
        </div>
        <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
          <div className="w-full flex-1 md:w-auto md:flex-none">
            {/* Search or other global controls can go here */}
          </div>
          <nav className="flex items-center">
            <Link href="/sessions/new">
              <Button variant="default" size="sm" className="h-8 gap-2">
                <Activity className="h-4 w-4" />
                <span>New Session</span>
              </Button>
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
