import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, XCircle, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface UsageEvent {
  id: number;
  task_type: string;
  execution_method: string;
  provider: string | null;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  estimated_cost_usd: number;
  estimated_savings_usd: number;
  savings_reasons: string[];
  success: boolean;
  cache_hit: boolean;
  quality_mode: string;
  created_at: string;
}

interface HistoryResponse {
  events: UsageEvent[];
  total: number;
  page: number;
  limit: number;
}

const METHOD_COLORS: Record<string, string> = {
  cache:         "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  local_tool:    "bg-blue-500/15 text-blue-400 border-blue-500/30",
  rule_engine:   "bg-sky-500/15 text-sky-400 border-sky-500/30",
  economy_model: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  premium_model: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  multi_model:   "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

const METHOD_LABELS: Record<string, string> = {
  cache:         "Cache",
  local_tool:    "Local Tool",
  rule_engine:   "Rule Engine",
  economy_model: "Economy Model",
  premium_model: "Premium Model",
  multi_model:   "Multi-Model",
};

// Generate last 12 months as options
function getMonthOptions() {
  const options: { label: string; value: string }[] = [{ label: "All time", value: "all" }];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    options.push({ label, value });
  }
  return options;
}

const MONTH_OPTIONS = getMonthOptions();

function monthToRange(monthValue: string): { after?: string; before?: string } {
  if (monthValue === "all") return {};
  const [year, month] = monthValue.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return {
    after: start.toISOString(),
    before: end.toISOString(),
  };
}

