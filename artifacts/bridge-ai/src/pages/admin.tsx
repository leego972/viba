import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const SESSION_KEY = "viba_admin_token";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── API helper ───────────────────────────────────────────────────────────────

function adminFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`${BASE}/api/admin${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
}

// ─── Confirmation modal ───────────────────────────────────────────────────────

function ConfirmModal({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <p className="mb-1 text-sm font-semibold text-red-400">Confirm destructive action</p>
        <p className="mb-5 text-sm text-zinc-300">{message}</p>
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1 border-zinc-700 text-zinc-300"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white" onClick={onConfirm}>
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color = "zinc",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: "zinc" | "green" | "red" | "yellow" | "blue";
}) {
  const accent =
    color === "green"
      ? "text-green-400"
      : color === "red"
        ? "text-red-400"
        : color === "yellow"
          ? "text-yellow-400"
          : color === "blue"
            ? "text-blue-400"
            : "text-white";
  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
        <p className={`text-2xl font-bold ${accent}`}>{value}</p>
        {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Shared table wrapper ─────────────────────────────────────────────────────

function DataTable({
  cols,
  rows,
  renderRow,
  empty = "No data",
}: {
  cols: string[];
  rows: unknown[];
  renderRow: (row: unknown, i: number) => React.ReactNode;
  empty?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900">
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 text-left text-zinc-400 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className="px-3 py-6 text-center text-zinc-500">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map(renderRow)
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Pagination bar ───────────────────────────────────────────────────────────

function Pager({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (o: number) => void;
}) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center gap-2 mt-3 text-xs text-zinc-400">
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 border-zinc-700"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        ←
      </Button>
      <span>
        Page {page} / {pages} &nbsp;·&nbsp; {total.toLocaleString()} total
      </span>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 border-zinc-700"
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        →
      </Button>
    </div>
  );
}

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    adminFetch("/overview", token)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setErr("Failed to load overview"));
  }, [token]);

  if (err) return <p className="text-red-400 text-sm">{err}</p>;
  if (!data) return <p className="text-zinc-500 text-sm">Loading…</p>;

  const sess = data.sessions as { total: number; active: number };
  const subs = data.subscribers as { total: number; byStatus: Record<string, number> };
  const errs = data.errors as { today: number; last7d: number };
  const circ = data.circuits as { total: number; open: number };
  const uptime = data.uptime as number;
  const uptimeH = Math.floor(uptime / 3600);
  const uptimeM = Math.floor((uptime % 3600) / 60);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <StatCard label="Total sessions" value={sess.total} sub={`${sess.active} active`} color="blue" />
        <StatCard label="AI messages" value={(data.messages as number).toLocaleString()} />
        <StatCard label="Subscribers" value={subs.total} sub={Object.entries(subs.byStatus).map(([k, v]) => `${k}:${v}`).join(" · ")} color="green" />
        <StatCard label="Errors today" value={errs.today} sub={`${errs.last7d} last 7d`} color={errs.today > 0 ? "red" : "zinc"} />
        <StatCard label="Circuit breakers" value={`${circ.open}/${circ.total} open`} color={circ.open > 0 ? "red" : "green"} />
        <StatCard label="Uptime" value={`${uptimeH}h ${uptimeM}m`} sub={data.env as string} />
        <StatCard label="Node" value={data.nodeVersion as string} />
      </div>
    </div>
  );
}

// ─── Tab: Users ───────────────────────────────────────────────────────────────

type Subscriber = {
  id: number;
  email: string;
  status: string;
  stripe_customer_id: string | null;
  token_suffix: string;
  trial_end: string | null;
  current_period_end: string | null;
  created_at: string;
};

function UsersTab({ token }: { token: string }) {
  const { toast } = useToast();
  const [users, setUsers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{ msg: string; action: () => void } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    adminFetch("/users", token)
      .then((r) => r.json())
      .then((d) => setUsers(d.users ?? []))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const act = (msg: string, fn: () => Promise<void>) => {
    setConfirm({
      msg,
      action: async () => {
        setConfirm(null);
        try {
          await fn();
          toast({ title: "Done", description: msg });
          load();
        } catch {
          toast({ title: "Error", description: "Action failed", variant: "destructive" });
        }
      },
    });
  };

  const statusColor = (s: string) =>
    s === "active" ? "bg-green-500/20 text-green-400 border-green-700" :
    s === "trialing" ? "bg-blue-500/20 text-blue-400 border-blue-700" :
    s === "canceled" ? "bg-zinc-500/20 text-zinc-400 border-zinc-700" :
    "bg-red-500/20 text-red-400 border-red-700";

  if (loading) return <p className="text-zinc-500 text-sm">Loading…</p>;

  return (
    <>
      {confirm && (
        <ConfirmModal message={confirm.msg} onConfirm={confirm.action} onCancel={() => setConfirm(null)} />
      )}
      <DataTable
        cols={["ID", "Email", "Status", "Token (last 8)", "Trial end", "Period end", "Created", "Actions"]}
        rows={users}
        empty="No subscribers yet"
        renderRow={(row) => {
          const u = row as Subscriber;
          return (
            <tr key={u.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
              <td className="px-3 py-2 text-zinc-500">{u.id}</td>
              <td className="px-3 py-2 text-zinc-200 font-mono">{u.email}</td>
              <td className="px-3 py-2">
                <span className={`px-1.5 py-0.5 rounded text-[10px] border ${statusColor(u.status)}`}>
                  {u.status}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-zinc-400">…{u.token_suffix}</td>
              <td className="px-3 py-2 text-zinc-400">{u.trial_end ? new Date(u.trial_end).toLocaleDateString() : "—"}</td>
              <td className="px-3 py-2 text-zinc-400">{u.current_period_end ? new Date(u.current_period_end).toLocaleDateString() : "—"}</td>
              <td className="px-3 py-2 text-zinc-500">{new Date(u.created_at).toLocaleDateString()}</td>
              <td className="px-3 py-2">
                <div className="flex gap-1.5">
                  <button
                    onClick={() => act(`Revoke access token for ${u.email}? They will lose access immediately.`, async () => {
                      const r = await adminFetch(`/users/${u.id}/revoke`, token, {
                        method: "POST",
                        headers: { "X-Admin-Confirm": "true" },
                      });
                      if (!r.ok) throw new Error();
                    })}
                    className="text-[10px] px-2 py-0.5 rounded border border-yellow-700 text-yellow-400 hover:bg-yellow-900/30"
                  >
                    Revoke token
                  </button>
                  <button
                    onClick={() => act(`Cancel Stripe subscription for ${u.email}?`, async () => {
                      const r = await adminFetch(`/users/${u.id}/cancel-subscription`, token, {
                        method: "POST",
                        headers: { "X-Admin-Confirm": "true" },
                      });
                      if (!r.ok) throw new Error();
                    })}
                    className="text-[10px] px-2 py-0.5 rounded border border-red-800 text-red-400 hover:bg-red-900/30"
                  >
                    Cancel sub
                  </button>
                </div>
              </td>
            </tr>
          );
        }}
      />
    </>
  );
}

// ─── Tab: Sessions ────────────────────────────────────────────────────────────

function SessionsTab({ token }: { token: string }) {
  const { toast } = useToast();
  const [data, setData] = useState<{ sessions: unknown[]; total: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const [confirm, setConfirm] = useState<{ msg: string; action: () => void } | null>(null);
  const limit = 50;

  const load = useCallback(() => {
    adminFetch(`/sessions?limit=${limit}&offset=${offset}`, token)
      .then((r) => r.json())
      .then(setData);
  }, [token, offset]);

  useEffect(() => { load(); }, [load]);

  type SessionRow = {
    id: number; goal: string; status: string; mode: string;
    agent_count: number; message_count: number; task_count: number;
    estimated_cost: number | null; created_at: string;
  };

  if (!data) return <p className="text-zinc-500 text-sm">Loading…</p>;

  return (
    <>
      {confirm && (
        <ConfirmModal message={confirm.msg} onConfirm={confirm.action} onCancel={() => setConfirm(null)} />
      )}
      <DataTable
        cols={["ID", "Goal", "Status", "Mode", "Agents", "Messages", "Tasks", "Cost", "Created", "Del"]}
        rows={data.sessions}
        renderRow={(row) => {
          const s = row as SessionRow;
          return (
            <tr key={s.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
              <td className="px-3 py-2 text-zinc-500">{s.id}</td>
              <td className="px-3 py-2 text-zinc-200 max-w-[200px] truncate" title={s.goal}>{s.goal}</td>
              <td className="px-3 py-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${s.status === "active" ? "border-green-700 text-green-400" : "border-zinc-700 text-zinc-400"}`}>{s.status}</span>
              </td>
              <td className="px-3 py-2 text-zinc-400">{s.mode}</td>
              <td className="px-3 py-2 text-center text-zinc-300">{s.agent_count}</td>
              <td className="px-3 py-2 text-center text-zinc-300">{s.message_count}</td>
              <td className="px-3 py-2 text-center text-zinc-300">{s.task_count}</td>
              <td className="px-3 py-2 text-zinc-400">{s.estimated_cost != null ? `$${s.estimated_cost.toFixed(3)}` : "—"}</td>
              <td className="px-3 py-2 text-zinc-500">{new Date(s.created_at).toLocaleDateString()}</td>
              <td className="px-3 py-2">
                <button
                  onClick={() => setConfirm({
                    msg: `Permanently delete session #${s.id} and all its data?`,
                    action: async () => {
                      setConfirm(null);
                      const r = await adminFetch(`/sessions/${s.id}`, token, {
                        method: "DELETE",
                        headers: { "X-Admin-Confirm": "true" },
                      });
                      if (r.ok) { toast({ title: "Deleted", description: `Session ${s.id} deleted` }); load(); }
                      else toast({ title: "Error", variant: "destructive" });
                    },
                  })}
                  className="text-[10px] px-2 py-0.5 rounded border border-red-900 text-red-500 hover:bg-red-900/20"
                >
                  del
                </button>
              </td>
            </tr>
          );
        }}
      />
      <Pager offset={offset} limit={limit} total={data.total} onChange={setOffset} />
    </>
  );
}

