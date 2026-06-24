import { useEffect, useState } from "react";
import { Link } from "wouter";

type Status = {
  subscriptionStatus: string;
  creditsRemaining: number;
  creditsPeriodEnd: string | null;
};

export function CreditBalancePill({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/billing/status", { credentials: "include" });
        if (!response.ok) return;
        const data = (await response.json()) as Status;
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setStatus(null);
      }
    }
    void load();
    const interval = window.setInterval(() => void load(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  if (!status) return null;
  const low = status.creditsRemaining <= 25;

  return (
    <Link
      href="/billing"
      className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${
        low ? "border-amber-500/35 bg-amber-500/10 text-amber-300" : "border-primary/25 bg-primary/10 text-primary"
      } ${className}`}
      title="Open credit balance"
    >
      <span>{status.creditsRemaining.toLocaleString()}</span>
      {!compact && <span className="text-muted-foreground">credits</span>}
    </Link>
  );
}
