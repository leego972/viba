import { Shield, Zap, Crown } from "lucide-react";

type PlanKey = "basic_assessment" | "pro_repair" | "admin_full_access" | "viba_monthly" | "viba_annual" | string;

interface PlanBadgeProps {
  planKey: PlanKey;
  className?: string;
}

function normalisePlan(planKey: PlanKey): "basic" | "pro" | "admin" {
  if (planKey === "admin_full_access") return "admin";
  if (planKey === "basic_assessment") return "basic";
  return "pro"; // pro_repair, viba_monthly, viba_annual
}

export function PlanBadge({ planKey, className = "" }: PlanBadgeProps) {
  const tier = normalisePlan(planKey);

  const configs = {
    basic: {
      label: "Basic Assessment",
      icon: <Shield className="h-3 w-3" />,
      cls: "border-zinc-600/40 bg-zinc-600/15 text-zinc-400",
    },
    pro: {
      label: planKey === "viba_annual" ? "Pro Repair (Annual)" : "Pro Repair",
      icon: <Zap className="h-3 w-3" />,
      cls: "border-indigo-500/40 bg-indigo-500/15 text-indigo-400",
    },
    admin: {
      label: "Admin Full Access",
      icon: <Crown className="h-3 w-3" />,
      cls: "border-amber-500/40 bg-amber-500/15 text-amber-400",
    },
  };

  const { label, icon, cls } = configs[tier];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls} ${className}`}
    >
      {icon}
      {label}
    </span>
  );
}
