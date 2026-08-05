import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Activity, AlertTriangle, Play, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import AdobeExecutionBrain, { type ExecutionVisualPhase } from "@/components/AdobeExecutionBrain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import "./home-cinematic.css";
import "./home-cinematic-live.css";

type Invocation = {
  id?: number;
  tool_id?: string;
  toolLabel?: string;
  status?: string;
  created_at?: string;
  agent_name?: string | null;
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function visualPhase(invocations: Invocation[]): ExecutionVisualPhase {
  const latest = invocations[0]?.status?.toLowerCase() ?? "";
  if (["failed", "error", "blocked"].some((value) => latest.includes(value))) return "failed";
  if (["complete", "completed", "success", "passed"].some((value) => latest.includes(value))) return "complete";
  if (["verify", "verifying", "test", "testing", "qa"].some((value) => latest.includes(value))) return "verifying";
  if (["running", "working", "executing", "active", "started"].some((value) => latest.includes(value))) return "working";
  if (["planning", "queued", "routing", "pending"].some((value) => latest.includes(value))) return "planning";
  return "idle";
}

function activeAgentNames(invocations: Invocation[]): string[] {
  return invocations
    .filter((item) => {
      const status = item.status?.toLowerCase() ?? "";
      return !["complete", "completed", "success", "passed", "failed", "error", "cancelled"].some((value) => status.includes(value));
    })
    .map((item) => item.agent_name ?? item.toolLabel ?? item.tool_id ?? "")
    .filter(Boolean)
    .slice(0, 8);
}

export default function ToolConsolePage() {
  const [invocations, setInvocations] = useState<Invocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`${BASE}/api/tools/invocations?limit=20`, { credentials: "include" });
      if (!response.ok) throw new Error("Activity feed unavailable");
      const payload = (await response.json()) as { invocations?: Invocation[] };
      setInvocations(payload.invocations ?? []);
      setError(null);
    } catch {
      setError("Live agent activity could not be loaded. The VIBA brain remains available in idle mode.");
      setInvocations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const phase = useMemo(() => visualPhase(invocations), [invocations]);
  const activeNodes = useMemo(() => activeAgentNames(invocations), [invocations]);
  const latest = invocations[0];

  return (
    <div className="min-h-screen bg-[#05070c] text-white">
      <Navbar />

      <main className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(76,29,149,.24),transparent_42%),radial-gradient(circle_at_80%_70%,rgba(14,165,233,.13),transparent_35%)]" />

        <section className="relative mx-auto grid min-h-[calc(100vh-4rem)] max-w-screen-2xl items-center gap-8 px-4 py-8 lg:grid-cols-[0.82fr_1.18fr] lg:px-8">
          <div className="z-10 max-w-xl">
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300">
              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,.95)]" />
              VIBA Brain
            </div>

            <h1 className="text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
              All agents. <span className="text-violet-300">One living brain.</span>
            </h1>
            <p className="mt-5 text-base leading-7 text-white/65">
              This is the same VIBA brain shown in the landing-page demo. Agents illuminate only when live activity identifies them as active.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/sessions/new">
                <Button className="gap-2 shadow-[0_0_28px_rgba(124,58,237,.35)]">
                  <Play className="h-4 w-4" />
                  Start VIBA
                </Button>
              </Link>
              <Button variant="outline" onClick={() => void refresh()} disabled={loading} className="gap-2 border-white/15 bg-white/5">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 backdrop-blur-xl">
                <Activity className="h-4 w-4 text-cyan-300" />
                <div className="mt-3 text-2xl font-bold">{activeNodes.length}</div>
                <div className="text-xs uppercase tracking-wider text-white/45">Active agents</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 backdrop-blur-xl">
                <Zap className="h-4 w-4 text-violet-300" />
                <div className="mt-3 text-2xl font-bold capitalize">{phase}</div>
                <div className="text-xs uppercase tracking-wider text-white/45">Brain state</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 backdrop-blur-xl">
                <ShieldCheck className="h-4 w-4 text-emerald-300" />
                <div className="mt-3 text-2xl font-bold">Live</div>
                <div className="text-xs uppercase tracking-wider text-white/45">Activity feed</div>
              </div>
            </div>

            {latest && (
              <div className="mt-4 rounded-2xl border border-violet-400/20 bg-violet-500/[0.07] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-violet-300">Latest activity</div>
                    <div className="mt-1 text-sm font-medium">{latest.toolLabel ?? latest.tool_id ?? "Agent task"}</div>
                    <div className="mt-1 text-xs text-white/50">{latest.agent_name ?? "VIBA"}</div>
                  </div>
                  <Badge variant="outline" className="border-violet-300/25 bg-violet-400/10 text-violet-200">
                    {latest.status ?? "tracked"}
                  </Badge>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
          </div>

          <div className="relative min-h-[520px] overflow-hidden rounded-[2rem] border border-white/10 bg-[#07090e] shadow-[0_0_90px_rgba(76,29,149,.22)] sm:min-h-[640px] lg:min-h-[720px]">
            <AdobeExecutionBrain
              phase={phase}
              activeNodes={activeNodes}
              className="absolute inset-0 h-full w-full"
              showOverlay
            />
          </div>
        </section>
      </main>
    </div>
  );
}