export default function UsageHistoryPage() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [provider, setProvider] = useState("all");
  const [taskType, setTaskType] = useState("all");
  const [method, setMethod] = useState("all");
  const [month, setMonth] = useState(MONTH_OPTIONS[1]?.value ?? "all"); // default: current month

  const range = monthToRange(month);
  const params = new URLSearchParams({ page: String(page), limit: "50" });
  if (provider !== "all") params.set("provider", provider);
  if (taskType !== "all") params.set("taskType", taskType);
  if (method !== "all") params.set("method", method);
  if (range.after) params.set("after", range.after);
  if (range.before) params.set("before", range.before);

  const { data, isLoading } = useQuery<HistoryResponse>({
    queryKey: ["/api/ai/usage/history", page, provider, taskType, method, month],
    queryFn: () =>
      fetch(`/api/ai/usage/history?${params}`, { credentials: "include" }).then(r => r.json()),
  });

  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  function exportCsv() {
    if (!data?.events.length) return;
    const headers = ["Date", "Task Type", "Method", "Provider", "Model", "Tokens (est.)", "Est. Cost $", "Est. Saving $", "Success"];
    const rows = data.events.map(ev => [
      new Date(ev.created_at).toISOString(),
      ev.task_type,
      ev.execution_method,
      ev.provider ?? "",
      ev.model ?? "",
      String(ev.prompt_tokens + ev.completion_tokens),
      ev.estimated_cost_usd.toFixed(6),
      ev.estimated_savings_usd.toFixed(6),
      ev.success ? "yes" : "no",
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `viba-usage-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exported" });
  }

  return (
    <AppLayout>
      <div className="container max-w-6xl py-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Usage History</h1>
            <p className="text-muted-foreground mt-1">Every AI task routed through VIBA. Costs are estimated.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={!data?.events.length}
            className="shrink-0"
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          {/* Month picker */}
          <Select value={month} onValueChange={v => { setMonth(v); setPage(1); }}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Month" />
            </SelectTrigger>
            <SelectContent>
              {MONTH_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {[
            {
              label: "Provider", value: provider, onChange: setProvider,
              options: [
                { label: "All providers", value: "all" },
                { label: "Groq", value: "groq" },
                { label: "OpenAI", value: "openai" },
                { label: "Anthropic", value: "anthropic" },
                { label: "Gemini", value: "gemini" },
                { label: "Perplexity", value: "perplexity" },
                { label: "Ollama", value: "ollama" },
              ],
            },
            {
              label: "Task type", value: taskType, onChange: setTaskType,
              options: [
                { label: "All types", value: "all" },
                ...["general","grammar","rewriting","summarisation","code_review","bug_diagnosis",
                   "architecture","business_strategy","research","security_review",
                   "complex_reasoning","creative_generation","data_extraction","document_analysis"]
                  .map(t => ({ label: t.replace(/_/g, " "), value: t })),
              ],
            },
            {
              label: "Method", value: method, onChange: setMethod,
              options: [
                { label: "All methods", value: "all" },
                ...Object.entries(METHOD_LABELS).map(([v, l]) => ({ label: l, value: v })),
              ],
            },
          ].map(({ label, value, onChange, options }) => (
            <Select
              key={label}
              value={value}
              onValueChange={v => { onChange(v); setPage(1); }}
            >
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue placeholder={label} />
              </SelectTrigger>
              <SelectContent>
                {options.map(o => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
        </div>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {isLoading ? "Loading…" : `${(data?.total ?? 0).toLocaleString()} task${(data?.total ?? 0) !== 1 ? "s" : ""}`}
              {!isLoading && month !== "all" && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  in {MONTH_OPTIONS.find(o => o.value === month)?.label}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            {isLoading ? (
              <div className="py-16 text-center text-sm text-muted-foreground">Loading usage history…</div>
            ) : !data?.events.length ? (
              <div className="py-16 text-center">
                <p className="text-sm text-muted-foreground">No tasks found for the selected filters.</p>
                {month !== "all" && (
                  <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => setMonth("all")}>
                    View all time
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40">
                      {[
                        "Task", "Method", "Provider / Model",
                        "Tokens (est.)", "Est. Cost", "Est. Saving", "Status", "Date",
                      ].map(h => (
                        <th key={h} className="text-left text-xs text-muted-foreground font-medium py-2 pr-4 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {data.events.map(ev => (
                      <tr key={ev.id} className="hover:bg-accent/20 transition-colors">
                        <td className="py-2.5 pr-4 max-w-[160px]">
                          <p className="text-sm truncate capitalize">{ev.task_type.replace(/_/g, " ")}</p>
                          <p className="text-xs text-muted-foreground capitalize">{ev.quality_mode}</p>
                        </td>
                        <td className="py-2.5 pr-4">
                          <Badge
                            className={`text-[10px] border px-1.5 py-0 ${METHOD_COLORS[ev.execution_method] ?? "bg-muted text-muted-foreground border-border"}`}
                          >
                            {METHOD_LABELS[ev.execution_method] ?? ev.execution_method}
                          </Badge>
                          {ev.cache_hit && (
                            <span className="ml-1 text-[10px] text-emerald-400">cached</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4">
                          <p className="text-xs capitalize">{ev.provider ?? "—"}</p>
                          <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">{ev.model ?? "—"}</p>
                        </td>
                        <td className="py-2.5 pr-4 text-xs">
                          {(ev.prompt_tokens + ev.completion_tokens).toLocaleString()}
                        </td>
                        <td className="py-2.5 pr-4 text-xs font-mono">
                          ${ev.estimated_cost_usd.toFixed(4)}
                        </td>
                        <td className="py-2.5 pr-4 text-xs font-mono text-emerald-400">
                          ${ev.estimated_savings_usd.toFixed(4)}
                        </td>
                        <td className="py-2.5 pr-4">
                          {ev.success
                            ? <CheckCircle className="h-4 w-4 text-emerald-400" />
                            : <XCircle className="h-4 w-4 text-rose-400" />}
                        </td>
                        <td className="py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(ev.created_at).toLocaleDateString("en-GB", {
                            day: "2-digit", month: "short",
                          })}
                          <br />
                          <span className="text-[10px] text-muted-foreground/60">
                            {new Date(ev.created_at).toLocaleTimeString("en-GB", {
                              hour: "2-digit", minute: "2-digit",
                            })}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totals row */}
                {data.events.length > 0 && (
                  <div className="flex items-center justify-between pt-3 mt-1 border-t border-border/30 text-xs text-muted-foreground">
                    <span>
                      Showing {data.events.length} of {data.total.toLocaleString()} tasks
                      {month !== "all" && ` in ${MONTH_OPTIONS.find(o => o.value === month)?.label}`}
                    </span>
                    <div className="flex items-center gap-4">
                      <span>
                        Page total — est. cost:{" "}
                        <span className="font-mono text-foreground/80">
                          ${data.events.reduce((a, e) => a + e.estimated_cost_usd, 0).toFixed(4)}
                        </span>
                      </span>
                      <span>
                        est. saved:{" "}
                        <span className="font-mono text-emerald-400">
                          ${data.events.reduce((a, e) => a + e.estimated_savings_usd, 0).toFixed(4)}
                        </span>
                      </span>
                    </div>
                  </div>
                )}

                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4">
                    <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline" size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline" size="sm"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
