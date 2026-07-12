import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { TrendingDown, Zap, Database, Wrench, Brain, DollarSign, RefreshCw, BarChart3 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

interface MonthlySummary {
  totalTasks: number;
  tasksWithoutPremium: number;
  cacheHits: number;
  localToolExecutions: number;
  ruleEngineExecutions: number;
  economyModelExecutions: number;
  premiumModelExecutions: number;
  estimatedSpendUsd: number;
  estimatedSpendWithoutOptimisationUsd: number;
  estimatedSavingsUsd: number;
  tokensAvoided: number;
  duplicateTasksPrevented: number;
  percentageSaved: number;
}

interface Breakdown {
  byProvider: Array<{ provider: string; tasks: string; cost: string; savings: string }>;
  byMethod: Array<{ execution_method: string; tasks: string; savings: string }>;
  daily: Array<{ day: string; tasks: string; cost: string }>;
}

const METHOD_COLORS: Record<string, string> = {
  cache:         "#10b981",
  local_tool:    "#3b82f6",
  rule_engine:   "#06b6d4",
  economy_model: "#f59e0b",
  premium_model: "#8b5cf6",
  multi_model:   "#ef4444",
};

const METHOD_LABELS: Record<string, string> = {
  cache:         "Cache",
  local_tool:    "Local Tool",
  rule_engine:   "Rule Engine",
  economy_model: "Economy Model",
  premium_model: "Premium Model",
  multi_model:   "Multi-Model",
};

// Generate last 12 months
function getMonthOptions() {
  const options: { label: string; value: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = i === 0 ? "This month" : d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    options.push({ label, value });
  }
  return options;
}

const MONTH_OPTIONS = getMonthOptions();

function StatCard({ icon: Icon, label, value, sub, highlight }: {
  icon: React.ElementType; label: string; value: string; sub?: string; highlight?: boolean;
}) {
  return (
    <Card className={`border-border/50 ${highlight ? "border-emerald-500/30 bg-emerald-500/5" : "bg-card/60"}`}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg shrink-0 ${highlight ? "bg-emerald-500/15" : "bg-primary/10"}`}>
            <Icon className={`h-4 w-4 ${highlight ? "text-emerald-400" : "text-primary"}`} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="text-xl font-bold mt-0.5 leading-tight">{value}</p>
            {sub && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AiSavingsPage() {
  const [month, setMonth] = useState(MONTH_OPTIONS[0]?.value ?? "");

  // Build query params for the selected month
  function monthParams() {
    if (!month) return "";
    const [year, mon] = month.split("-").map(Number);
    const after = new Date(year, mon - 1, 1).toISOString();
    const before = new Date(year, mon, 1).toISOString();
    return `?after=${encodeURIComponent(after)}&before=${encodeURIComponent(before)}`;
  }

  const { data: summaryData, isLoading } = useQuery<{ summary: MonthlySummary }>({
    queryKey: ["/api/ai/savings/summary", month],
    queryFn: () =>
      fetch(`/api/ai/savings/summary${monthParams()}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: breakdownData } = useQuery<Breakdown>({
    queryKey: ["/api/ai/usage/breakdown", month],
    queryFn: () =>
      fetch(`/api/ai/usage/breakdown${monthParams()}`, { credentials: "include" }).then(r => r.json()),
  });

  const summary = summaryData?.summary;

  const pieData = (breakdownData?.byMethod ?? [])
    .filter(m => Number(m.tasks) > 0)
    .map(m => ({
      name: METHOD_LABELS[m.execution_method] ?? m.execution_method,
      value: Number(m.tasks),
      color: METHOD_COLORS[m.execution_method] ?? "#6366f1",
    }));

  const dailyData = (breakdownData?.daily ?? []).map(d => ({
    day: new Date(d.day).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    cost: Number(d.cost).toFixed(4),
    tasks: Number(d.tasks),
  }));

  const selectedLabel = MONTH_OPTIONS.find(o => o.value === month)?.label ?? "This month";

  return (
    <AppLayout>
      <div className="container max-w-5xl py-8 space-y-8">

        {/* Header + month picker */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AI Savings</h1>
            <p className="text-muted-foreground mt-1">
              Estimated savings based on measured token usage and configured provider pricing.
            </p>
          </div>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-9 w-[180px] text-sm shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground text-sm">Loading savings data…</div>
        ) : summary ? (
          <>
            {/* Key metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={TrendingDown} label="Estimated savings" value={`$${summary.estimatedSavingsUsd.toFixed(2)}`} sub={`${summary.percentageSaved}% saved — est.`} highlight />
              <StatCard icon={DollarSign} label="Estimated spend" value={`$${summary.estimatedSpendUsd.toFixed(2)}`} sub="Estimated" />
              <StatCard icon={BarChart3} label="Total tasks" value={String(summary.totalTasks)} />
              <StatCard icon={Zap} label="Without premium AI" value={String(summary.tasksWithoutPremium)} sub={`of ${summary.totalTasks} tasks`} highlight />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={Database} label="Cache hits" value={String(summary.cacheHits)} />
              <StatCard icon={Wrench} label="Local tool runs" value={String(summary.localToolExecutions)} />
              <StatCard icon={RefreshCw} label="Rule engine runs" value={String(summary.ruleEngineExecutions)} />
              <StatCard icon={Brain} label="Premium model runs" value={String(summary.premiumModelExecutions)} />
            </div>

            {/* Cost comparison */}
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="text-base">Cost Comparison — {selectedLabel}</CardTitle>
                <CardDescription>
                  Estimated actual spend vs what the same tasks would cost without VIBA optimisation.{" "}
                  <span className="text-amber-400/80">All figures estimated.</span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row items-center gap-6">
                  <div className="flex-1 w-full space-y-3">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground">Without VIBA</span>
                        <span className="font-medium">${summary.estimatedSpendWithoutOptimisationUsd.toFixed(2)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-rose-500/30 relative overflow-hidden">
                        <div className="absolute inset-0 bg-rose-500/60 rounded-full" />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground">With VIBA</span>
                        <span className="font-medium text-emerald-400">${summary.estimatedSpendUsd.toFixed(2)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-border/40 relative overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 bg-emerald-500/60 rounded-full transition-all duration-500"
                          style={{
                            width: summary.estimatedSpendWithoutOptimisationUsd > 0
                              ? `${Math.min(100, (summary.estimatedSpendUsd / summary.estimatedSpendWithoutOptimisationUsd) * 100)}%`
                              : "0%",
                          }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-emerald-400 font-medium">
                        Estimated saving: ${summary.estimatedSavingsUsd.toFixed(2)} ({summary.percentageSaved}%)
                      </span>
                      <span className="text-muted-foreground/60">
                        {summary.tokensAvoided.toLocaleString()} tokens avoided (est.)
                      </span>
                    </div>
                  </div>

                  {pieData.length > 0 && (
                    <div className="w-full sm:w-[220px] h-[200px] shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData}
                            cx="50%" cy="45%"
                            innerRadius={45} outerRadius={70}
                            dataKey="value"
                            paddingAngle={2}
                          >
                            {pieData.map((entry, i) => (
                              <Cell key={i} fill={entry.color} opacity={0.85} />
                            ))}
                          </Pie>
                          <Legend
                            iconType="circle"
                            iconSize={8}
                            wrapperStyle={{ fontSize: 10 }}
                            formatter={(val) => (
                              <span className="text-[10px] text-muted-foreground">{val}</span>
                            )}
                          />
                          <Tooltip
                            contentStyle={{
                              background: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: 8,
                              fontSize: 11,
                            }}
                            formatter={(val) => [`${val} tasks`, ""]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Daily usage chart */}
            {dailyData.length > 0 && (
              <Card className="border-border/50">
                <CardHeader>
                  <CardTitle className="text-base">Daily Spend — {selectedLabel}</CardTitle>
                  <CardDescription>Estimated cost per day. <span className="text-amber-400/80">Estimated.</span></CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                        <XAxis
                          dataKey="day"
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={v => `$${v}`}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: 8,
                            fontSize: 11,
                          }}
                          formatter={(val) => [`$${val} est.`, "Cost"]}
                        />
                        <Bar dataKey="cost" fill="#6366f1" radius={[3, 3, 0, 0]} opacity={0.8} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Provider breakdown */}
            {(breakdownData?.byProvider?.length ?? 0) > 0 && (
              <Card className="border-border/50">
                <CardHeader>
                  <CardTitle className="text-base">Breakdown by Provider — {selectedLabel}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {breakdownData!.byProvider.map(p => (
                      <div key={p.provider ?? "unknown"} className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-0">
                        <div>
                          <p className="text-sm font-medium capitalize">{p.provider ?? "Unknown"}</p>
                          <p className="text-xs text-muted-foreground">{p.tasks} tasks</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-mono">${Number(p.cost).toFixed(4)} <span className="text-[10px] text-muted-foreground/60">est.</span></p>
                          <p className="text-xs text-emerald-400">saved ${Number(p.savings).toFixed(4)} <span className="text-[10px] text-emerald-400/60">est.</span></p>
                        </div>
                      </div>
                    ))}
                    <p className="text-[10px] text-muted-foreground/50 pt-2">
                      All figures are estimated based on measured token usage and configured model pricing.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <Card className="border-border/50">
            <CardContent className="py-16 text-center">
              <TrendingDown className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-1">No usage data for {selectedLabel}.</p>
              <p className="text-xs text-muted-foreground/60">
                Run your first optimised task, or select a different month.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
