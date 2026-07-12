import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  cache: "#10b981",
  local_tool: "#3b82f6",
  rule_engine: "#06b6d4",
  economy_model: "#f59e0b",
  premium_model: "#8b5cf6",
  multi_model: "#ef4444",
};

const METHOD_LABELS: Record<string, string> = {
  cache: "Cache",
  local_tool: "Local Tool",
  rule_engine: "Rule Engine",
  economy_model: "Economy Model",
  premium_model: "Premium Model",
  multi_model: "Multi-Model",
};

function StatCard({ icon: Icon, label, value, sub, highlight }: {
  icon: React.ElementType; label: string; value: string; sub?: string; highlight?: boolean;
}) {
  return (
    <Card className={`border-border/50 ${highlight ? "border-emerald-500/30 bg-emerald-500/5" : "bg-card/60"}`}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${highlight ? "bg-emerald-500/15" : "bg-primary/10"}`}>
            <Icon className={`h-4 w-4 ${highlight ? "text-emerald-400" : "text-primary"}`} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="text-xl font-bold mt-0.5">{value}</p>
            {sub && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AiSavingsPage() {
  const { data: summaryData, isLoading } = useQuery<{ summary: MonthlySummary }>({
    queryKey: ["/api/ai/savings/summary"],
    queryFn: () => fetch("/api/ai/savings/summary", { credentials: "include" }).then(r => r.json()),
  });

  const { data: breakdownData } = useQuery<Breakdown>({
    queryKey: ["/api/ai/usage/breakdown"],
    queryFn: () => fetch("/api/ai/usage/breakdown", { credentials: "include" }).then(r => r.json()),
  });

  const summary = summaryData?.summary;

  const pieData = breakdownData?.byMethod
    ?.filter(m => Number(m.tasks) > 0)
    .map(m => ({
      name: METHOD_LABELS[m.execution_method] ?? m.execution_method,
      value: Number(m.tasks),
      color: METHOD_COLORS[m.execution_method] ?? "#6366f1",
    })) ?? [];

  const dailyData = (breakdownData?.daily ?? []).map(d => ({
    day: new Date(d.day).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    cost: Number(d.cost).toFixed(4),
    tasks: Number(d.tasks),
  }));

  return (
    <AppLayout>
      <div className="container max-w-5xl py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Savings</h1>
          <p className="text-muted-foreground mt-1">
            Estimated savings based on measured token usage and configured provider pricing.
          </p>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground text-sm">Loading savings data…</div>
        ) : summary ? (
          <>
            {/* Key metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={TrendingDown} label="Estimated savings" value={`$${summary.estimatedSavingsUsd.toFixed(2)}`} sub="Estimated" highlight />
              <StatCard icon={DollarSign} label="Estimated spend" value={`$${summary.estimatedSpendUsd.toFixed(2)}`} sub="Estimated" />
              <StatCard icon={BarChart3} label="Percentage saved" value={`${summary.percentageSaved}%`} sub="Estimated" highlight />
              <StatCard icon={Zap} label="Total tasks" value={String(summary.totalTasks)} />
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
                <CardTitle className="text-base">Cost Comparison</CardTitle>
                <CardDescription>Estimated spend vs what you would have spent without optimisation. <span className="text-amber-400/80">Estimated.</span></CardDescription>
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
                          className="absolute inset-y-0 left-0 bg-emerald-500/60 rounded-full"
                          style={{
                            width: summary.estimatedSpendWithoutOptimisationUsd > 0
                              ? `${Math.min(100, (summary.estimatedSpendUsd / summary.estimatedSpendWithoutOptimisationUsd) * 100)}%`
                              : "0%"
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-emerald-400 font-medium">
                      Estimated saving: ${summary.estimatedSavingsUsd.toFixed(2)} ({summary.percentageSaved}%)
                    </p>
                    <p className="text-xs text-muted-foreground/60">Tokens avoided (Estimated): {summary.tokensAvoided.toLocaleString()}</p>
                  </div>

                  {pieData.length > 0 && (
                    <div className="w-full sm:w-[220px] h-[180px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={2}>
                            {pieData.map((entry, i) => (
                              <Cell key={i} fill={entry.color} opacity={0.85} />
                            ))}
                          </Pie>
                          <Legend
                            iconType="circle"
                            iconSize={8}
                            formatter={(val) => <span className="text-xs text-muted-foreground">{val}</span>}
                          />
                          <Tooltip
                            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
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
                  <CardTitle className="text-base">Daily Usage (30 days)</CardTitle>
                  <CardDescription>Estimated cost per day. <span className="text-amber-400/80">Estimated.</span></CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                        <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          formatter={(val) => [`$${val}`, "Est. cost"]}
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
                  <CardTitle className="text-base">Savings by Provider</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {breakdownData!.byProvider.map(p => (
                      <div key={p.provider} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                        <div>
                          <p className="text-sm font-medium capitalize">{p.provider ?? "Unknown"}</p>
                          <p className="text-xs text-muted-foreground">{p.tasks} tasks</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">${Number(p.cost).toFixed(4)}</p>
                          <p className="text-xs text-emerald-400">saved ${Number(p.savings).toFixed(4)}</p>
                        </div>
                      </div>
                    ))}
                    <p className="text-[10px] text-muted-foreground/60 pt-1">All figures are Estimated based on measured token usage.</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <Card className="border-border/50">
            <CardContent className="py-16 text-center">
              <TrendingDown className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No usage data yet. Run your first optimised task to see savings here.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
