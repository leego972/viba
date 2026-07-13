import { Link } from "wouter";
import { motion } from "framer-motion";
import { Clock, DollarSign, Bot, ChevronRight, CheckCircle2, AlertTriangle, Pause, Loader2 } from "lucide-react";
import { useReducedMotion } from "@/lib/motionPreferences";

interface Agent {
  name?: string;
  provider?: string;
}

interface MissionCardProps {
  id: number;
  goal?: string | null;
  status: string;
  estimatedCost?: number | null;
  agentModes?: Agent[];
  createdAt?: string | number | null;
  elapsedLabel?: string;
  index?: number;
}

const STATUS_CONFIG = {
  active:    { color: "#3b82f6", label: "Active",    Icon: Loader2,      glow: "rgba(59,130,246,0.12)" },
  completed: { color: "#22c55e", label: "Complete",  Icon: CheckCircle2, glow: "rgba(34,197,94,0.08)"  },
  stopped:   { color: "#ef4444", label: "Stopped",   Icon: AlertTriangle,glow: "rgba(239,68,68,0.08)"  },
  paused:    { color: "#f59e0b", label: "Paused",    Icon: Pause,        glow: "rgba(245,158,11,0.08)" },
  pending:   { color: "#6b7280", label: "Pending",   Icon: Clock,        glow: "rgba(107,114,128,0.08)"},
} as const;

function formatMs(ms: number): string {
  if (ms < 2000) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function MissionCard({ id, goal, status, estimatedCost, agentModes = [], createdAt, index = 0 }: MissionCardProps) {
  const reduced = useReducedMotion();
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
  const { Icon } = cfg;

  const ageMs = createdAt
    ? Date.now() - (typeof createdAt === "number" ? createdAt : new Date(createdAt).getTime())
    : null;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
    >
      <Link href={`/sessions/${id}`}>
        <div
          className="group relative flex items-start gap-3 rounded-xl border border-white/[0.06] p-3 transition-all cursor-pointer hover:border-white/[0.12] hover:bg-white/[0.02]"
          style={{ background: cfg.glow }}
        >
          {/* Status rail */}
          <div
            className="mt-0.5 h-10 w-0.5 rounded-full shrink-0"
            style={{ background: cfg.color, boxShadow: `0 0 6px ${cfg.color}60` }}
          />

          <div className="flex-1 min-w-0">
            {/* Goal */}
            <div className="text-sm font-medium text-white/90 truncate leading-tight">
              {goal ?? `Session #${id}`}
            </div>

            {/* Meta row */}
            <div className="mt-1.5 flex items-center gap-3 text-[10px] text-white/40 flex-wrap">
              <div className="flex items-center gap-1" style={{ color: cfg.color }}>
                <Icon className={`h-2.5 w-2.5 ${status === "active" ? "animate-spin" : ""}`} />
                <span className="font-medium">{cfg.label}</span>
              </div>

              {estimatedCost != null && estimatedCost > 0 && (
                <div className="flex items-center gap-0.5">
                  <DollarSign className="h-2.5 w-2.5" />
                  <span>{estimatedCost.toFixed(4)}</span>
                </div>
              )}

              {ageMs !== null && (
                <div className="flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" />
                  <span>{formatMs(ageMs)}</span>
                </div>
              )}

              {agentModes.length > 0 && (
                <div className="flex items-center gap-0.5">
                  <Bot className="h-2.5 w-2.5" />
                  <span>{agentModes.length} agent{agentModes.length !== 1 ? "s" : ""}</span>
                </div>
              )}
            </div>
          </div>

          {/* Arrow */}
          <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/50 shrink-0 mt-0.5 transition-colors" />
        </div>
      </Link>
    </motion.div>
  );
}
