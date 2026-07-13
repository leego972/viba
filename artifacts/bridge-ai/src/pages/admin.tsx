import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

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

// ─── Tab: Growth / Advertising ────────────────────────────────────────────────

type GChannel = {
  id: string; name: string; url: string;
  category: string; priority: string; note: string; posted: boolean;
};
type GSub = {
  id: string; channelId: string; channelName: string; contentType: string;
  content: string; status: "draft" | "posted" | "scheduled" | "failed"; note: string; createdAt: string;
  postedUrl?: string; submitError?: string;
};
type GConfigured = { devto: boolean; discord: boolean; reddit: boolean };
type GConfig = {
  devto_api_key: string; discord_webhook_url: string;
  reddit_client_id: string; reddit_client_secret: string;
  reddit_username: string; reddit_password: string;
  configured: GConfigured;
};
type SeoData = {
  domain: string;
  keywords: { primary: string[]; secondary: string[]; longtail: string[]; competitors: string[] };
  checklist: { item: string; done: boolean }[];
  geoActions: string[];
};
type AutopilotRunResult = {
  channelId: string; channelName: string;
  generated: boolean; posted: boolean; manual: boolean;
  url?: string; error?: string;
};
type GAutopilot = {
  enabled: boolean;
  intervalHours: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  running: boolean;
  lastRunResults: AutopilotRunResult[];
  lastRunSummary: { generated: number; posted: number; manual: number; failed: number } | null;
};

const CATEGORY_COLOR: Record<string, string> = {
  launch:     "bg-purple-500/20 text-purple-300 border-purple-700",
  community:  "bg-orange-500/20 text-orange-300 border-orange-700",
  social:     "bg-blue-500/20 text-blue-300 border-blue-700",
  content:    "bg-green-500/20 text-green-300 border-green-700",
  newsletter: "bg-yellow-500/20 text-yellow-300 border-yellow-700",
};
const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high:     "bg-yellow-400",
  medium:   "bg-zinc-500",
};