// ─── Tab: AI Requests ─────────────────────────────────────────────────────────

function RequestsTab({ token }: { token: string }) {
  const [data, setData] = useState<{ requests: unknown[]; total: number; providers: string[] } | null>(null);
  const [offset, setOffset] = useState(0);
  const [provider, setProvider] = useState("");
  const limit = 100;

  const load = useCallback(() => {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (provider) q.set("provider", provider);
    adminFetch(`/requests?${q}`, token)
      .then((r) => r.json())
      .then(setData);
  }, [token, offset, provider]);

  useEffect(() => { load(); }, [load]);

  type MsgRow = {
    id: number; session_id: number; role: string; provider: string | null;
    model: string | null; content_preview: string; agent_name: string | null;
    created_at: string;
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <span className="text-xs text-zinc-400">Filter by provider:</span>
        <select
          value={provider}
          onChange={(e) => { setProvider(e.target.value); setOffset(0); }}
          className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
        >
          <option value="">All</option>
          {data?.providers.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      {!data ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : (
        <>
          <DataTable
            cols={["ID", "Session", "Role", "Provider", "Model", "Agent", "Content preview", "Time"]}
            rows={data.requests}
            renderRow={(row) => {
              const m = row as MsgRow;
              const isSimulated = m.content_preview?.includes("[Simulated");
              return (
                <tr key={m.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-3 py-2 text-zinc-500">{m.id}</td>
                  <td className="px-3 py-2 text-zinc-400">{m.session_id}</td>
                  <td className="px-3 py-2 text-zinc-400">{m.role}</td>
                  <td className="px-3 py-2 text-zinc-300">{m.provider ?? "—"}</td>
                  <td className="px-3 py-2 text-zinc-400 font-mono text-[10px]">{m.model ?? "—"}</td>
                  <td className="px-3 py-2 text-zinc-400">{m.agent_name ?? "—"}</td>
                  <td className="px-3 py-2 text-zinc-300 max-w-[300px] truncate" title={m.content_preview}>
                    {isSimulated && <span className="text-yellow-500 mr-1">[sim]</span>}
                    {m.content_preview}
                  </td>
                  <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{new Date(m.created_at).toLocaleTimeString()}</td>
                </tr>
              );
            }}
          />
          <Pager offset={offset} limit={limit} total={data.total} onChange={setOffset} />
        </>
      )}
    </div>
  );
}

// ─── Tab: Health ──────────────────────────────────────────────────────────────

function HealthTab({ token }: { token: string }) {
  const { toast } = useToast();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [confirm, setConfirm] = useState<{ msg: string; action: () => void } | null>(null);

  const load = useCallback(() => {
    adminFetch("/health", token).then((r) => r.json()).then(setData);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <p className="text-zinc-500 text-sm">Loading…</p>;

  type CircuitRow = { provider: string; consecutive_failures: number; opened_at: string | null; updated_at: string };
  const circuits = data.circuits as CircuitRow[];
  const env = data.envChecks as Record<string, boolean>;
  const mem = data.memory as { rss: number; heapUsed: number; heapTotal: number };
  const uptimeSecs = data.uptime as number;
  const uptimeH = Math.floor(uptimeSecs / 3600);
  const uptimeM = Math.floor((uptimeSecs % 3600) / 60);

  return (
    <>
      {confirm && (
        <ConfirmModal message={confirm.msg} onConfirm={confirm.action} onCancel={() => setConfirm(null)} />
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-300">System</CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-1.5">
            <Row label="Uptime" value={`${uptimeH}h ${uptimeM}m`} />
            <Row label="Node" value={data.nodeVersion as string} />
            <Row label="Environment" value={data.env as string} />
            <Row label="DB latency" value={`${data.dbLatencyMs}ms`} color={(data.dbLatencyMs as number) > 100 ? "yellow" : "green"} />
            <Row label="Heap used" value={`${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB`} />
            <Row label="RSS" value={`${Math.round(mem.rss / 1024 / 1024)}MB`} />
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-300">Environment variables</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {Object.entries(env).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-xs">
                <span className="font-mono text-zinc-400">{k}</span>
                <span className={v ? "text-green-400" : "text-red-400"}>{v ? "✓ set" : "✗ missing"}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/60 col-span-full">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-zinc-300">Circuit breakers</CardTitle>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-zinc-400" onClick={load}>
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {circuits.length === 0 ? (
              <p className="text-xs text-zinc-500">No circuit state recorded yet</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-zinc-500 border-b border-zinc-800">
                    <th className="text-left py-1 pr-4">Provider</th>
                    <th className="text-left py-1 pr-4">Failures</th>
                    <th className="text-left py-1 pr-4">Opened at</th>
                    <th className="text-left py-1 pr-4">Last updated</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {circuits.map((c) => (
                    <tr key={c.provider} className="border-b border-zinc-800/50">
                      <td className="py-1.5 pr-4 font-mono text-zinc-300">{c.provider}</td>
                      <td className="py-1.5 pr-4">
                        <span className={c.consecutive_failures > 0 ? "text-red-400" : "text-zinc-400"}>
                          {c.consecutive_failures}
                        </span>
                      </td>
                      <td className="py-1.5 pr-4 text-zinc-400">
                        {c.opened_at ? <span className="text-red-400">{new Date(c.opened_at).toLocaleString()} ⚠</span> : <span className="text-green-400">closed</span>}
                      </td>
                      <td className="py-1.5 pr-4 text-zinc-500">{new Date(c.updated_at).toLocaleString()}</td>
                      <td className="py-1.5">
                        <button
                          onClick={() => setConfirm({
                            msg: `Reset circuit breaker for ${c.provider}? This clears failure count and re-opens the circuit.`,
                            action: async () => {
                              setConfirm(null);
                              const r = await adminFetch(`/circuit/${c.provider}/reset`, token, {
                                method: "POST",
                                headers: { "X-Admin-Confirm": "true" },
                              });
                              if (r.ok) { toast({ title: "Circuit reset" }); load(); }
                              else toast({ title: "Error", variant: "destructive" });
                            },
                          })}
                          className="text-[10px] px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-700/30"
                        >
                          Reset
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: "green" | "yellow" | "red" }) {
  const c = color === "green" ? "text-green-400" : color === "yellow" ? "text-yellow-400" : color === "red" ? "text-red-400" : "text-zinc-200";
  return (
    <div className="flex justify-between text-xs">
      <span className="text-zinc-500">{label}</span>
      <span className={`font-mono ${c}`}>{value}</span>
    </div>
  );
}

// ─── Tab: Logs ────────────────────────────────────────────────────────────────

function LogsTab({ token }: { token: string }) {
  const [data, setData] = useState<{ logs: unknown[]; total: number; eventTypes: string[] } | null>(null);
  const [offset, setOffset] = useState(0);
  const [typeFilter, setTypeFilter] = useState("");
  const limit = 100;

  const load = useCallback(() => {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (typeFilter) q.set("type", typeFilter);
    adminFetch(`/logs?${q}`, token).then((r) => r.json()).then(setData);
  }, [token, offset, typeFilter]);

  useEffect(() => { load(); }, [load]);

  type LogRow = {
    id: number; session_id: number | null; event_type: string;
    description: string; metadata: unknown; created_at: string;
  };

  const typeColor = (t: string) =>
    t.includes("fallback") || t.includes("error") || t.includes("failed") ? "text-red-400" :
    t.includes("open") ? "text-orange-400" :
    t.includes("success") || t.includes("completed") ? "text-green-400" :
    "text-zinc-400";

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <span className="text-xs text-zinc-400">Filter by type:</span>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setOffset(0); }}
          className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
        >
          <option value="">All events</option>
          {data?.eventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <Button variant="ghost" size="sm" className="h-7 text-xs text-zinc-400" onClick={load}>↻</Button>
      </div>
      {!data ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : (
        <>
          <DataTable
            cols={["ID", "Session", "Event", "Description", "Metadata", "Time"]}
            rows={data.logs}
            renderRow={(row) => {
              const l = row as LogRow;
              return (
                <tr key={l.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-3 py-2 text-zinc-500">{l.id}</td>
                  <td className="px-3 py-2 text-zinc-400">{l.session_id ?? "—"}</td>
                  <td className={`px-3 py-2 font-mono ${typeColor(l.event_type)}`}>{l.event_type}</td>
                  <td className="px-3 py-2 text-zinc-300 max-w-[250px] truncate" title={l.description}>{l.description}</td>
                  <td className="px-3 py-2 text-zinc-500 font-mono text-[10px] max-w-[150px] truncate">
                    {l.metadata ? JSON.stringify(l.metadata).slice(0, 80) : "—"}
                  </td>
                  <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                </tr>
              );
            }}
          />
          <Pager offset={offset} limit={limit} total={data.total} onChange={setOffset} />
        </>
      )}
    </div>
  );
}

// ─── Tab: Abuse ───────────────────────────────────────────────────────────────

function AbuseTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    adminFetch("/abuse", token).then((r) => r.json()).then(setData);
  }, [token]);

  if (!data) return <p className="text-zinc-500 text-sm">Loading…</p>;

  type HeavySession = { session_id: number; msg_count: number };
  type SpikeProvider = { provider: string; count: number };
  type DelinquentSub = { id: number; email: string; status: string };

  const spikes = data.spikeProviders as SpikeProvider[];
  const heavy = data.heavySessions as HeavySession[];
  const delinquent = data.delinquentSubscribers as DelinquentSub[];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-300">Spike providers (last 1h)</CardTitle>
        </CardHeader>
        <CardContent>
          {spikes.length === 0 ? (
            <p className="text-xs text-green-400">No spikes detected</p>
          ) : (
            spikes.map((s) => (
              <div key={s.provider} className="flex justify-between text-xs py-1 border-b border-zinc-800">
                <span className="font-mono text-zinc-300">{s.provider}</span>
                <span className="text-red-400 font-bold">{s.count} fallbacks</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-300">Failed payments (30d)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className={`text-2xl font-bold ${(data.failedPayments as number) > 0 ? "text-red-400" : "text-green-400"}`}>
            {data.failedPayments as number}
          </p>
          {delinquent.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-xs text-zinc-500 mb-1">Delinquent subscribers</p>
              {delinquent.map((d) => (
                <div key={d.id} className="flex justify-between text-xs">
                  <span className="text-zinc-300">{d.email}</span>
                  <span className="text-red-400">{d.status}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/60 col-span-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-300">Top sessions by message count</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {heavy.map((h) => (
              <div key={h.session_id} className="flex items-center gap-3 text-xs">
                <span className="text-zinc-500 w-16">#{h.session_id}</span>
                <div className="flex-1 h-2 bg-zinc-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded"
                    style={{ width: `${Math.min(100, (h.msg_count / (heavy[0]?.msg_count || 1)) * 100)}%` }}
                  />
                </div>
                <span className="text-zinc-300 w-12 text-right">{h.msg_count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab: Config ──────────────────────────────────────────────────────────────

function ConfigTab({ token }: { token: string }) {
  const { toast } = useToast();
  const [config, setConfig] = useState<{ key: string; value: string; masked: boolean }[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ msg: string; action: () => void } | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");

  const load = useCallback(() => {
    adminFetch("/config", token).then((r) => r.json()).then((d) => {
      setConfig(d.config ?? []);
      setEdits({});
    });
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const saveAll = () => {
    const updates = { ...edits };
    if (newKey.trim()) updates[newKey.trim()] = newVal;
    if (Object.keys(updates).length === 0) return;
    setConfirm({
      msg: `Update ${Object.keys(updates).length} setting(s)? This overwrites the current values.`,
      action: async () => {
        setConfirm(null);
        const r = await adminFetch("/config", token, {
          method: "PUT",
          body: JSON.stringify(updates),
          headers: { "X-Admin-Confirm": "true" },
        });
        if (r.ok) {
          toast({ title: "Settings saved" });
          setNewKey(""); setNewVal("");
          load();
        } else {
          toast({ title: "Failed to save", variant: "destructive" });
        }
      },
    });
  };

  return (
    <>
      {confirm && (
        <ConfirmModal message={confirm.msg} onConfirm={confirm.action} onCancel={() => setConfirm(null)} />
      )}
      <div className="space-y-2 max-w-2xl">
        {config.map((c) => (
          <div key={c.key} className="flex gap-3 items-center">
            <span className="font-mono text-xs text-zinc-400 w-48 shrink-0">{c.key}</span>
            {c.masked ? (
              <span className="text-xs text-zinc-600 flex-1 italic">masked — enter new value to update</span>
            ) : null}
            <Input
              className="h-7 text-xs bg-zinc-800 border-zinc-700 text-zinc-200 flex-1"
              placeholder={c.masked ? "New value (leave blank to keep)" : c.value}
              value={edits[c.key] ?? (c.masked ? "" : c.value)}
              onChange={(e) => setEdits((prev) => ({ ...prev, [c.key]: e.target.value }))}
            />
          </div>
        ))}

        <div className="border-t border-zinc-800 pt-4 mt-4">
          <p className="text-xs text-zinc-500 mb-2">Add new setting</p>
          <div className="flex gap-2">
            <Input className="h-7 text-xs bg-zinc-800 border-zinc-700 text-zinc-200 w-40" placeholder="KEY" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
            <Input className="h-7 text-xs bg-zinc-800 border-zinc-700 text-zinc-200 flex-1" placeholder="value" value={newVal} onChange={(e) => setNewVal(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={saveAll} className="h-8 text-xs bg-blue-600 hover:bg-blue-700">Save changes</Button>
          <Button variant="outline" onClick={load} className="h-8 text-xs border-zinc-700 text-zinc-400">Discard</Button>
        </div>
      </div>
    </>
  );
}

// ─── Main Admin page ──────────────────────────────────────────────────────────

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "sessions", label: "Sessions" },
  { id: "requests", label: "AI Requests" },
  { id: "health", label: "Health" },
  { id: "logs", label: "Logs" },
  { id: "abuse", label: "Abuse" },
  { id: "config", label: "Config" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function AdminPage() {
  const [token, setToken] = useState<string>(() => sessionStorage.getItem(SESSION_KEY) ?? "");
  const [input, setInput] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [checking, setChecking] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const { toast } = useToast();

  const verifyAndLogin = async () => {
    if (!input.trim()) return;
    setChecking(true);
    setAuthErr("");
    try {
      const r = await adminFetch("/overview", input.trim());
      if (r.ok) {
        sessionStorage.setItem(SESSION_KEY, input.trim());
        setToken(input.trim());
      } else {
        setAuthErr("Invalid admin token");
      }
    } catch {
      setAuthErr("Cannot reach server");
    } finally {
      setChecking(false);
    }
  };

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setToken("");
    setInput("");
  };

  // ── Token gate ──────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <div className="text-2xl font-bold text-white mb-1">VIBA Admin</div>
            <div className="text-sm text-zinc-500">Enter your admin token to continue</div>
          </div>
          <div className="space-y-3">
            <Input
              type="password"
              placeholder="Admin token"
              className="bg-zinc-900 border-zinc-700 text-white h-10"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && verifyAndLogin()}
              autoFocus
            />
            {authErr && <p className="text-red-400 text-xs">{authErr}</p>}
            <Button
              className="w-full h-10 bg-blue-600 hover:bg-blue-700"
              onClick={verifyAndLogin}
              disabled={checking}
            >
              {checking ? "Verifying…" : "Sign in"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Dashboard ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-zinc-900/80 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-white">VIBA Admin</span>
            <Badge className="bg-red-900/40 text-red-400 border-red-800 text-[10px]">
              Protected
            </Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={logout} className="text-xs text-zinc-400 h-7">
            Sign out
          </Button>
        </div>

        {/* Tab nav */}
        <div className="max-w-7xl mx-auto px-4 flex gap-0 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === t.id
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === "overview"  && <OverviewTab  token={token} />}
        {activeTab === "users"     && <UsersTab     token={token} />}
        {activeTab === "sessions"  && <SessionsTab  token={token} />}
        {activeTab === "requests"  && <RequestsTab  token={token} />}
        {activeTab === "health"    && <HealthTab    token={token} />}
        {activeTab === "logs"      && <LogsTab      token={token} />}
        {activeTab === "abuse"     && <AbuseTab     token={token} />}
        {activeTab === "config"    && <ConfigTab    token={token} />}
      </div>
    </div>
  );
}
