import { motion } from "framer-motion";
import { TrendingDown } from "lucide-react";
import { computeSavings, fmtUSD, fmtPct } from "@/lib/costSavings";
import { useReducedMotion } from "@/lib/motionPreferences";

interface Props {
  vibaActual: number;
  premiumEstimate: number;
  isEstimate?: boolean;
  compact?: boolean;
}

export function SavingsMeter({ vibaActual, premiumEstimate, isEstimate = false, compact = false }: Props) {
  const reduced = useReducedMotion();
  const s = computeSavings(vibaActual, premiumEstimate);

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 text-emerald-400">
        <TrendingDown className="h-3 w-3" />
        <span className="text-xs font-semibold">{fmtUSD(s.savedAmount)} saved</span>
        {isEstimate && <span className="text-[9px] text-white/30">(est.)</span>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <TrendingDown className="h-4 w-4 text-emerald-400" />
        <span className="text-xs font-semibold text-white/80 uppercase tracking-widest">Cost Savings</span>
        {isEstimate && (
          <span className="ml-auto text-[9px] text-white/30 border border-white/10 rounded px-1 py-0.5">Estimated</span>
        )}
      </div>

      {/* Bar comparison */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-[10px] text-white/50">
          <span>VIBA actual</span>
          <span className="font-medium text-white/80">{fmtUSD(vibaActual)}</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-blue-500"
            initial={{ width: 0 }}
            animate={{ width: `${premiumEstimate > 0 ? (vibaActual / premiumEstimate) * 100 : 100}%` }}
            transition={reduced ? { duration: 0 } : { duration: 0.8, ease: "easeOut" }}
          />
        </div>

        <div className="flex justify-between text-[10px] text-white/50">
          <span>Premium-only{isEstimate ? " (est.)" : ""}</span>
          <span className="font-medium text-white/50">{fmtUSD(premiumEstimate)}</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full rounded-full bg-white/15 w-full" />
        </div>
      </div>

      {/* Savings highlight */}
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 flex items-center justify-between">
        <span className="text-xs text-emerald-400 font-medium">Saved</span>
        <div className="text-right">
          <div className="text-sm font-bold text-emerald-400">{fmtUSD(s.savedAmount)}</div>
          <div className="text-[9px] text-emerald-400/60">{fmtPct(s.savedPct)} reduction</div>
        </div>
      </div>
    </div>
  );
}