function GrowthTab({ token }: { token: string }) {
  const { toast } = useToast();

  // sub-sections
  const [section, setSection] = useState<"channels" | "generate" | "submissions" | "seo" | "settings">("channels");

  // channels
  const [channels, setChannels] = useState<GChannel[]>([]);
  const [chStats, setChStats] = useState({ totalPosted: 0, totalChannels: 0 });

  // content generator
  const [selChannel, setSelChannel] = useState("");
  const [generated, setGenerated] = useState("");
  const [genLabel, setGenLabel] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState("");
  const [savingSubmission, setSavingSubmission] = useState(false);

  // submissions
  const [submissions, setSubmissions] = useState<GSub[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [autoSubmitting, setAutoSubmitting] = useState<string | null>(null);

  // seo
  const [seo, setSeo] = useState<SeoData | null>(null);
  const [seoLoading, setSeoLoading] = useState(false);

  // autopilot
  const [autopilot, setAutopilot] = useState<GAutopilot | null>(null);
  const [apInterval, setApInterval] = useState(24);
  const [apToggling, setApToggling] = useState(false);
  const [apRunning, setApRunning] = useState(false);

  const loadAutopilot = useCallback(() => {
    adminFetch("/growth/autopilot", token)
      .then(r => r.json())
      .then((d: GAutopilot) => { setAutopilot(d); if (d.running) setApRunning(true); else setApRunning(false); })
      .catch(() => {});
  }, [token]);

  // Poll while running
  useEffect(() => {
    loadAutopilot();
    const interval = setInterval(() => { if (autopilot?.running || apRunning) loadAutopilot(); }, 5000);
    return () => clearInterval(interval);
  }, [loadAutopilot, autopilot?.running, apRunning]);

  const toggleAutopilot = async (enabled: boolean) => {
    setApToggling(true);
    try {
      const r = await adminFetch("/growth/autopilot", token, { method: "POST", body: JSON.stringify({ enabled, intervalHours: apInterval }) });
      const d = await r.json() as { autopilot: GAutopilot };
      setAutopilot(d.autopilot);
      toast({ title: enabled ? "🤖 Autopilot enabled" : "⏸️ Autopilot paused", description: enabled ? `Will run every ${apInterval}h automatically` : "Autopilot scheduler stopped" });
    } catch (e) { toast({ title: "Error", description: String(e), variant: "destructive" }); }
    finally { setApToggling(false); }
  };

  const runAutopilotNow = async () => {
    setApRunning(true);
    try {
      await adminFetch("/growth/autopilot/run-now", token, { method: "POST", body: "{}" });
      toast({ title: "🚀 Autopilot cycle started", description: "Generating content for all channels — refresh in ~2 minutes to see results" });
      setTimeout(loadAutopilot, 3000);
    } catch (e) { toast({ title: "Error", description: String(e), variant: "destructive" }); setApRunning(false); }
  };

  // publish settings
  const emptyConfig: GConfig = { devto_api_key: "", discord_webhook_url: "", reddit_client_id: "", reddit_client_secret: "", reddit_username: "", reddit_password: "", configured: { devto: false, discord: false, reddit: false } };
  const [channelConfig, setChannelConfig] = useState<GConfig>(emptyConfig);
  const [configForm, setConfigForm] = useState<Omit<GConfig, "configured">>({ devto_api_key: "", discord_webhook_url: "", reddit_client_id: "", reddit_client_secret: "", reddit_username: "", reddit_password: "" });
  const [configSaving, setConfigSaving] = useState(false);
  const [configMsg, setConfigMsg] = useState("");

  const loadChannels = useCallback(() => {
    adminFetch("/growth/channels", token)
      .then(r => r.json())
      .then(d => {
        setChannels(d.channels ?? []);
        setChStats({ totalPosted: d.totalPosted ?? 0, totalChannels: d.totalChannels ?? 0 });
      })
      .catch(() => {});
  }, [token]);

  const loadSubmissions = useCallback(() => {
    setSubsLoading(true);
    adminFetch("/growth/submissions", token)
      .then(r => r.json())
      .then(d => setSubmissions(d.submissions ?? []))
      .finally(() => setSubsLoading(false));
  }, [token]);

  const loadSeo = useCallback(() => {
    setSeoLoading(true);
    adminFetch("/growth/seo", token)
      .then(r => r.json())
      .then(setSeo)
      .finally(() => setSeoLoading(false));
  }, [token]);

  const loadChannelConfig = useCallback(() => {
    adminFetch("/growth/channel-config", token)
      .then(r => r.json())
      .then((d: GConfig) => setChannelConfig(d))
      .catch(() => {});
  }, [token]);

  useEffect(() => { loadChannels(); loadChannelConfig(); }, [loadChannels, loadChannelConfig]);
  useEffect(() => { if (section === "submissions") loadSubmissions(); }, [section, loadSubmissions]);
  useEffect(() => { if (section === "seo") loadSeo(); }, [section, loadSeo]);
  useEffect(() => { if (section === "settings") loadChannelConfig(); }, [section, loadChannelConfig]);

  // Auto-submit a saved draft
  const autoSubmit = async (id: string) => {
    setAutoSubmitting(id);
    try {
      const r = await adminFetch(`/growth/auto-submit/${id}`, token, { method: "POST", body: "{}" });
      const d = await r.json() as { ok: boolean; posted?: boolean; manual?: boolean; url?: string; channelName?: string; reason?: string; instructions?: string; credential?: string; manualUrl?: string };
      if (d.ok) {
        toast({ title: `✅ Posted to ${d.channelName ?? "channel"}`, description: d.url ? `Live at ${d.url}` : undefined });
        loadSubmissions();
      } else if (d.manual) {
        toast({
          title: `⚙️ Manual action needed — ${d.channelName ?? "channel"}`,
          description: d.instructions ?? (d.credential ? `Add ${d.credential} in Publish Settings` : "Open the channel URL and paste content"),
        });
        if (d.credential) setSection("settings");
      } else {
        toast({ title: "Submission failed", description: String((d as {reason?:string}).reason ?? "Unknown error"), variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Auto-submit error", description: String(e), variant: "destructive" });
    } finally {
      setAutoSubmitting(null);
    }
  };

  // Save publish settings
  const saveConfig = async () => {
    setConfigSaving(true); setConfigMsg("");
    try {
      const r = await adminFetch("/growth/channel-config", token, { method: "POST", body: JSON.stringify(configForm) });
      const d = await r.json() as { ok: boolean; saved: number; configured: GConfigured };
      setChannelConfig(prev => ({ ...prev, configured: d.configured }));
      setConfigMsg(`✅ Saved ${d.saved} credential${d.saved !== 1 ? "s" : ""}. Auto-submit is now active for configured channels.`);
      setConfigForm({ devto_api_key: "", discord_webhook_url: "", reddit_client_id: "", reddit_client_secret: "", reddit_username: "", reddit_password: "" });
      loadChannelConfig();
    } catch (e) {
      setConfigMsg(`Error: ${String(e)}`);
    } finally {
      setConfigSaving(false);
    }
  };

  // Generate content
  const generate = async () => {
    if (!selChannel) { setGenErr("Pick a channel first"); return; }
    setGenerating(true); setGenerated(""); setGenErr("");
    try {
      const r = await adminFetch("/growth/generate", token, {
        method: "POST",
        body: JSON.stringify({ channelId: selChannel }),
      });
      const d = await r.json();
      if (!r.ok) { setGenErr(d.error ?? "Generation failed"); return; }
      setGenerated(d.content ?? "");
      setGenLabel(d.label ?? selChannel);
    } catch (e) {
      setGenErr(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const copyContent = () => {
    if (!generated) return;
    navigator.clipboard.writeText(generated)
      .then(() => toast({ title: "Copied!", description: "Content copied to clipboard" }))
      .catch(() => toast({ title: "Error", description: "Clipboard unavailable", variant: "destructive" }));
  };

  const logAsPosted = async (status: "draft" | "posted" | "scheduled") => {
    if (!generated || !selChannel) return;
    setSavingSubmission(true);
    try {
      const ch = channels.find(c => c.id === selChannel);
      await adminFetch("/growth/submissions", token, {
        method: "POST",
        body: JSON.stringify({
          channelId: selChannel,
          channelName: ch?.name ?? selChannel,
          contentType: "post",
          content: generated,
          status,
          note: "",
        }),
      });
      toast({ title: status === "posted" ? "Marked as posted!" : "Saved to drafts", description: ch?.name });
      loadChannels();
    } catch {
      toast({ title: "Error", description: "Could not save submission", variant: "destructive" });
    } finally {
      setSavingSubmission(false);
    }
  };

  const updateSubStatus = async (id: string, status: string) => {
    await adminFetch(`/growth/submissions/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    loadSubmissions(); loadChannels();
  };

  const deleteSub = async (id: string) => {
    await adminFetch(`/growth/submissions/${id}`, token, { method: "DELETE" });
    loadSubmissions();
  };

  const sectionBtn = (id: typeof section, label: string) => (
    <button
      onClick={() => setSection(id)}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        section === id ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );

  // ── One-click blast ───────────────────────────────────────────────────────
  const [blasting, setBlasting] = useState(false);
  const [blastResult, setBlastResult] = useState<{
    succeeded: number; failed: number; total: number;
    results: { channelId: string; channelName: string; ok: boolean; error?: string }[];
  } | null>(null);
  const [blastErr, setBlastErr] = useState("");

  const runBlast = async () => {
    if (blasting) return;
    setBlasting(true); setBlastResult(null); setBlastErr("");
    try {
      const r = await adminFetch("/growth/blast", token, { method: "POST", body: "{}" });
      const d = await r.json();
      if (!r.ok) { setBlastErr(d.error ?? "Blast failed"); return; }
      setBlastResult(d);
      loadChannels(); loadSubmissions();
      toast({ title: `✅ Blast complete — ${d.succeeded}/${d.total} channels generated`, description: "All drafts saved to Submission Log" });
    } catch (e) {
      setBlastErr(String(e));
    } finally {
      setBlasting(false);
    }
  };

  // ── Stats bar ──────────────────────────────────────────────────────────────
  const postedCount = chStats.totalPosted;
  const pendingCount = chStats.totalChannels - postedCount;

  return (
    <div className="space-y-5">

      {/* ── ONE-CLICK BLAST ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-blue-700/50 bg-gradient-to-r from-blue-950/60 to-indigo-950/60 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <h3 className="text-sm font-bold text-blue-200 flex items-center gap-2">
              🚀 One-Click Content Blast
            </h3>
            <p className="text-xs text-blue-400/80 mt-1">
              Generates AI-optimised content for <strong className="text-blue-300">every VIBA channel</strong> in one shot — Reddit, LinkedIn, Twitter, Product Hunt, Hacker News, Dev.to, newsletters, and more. All saved as drafts instantly.
            </p>
            {blastResult && (
              <div className="mt-2 flex gap-3 text-xs">
                <span className="text-green-400 font-semibold">✓ {blastResult.succeeded} generated</span>
                {blastResult.failed > 0 && <span className="text-red-400">{blastResult.failed} failed</span>}
                <button className="text-blue-400 underline hover:text-blue-300" onClick={() => setSection("submissions")}>
                  View in Submission Log →
                </button>
              </div>
            )}
            {blastErr && <p className="mt-2 text-xs text-red-400">{blastErr}</p>}
          </div>
          <div className="flex-shrink-0">
            <Button
              onClick={runBlast}
              disabled={blasting}
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 h-10 text-sm shadow-lg shadow-blue-900/40"
            >
              {blasting ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full" />
                  Generating all channels…
                </span>
              ) : (
                "🚀 Generate All + SEO + Advertise"
              )}
            </Button>
          </div>
        </div>
        {blasting && (
          <div className="mt-3 rounded-md bg-blue-900/30 px-3 py-2 text-xs text-blue-300">
            Generating content for all channels via Groq AI — this takes 60–120 seconds. Do not close this page.
          </div>
        )}
        {blastResult && blastResult.results.length > 0 && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {blastResult.results.map(r => (
              <div key={r.channelId} className={`text-[10px] px-2 py-1 rounded flex items-center gap-1 ${r.ok ? "bg-green-900/30 text-green-400" : "bg-red-900/20 text-red-400"}`}>
                <span>{r.ok ? "✓" : "✗"}</span>
                <span className="truncate">{r.channelName}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── AUTOPILOT PANEL ─────────────────────────────────────────────── */}
      <div className={`rounded-xl border p-5 transition-colors ${autopilot?.enabled ? "border-emerald-700/60 bg-gradient-to-r from-emerald-950/50 to-teal-950/40" : "border-zinc-700/60 bg-zinc-900/50"}`}>
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          {/* Left: title + status */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-bold text-zinc-100">🤖 SEO Autopilot</span>
              {autopilot?.enabled && !apRunning && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-900/60 text-emerald-400 border border-emerald-700">ACTIVE</span>
              )}
              {apRunning && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-yellow-900/60 text-yellow-400 border border-yellow-700 flex items-center gap-1">
                  <span className="animate-spin inline-block w-2.5 h-2.5 border border-yellow-400/30 border-t-yellow-400 rounded-full" />
                  RUNNING
                </span>
              )}
              {!autopilot?.enabled && !apRunning && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-500 border border-zinc-700">PAUSED</span>
              )}
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Automatically generates AI content for every channel and submits to configured channels (Dev.to, Discord, Reddit) on a schedule. Manual channels get ready-to-paste drafts.
            </p>

            {/* Last / next run */}
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-500">
              {autopilot?.lastRunAt && (
                <span>
                  <span className="text-zinc-400">Last run:</span>{" "}
                  {new Date(autopilot.lastRunAt).toLocaleString()}
                  {autopilot.lastRunSummary && (
                    <span className="ml-2">
                      <span className="text-green-400">{autopilot.lastRunSummary.posted} posted</span>
                      {" · "}
                      <span className="text-blue-400">{autopilot.lastRunSummary.manual} manual</span>
                      {autopilot.lastRunSummary.failed > 0 && (
                        <>{" · "}<span className="text-red-400">{autopilot.lastRunSummary.failed} failed</span></>
                      )}
                    </span>
                  )}
                </span>
              )}
              {autopilot?.nextRunAt && autopilot.enabled && (
                <span>
                  <span className="text-zinc-400">Next run:</span>{" "}
                  {new Date(autopilot.nextRunAt).toLocaleString()}
                </span>
              )}
              {!autopilot?.lastRunAt && <span className="text-zinc-600 italic">Never run yet</span>}
            </div>

            {/* Last run per-channel grid */}
            {autopilot?.lastRunResults && autopilot.lastRunResults.length > 0 && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-1">
                {autopilot.lastRunResults.map(r => (
                  <div key={r.channelId} className={`text-[10px] px-2 py-1 rounded flex items-center gap-1 truncate ${
                    r.posted ? "bg-green-900/30 text-green-400"
                    : r.manual ? "bg-blue-900/20 text-blue-400"
                    : r.error ? "bg-red-900/20 text-red-400"
                    : "bg-zinc-800/60 text-zinc-500"
                  }`}>
                    <span>{r.posted ? "✓" : r.manual ? "↗" : r.error ? "✗" : "·"}</span>
                    <span className="truncate">{r.channelName}</span>
                    {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="shrink-0 underline">↗</a>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: controls */}
          <div className="flex flex-col gap-2 shrink-0 min-w-[200px]">
            {/* Interval selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 shrink-0">Every</span>
              <select
                value={apInterval}
                onChange={e => setApInterval(Number(e.target.value))}
                className="flex-1 rounded border border-zinc-700 bg-zinc-950 text-zinc-200 text-xs px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value={24}>24 hours</option>
                <option value={48}>48 hours</option>
                <option value={72}>72 hours</option>
                <option value={168}>7 days</option>
              </select>
            </div>

            {/* Enable / Disable toggle */}
            <div className="flex gap-2">
              {autopilot?.enabled ? (
                <Button
                  onClick={() => toggleAutopilot(false)}
                  disabled={apToggling}
                  variant="outline"
                  className="flex-1 h-8 text-xs border-zinc-600 text-zinc-300 hover:bg-zinc-800"
                >
                  {apToggling ? "…" : "⏸ Pause"}
                </Button>
              ) : (
                <Button
                  onClick={() => toggleAutopilot(true)}
                  disabled={apToggling}
                  className="flex-1 h-8 text-xs bg-emerald-700 hover:bg-emerald-600 text-white"
                >
                  {apToggling ? "…" : "▶ Enable"}
                </Button>
              )}
              <Button
                onClick={runAutopilotNow}
                disabled={apRunning}
                variant="outline"
                className="flex-1 h-8 text-xs border-zinc-600 text-zinc-300 hover:bg-zinc-800"
                title="Run one cycle right now"
              >
                {apRunning ? (
                  <span className="flex items-center gap-1">
                    <span className="animate-spin inline-block w-2.5 h-2.5 border border-zinc-400/30 border-t-zinc-300 rounded-full" />
                    Running…
                  </span>
                ) : "⚡ Run Now"}
              </Button>
            </div>

            {/* Refresh status while running */}
            {apRunning && (
              <Button size="sm" variant="ghost" onClick={loadAutopilot} className="h-7 text-[10px] text-zinc-500">
                ↻ Refresh status
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Channels covered</p>
            <p className="text-2xl font-bold text-green-400">{postedCount}</p>
            <p className="text-xs text-zinc-500 mt-1">of {chStats.totalChannels} free channels</p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Still to post</p>
            <p className="text-2xl font-bold text-yellow-400">{pendingCount}</p>
            <p className="text-xs text-zinc-500 mt-1">channels pending</p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Content saved</p>
            <p className="text-2xl font-bold text-blue-400">{submissions.length}</p>
            <p className="text-xs text-zinc-500 mt-1">drafts / posted</p>
          </CardContent>
        </Card>
      </div>

      {/* Section nav */}
      <div className="flex gap-2 flex-wrap">
        {sectionBtn("channels",    "📡 Channels")}
        {sectionBtn("generate",    "✨ Generate Content")}
        {sectionBtn("submissions", "📋 Submission Log")}
        {sectionBtn("seo",         "🔍 SEO & Keywords")}
        <button
          onClick={() => setSection("settings")}
          className={`text-xs px-3 py-1.5 rounded-md border transition-colors relative ${section === "settings" ? "bg-violet-900/60 border-violet-600 text-violet-200" : "border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"}`}
        >
          ⚙️ Publish Settings
          {(!channelConfig.configured.devto && !channelConfig.configured.discord && !channelConfig.configured.reddit) && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-yellow-400" title="No auto-submit credentials configured" />
          )}
        </button>
      </div>

      {/* ── CHANNELS ──────────────────────────────────────────────────── */}
      {section === "channels" && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">
            All free advertising channels for VIBA. Aim for <strong className="text-zinc-300">critical</strong> ones first, then work through high/medium.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {channels.map(ch => (
              <div
                key={ch.id}
                className={`rounded-lg border p-3 flex gap-3 ${
                  ch.posted ? "border-green-800 bg-green-950/20" : "border-zinc-800 bg-zinc-900/40"
                }`}
              >
                <div className="mt-0.5 flex-shrink-0">
                  <span className={`inline-block w-2 h-2 rounded-full mt-1 ${PRIORITY_DOT[ch.priority] ?? "bg-zinc-500"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-zinc-200">{ch.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${CATEGORY_COLOR[ch.category] ?? ""}`}>
                      {ch.category}
                    </span>
                    {ch.posted && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-green-500/20 text-green-400 border-green-700 font-medium">
                        ✓ posted
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">{ch.note}</p>
                  <div className="flex gap-2 mt-2">
                    <a
                      href={ch.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-blue-400 hover:text-blue-300 underline"
                    >
                      Open →
                    </a>
                    <button
                      className="text-[11px] text-zinc-400 hover:text-zinc-200 underline"
                      onClick={() => { setSelChannel(ch.id); setSection("generate"); }}
                    >
                      Generate content
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── GENERATE CONTENT ──────────────────────────────────────────── */}
      {section === "generate" && (
        <div className="space-y-4">
          <p className="text-xs text-zinc-500">
            AI-powered content generation for each free channel, tuned specifically for VIBA. Uses Groq (free, fast).
          </p>

          {/* Channel picker */}
          <div className="space-y-2">
            <label className="text-xs text-zinc-400 font-medium">Select channel</label>
            <select
              value={selChannel}
              onChange={e => { setSelChannel(e.target.value); setGenerated(""); setGenErr(""); }}
              className="w-full sm:w-80 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">— pick a channel —</option>
              {channels.map(ch => (
                <option key={ch.id} value={ch.id}>
                  {ch.name}{ch.posted ? " ✓" : ""}
                </option>
              ))}
            </select>
          </div>

          {selChannel && (
            <div className="rounded-md border border-zinc-700 bg-zinc-900/60 p-3 text-xs text-zinc-400">
              {channels.find(c => c.id === selChannel)?.note}
            </div>
          )}

          <Button
            onClick={generate}
            disabled={generating || !selChannel}
            className="bg-blue-600 hover:bg-blue-700 text-white h-9"
            size="sm"
          >
            {generating ? "Generating…" : "✨ Generate with AI"}
          </Button>

          {genErr && <p className="text-red-400 text-xs">{genErr}</p>}

          {generated && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-zinc-300">{genLabel}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs border-zinc-700" onClick={copyContent}>
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-zinc-700"
                    onClick={() => logAsPosted("draft")}
                    disabled={savingSubmission}
                  >
                    Save draft
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs bg-green-700 hover:bg-green-600 text-white"
                    onClick={() => logAsPosted("posted")}
                    disabled={savingSubmission}
                  >
                    Mark posted ✓
                  </Button>
                </div>
              </div>
              <Textarea
                className="min-h-[320px] font-mono text-xs bg-zinc-950 border-zinc-700 text-zinc-200 resize-y"
                value={generated}
                onChange={e => setGenerated(e.target.value)}
              />
              <p className="text-[11px] text-zinc-600">
                You can edit the content above before copying. Changes are local only until you save/mark posted.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── SUBMISSION LOG ────────────────────────────────────────────── */}
      {section === "submissions" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">Content saved or marked as posted. Cleared on server restart.</p>
            <Button size="sm" variant="outline" className="h-7 text-xs border-zinc-700" onClick={loadSubmissions}>
              Refresh
            </Button>
          </div>
          {subsLoading ? (
            <p className="text-zinc-500 text-sm">Loading…</p>
          ) : submissions.length === 0 ? (
            <p className="text-zinc-600 text-sm">No submissions yet — generate content and save it.</p>
          ) : (
            <div className="space-y-2">
              {submissions.map(s => (
                <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-semibold text-zinc-200">{s.channelName}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                          s.status === "posted"
                            ? "bg-green-500/20 text-green-400 border-green-700"
                            : s.status === "scheduled"
                            ? "bg-blue-500/20 text-blue-400 border-blue-700"
                            : "bg-zinc-500/20 text-zinc-400 border-zinc-700"
                        }`}>
                          {s.status}
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          {new Date(s.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500 line-clamp-2 font-mono leading-relaxed">
                        {s.content.slice(0, 180)}…
                      </p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      {s.status === "draft" && (
                        <button
                          className="text-[11px] text-violet-400 hover:text-violet-300 underline disabled:opacity-40"
                          disabled={autoSubmitting === s.id}
                          onClick={() => autoSubmit(s.id)}
                        >
                          {autoSubmitting === s.id ? "Submitting…" : "⚡ Auto-Submit"}
                        </button>
                      )}
                      {s.status === "posted" && s.postedUrl && (
                        <a href={s.postedUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-400 hover:text-blue-300 underline">
                          View post →
                        </a>
                      )}
                      {s.status !== "posted" && (
                        <button
                          className="text-[11px] text-green-400 hover:text-green-300 underline"
                          onClick={() => updateSubStatus(s.id, "posted")}
                        >
                          Mark posted
                        </button>
                      )}
                      {s.status !== "draft" && (
                        <button
                          className="text-[11px] text-zinc-400 hover:text-zinc-200 underline"
                          onClick={() => updateSubStatus(s.id, "draft")}
                        >
                          Revert draft
                        </button>
                      )}
                      <button
                        className="text-[11px] text-red-400 hover:text-red-300 underline"
                        onClick={() => deleteSub(s.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SEO & KEYWORDS ────────────────────────────────────────────── */}
      {section === "seo" && (
        <div className="space-y-5">
          {seoLoading || !seo ? (
            <p className="text-zinc-500 text-sm">Loading…</p>
          ) : (
            <>
              {/* Keywords */}
              <Card className="border-zinc-800 bg-zinc-900/60">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm text-zinc-200">Target Keywords</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Primary</p>
                    <div className="flex flex-wrap gap-1.5">
                      {seo.keywords.primary.map(k => (
                        <span key={k} className="text-[11px] px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-800">{k}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Secondary</p>
                    <div className="flex flex-wrap gap-1.5">
                      {seo.keywords.secondary.map(k => (
                        <span key={k} className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">{k}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Long-tail</p>
                    <div className="flex flex-wrap gap-1.5">
                      {seo.keywords.longtail.map(k => (
                        <span key={k} className="text-[11px] px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">{k}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Competitor targets</p>
                    <div className="flex flex-wrap gap-1.5">
                      {seo.keywords.competitors.map(k => (
                        <span key={k} className="text-[11px] px-2 py-0.5 rounded bg-red-900/30 text-red-300 border border-red-900">{k}</span>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* SEO checklist */}
              <Card className="border-zinc-800 bg-zinc-900/60">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm text-zinc-200">SEO Checklist</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="space-y-1.5">
                    {seo.checklist.map((item, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className={item.done ? "text-green-400" : "text-zinc-600"}>
                          {item.done ? "✓" : "○"}
                        </span>
                        <span className={item.done ? "text-zinc-300" : "text-zinc-500"}>{item.item}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* GEO / AI search */}
              <Card className="border-zinc-800 bg-zinc-900/60">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm text-zinc-200">GEO — AI Search Optimisation</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-xs text-zinc-500 mb-3">
                    Get VIBA cited by ChatGPT Browse, Perplexity, Gemini, and Claude when users ask about multi-agent AI tools.
                  </p>
                  <div className="space-y-2">
                    {seo.geoActions.map((a, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className="text-blue-400 mt-0.5 flex-shrink-0">→</span>
                        <span className="text-zinc-400">{a}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ── PUBLISH SETTINGS ──────────────────────────────────────────── */}
      {section === "settings" && (
        <div className="space-y-5">
          <div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Enter credentials for channels that support auto-posting. Saved values are active immediately and persist until the server restarts.
              For permanent storage, also set them as environment variables on your hosting provider.
            </p>
          </div>

          {/* Status summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Dev.to", key: "devto" as const, color: "blue", hint: "API key" },
              { label: "Discord", key: "discord" as const, color: "indigo", hint: "Webhook URL" },
              { label: "Reddit", key: "reddit" as const, color: "orange", hint: "4 credentials" },
            ].map(({ label, key, color, hint }) => (
              <div key={key} className={`rounded-lg border p-3 ${channelConfig.configured[key] ? "border-green-700 bg-green-950/20" : "border-zinc-700 bg-zinc-900/40"}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${channelConfig.configured[key] ? "bg-green-400" : "bg-zinc-600"}`} />
                  <span className="text-xs font-semibold text-zinc-200">{label}</span>
                </div>
                <p className="text-[10px] text-zinc-500 mt-1">{channelConfig.configured[key] ? "✓ Configured — auto-posting active" : `Not configured (needs ${hint})`}</p>
              </div>
            ))}
          </div>

          {/* Dev.to */}
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-zinc-100">Dev.to</h4>
              {channelConfig.configured.devto && <span className="text-[10px] px-2 py-0.5 rounded bg-green-900/40 text-green-400 border border-green-700">✓ configured</span>}
            </div>
            <p className="text-[11px] text-zinc-500">
              Get your API key at{" "}
              <a href="https://dev.to/settings/extensions" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">dev.to/settings/extensions</a>
              {" "}→ "DEV Community API Keys" → Generate API key.
            </p>
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">API Key</label>
              <input
                type="password"
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-200 text-xs px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-zinc-600"
                placeholder={channelConfig.configured.devto ? "••••••••  (already set — enter new value to update)" : "Paste your Dev.to API key…"}
                value={configForm.devto_api_key}
                onChange={e => setConfigForm(f => ({ ...f, devto_api_key: e.target.value }))}
                autoComplete="off"
              />
            </div>
          </div>

          {/* Discord */}
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-zinc-100">Discord</h4>
              {channelConfig.configured.discord && <span className="text-[10px] px-2 py-0.5 rounded bg-green-900/40 text-green-400 border border-green-700">✓ configured</span>}
            </div>
            <p className="text-[11px] text-zinc-500">
              In your Discord server: Settings → Integrations → Webhooks → New Webhook → Copy URL.
              Posts to any channel you choose.
            </p>
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Webhook URL</label>
              <input
                type="password"
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-200 text-xs px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-zinc-600"
                placeholder={channelConfig.configured.discord ? "••••••••  (already set — enter new value to update)" : "https://discord.com/api/webhooks/…"}
                value={configForm.discord_webhook_url}
                onChange={e => setConfigForm(f => ({ ...f, discord_webhook_url: e.target.value }))}
                autoComplete="off"
              />
            </div>
          </div>

          {/* Reddit */}
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-zinc-100">Reddit</h4>
              {channelConfig.configured.reddit && <span className="text-[10px] px-2 py-0.5 rounded bg-green-900/40 text-green-400 border border-green-700">✓ configured</span>}
            </div>
            <p className="text-[11px] text-zinc-500">
              Create a "script" type app at{" "}
              <a href="https://www.reddit.com/prefs/apps" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">reddit.com/prefs/apps</a>.
              Posts to r/MachineLearning, r/artificial, r/SideProject, r/LocalLLaMA.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400">Client ID</label>
                <input type="password" className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-200 text-xs px-3 py-2 focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder:text-zinc-600"
                  placeholder={channelConfig.configured.reddit ? "••••••••" : "App client ID"}
                  value={configForm.reddit_client_id} onChange={e => setConfigForm(f => ({ ...f, reddit_client_id: e.target.value }))} autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400">Client Secret</label>
                <input type="password" className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-200 text-xs px-3 py-2 focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder:text-zinc-600"
                  placeholder={channelConfig.configured.reddit ? "••••••••" : "App client secret"}
                  value={configForm.reddit_client_secret} onChange={e => setConfigForm(f => ({ ...f, reddit_client_secret: e.target.value }))} autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400">Reddit Username</label>
                <input type="text" className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-200 text-xs px-3 py-2 focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder:text-zinc-600"
                  placeholder="Your Reddit account username"
                  value={configForm.reddit_username} onChange={e => setConfigForm(f => ({ ...f, reddit_username: e.target.value }))} autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400">Reddit Password</label>
                <input type="password" className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-200 text-xs px-3 py-2 focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder:text-zinc-600"
                  placeholder={channelConfig.configured.reddit ? "••••••••" : "Your Reddit account password"}
                  value={configForm.reddit_password} onChange={e => setConfigForm(f => ({ ...f, reddit_password: e.target.value }))} autoComplete="off" />
              </div>
            </div>
          </div>

          {/* Manual channels notice */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              <span className="text-zinc-400 font-medium">Manual channels</span> (Product Hunt, Hacker News, Twitter/X, LinkedIn, Medium, newsletters, directories)
              require you to log in on their site. When you click <strong className="text-zinc-300">⚡ Auto-Submit</strong> on those drafts,
              the system will open the submission page and show you the generated content to paste.
            </p>
          </div>

          {/* Save button */}
          <div className="flex items-center gap-4">
            <Button onClick={saveConfig} disabled={configSaving} className="bg-violet-700 hover:bg-violet-600 text-white h-9 px-5 text-sm">
              {configSaving ? "Saving…" : "💾 Save Credentials"}
            </Button>
            {configMsg && (
              <p className={`text-xs ${configMsg.startsWith("✅") ? "text-green-400" : "text-red-400"}`}>
                {configMsg}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
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
  { id: "growth", label: "🚀 Growth" },
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
        window.dispatchEvent(new Event("storage"));
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
    window.dispatchEvent(new Event("storage"));
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
        {activeTab === "growth"    && <GrowthTab    token={token} />}
      </div>
    </div>
  );
}
