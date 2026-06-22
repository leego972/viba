import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Home, LayoutDashboard, PlusCircle, Settings, CreditCard } from "lucide-react";
import { CreditBalancePill } from "@/components/CreditBalancePill";

type MobileShellProps = {
  children: ReactNode;
};

const tabs = [
  { href: "/", label: "Home", icon: Home },
  { href: "/dashboard", label: "Control", icon: LayoutDashboard },
  { href: "/sessions/new", label: "New", icon: PlusCircle },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileShell({ children }: MobileShellProps) {
  const [location] = useLocation();
  const isSession = location.startsWith("/sessions/") && location !== "/sessions/new";

  return (
    <div className="viba-mobile-shell">
      <header className="viba-mobile-appbar" aria-label="Mobile app navigation">
        <Link href="/dashboard" className="viba-mobile-brand" aria-label="Go to VIBA dashboard">
          <img src="/viba-logo.png" alt="" aria-hidden="true" />
          <span>{isSession ? "Live Session" : "VIBA"}</span>
        </Link>
        <nav className="viba-mobile-actions" aria-label="Quick actions">
          <CreditBalancePill compact className="viba-mobile-credit" />
          <Link href="/sessions/new" className="viba-mobile-action" aria-label="Start new session">
            New
          </Link>
          <Link href="/billing" className="viba-mobile-action" aria-label="Open billing">
            <CreditCard aria-hidden="true" size={16} />
          </Link>
        </nav>
      </header>

      <div className="viba-mobile-main">{children}</div>

      <nav className="viba-mobile-bottom-nav" aria-label="Primary mobile navigation">
        {tabs.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="viba-mobile-tab"
            data-active={isActive(location, href)}
            aria-current={isActive(location, href) ? "page" : undefined}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
