import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, DollarSign, AlertTriangle, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Budget {
  monthly_budget_usd: number | null;
  warn_threshold_usd: number | null;
  hard_limit_usd: number | null;
  premium_approval_threshold_usd: number;
  require_approval_above_usd: number;
  auto_economy_at_percent: number;
  block_premium_at_limit: boolean;
  allow_multi_model: boolean;
  quality_mode: string;
  use_existing_first: boolean;
}

interface Subscription {
  id: number;
  provider: string;
  display_name: string;
  monthly_cost_usd: number;
  included_usage_description: string | null;
  renewal_day: number | null;
  prioritise: boolean;
  active: boolean;
}

const COMMON_PROVIDERS = [
  { value: "chatgpt", label: "ChatGPT (OpenAI)" },
  { value: "claude", label: "Claude (Anthropic)" },
  { value: "gemini", label: "Gemini (Google)" },
  { value: "cursor", label: "Cursor" },
  { value: "replit", label: "Replit" },
  { value: "groq", label: "Groq" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "perplexity", label: "Perplexity" },
  { value: "other", label: "Other" },
];

export default function BudgetsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: budgetData } = useQuery<{ budget: Budget | null }>({
    queryKey: ["/api/ai/budgets"],
    queryFn: () => fetch("/api/ai/budgets", { credentials: "include" }).then(r => r.json()),
  });

  const { data: subsData } = useQuery<{ subscriptions: Subscription[] }>({
    queryKey: ["/api/ai/subscriptions"],
    queryFn: () => fetch("/api/ai/subscriptions", { credentials: "include" }).then(r => r.json()),
  });

  const [form, setForm] = useState<Partial<Budget>>({
    monthly_budget_usd: null, warn_threshold_usd: null, hard_limit_usd: null,
    premium_approval_threshold_usd: 0.25, require_approval_above_usd: 1.0,
    auto_economy_at_percent: 80, block_premium_at_limit: true,
    allow_multi_model: false, quality_mode: "balanced", use_existing_first: true,
  });

  const [newSub, setNewSub] = useState({ provider: "", displayName: "", monthlyCostUsd: 0, includedUsageDescription: "", prioritise: false });

  useEffect(() => {
    if (budgetData?.budget) setForm(budgetData.budget);
  }, [budgetData]);

  const saveBudget = useMutation({
    mutationFn: () => fetch("/api/ai/budgets", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        monthlyBudgetUsd: form.monthly_budget_usd,
        warnThresholdUsd: form.warn_threshold_usd,
        hardLimitUsd: form.hard_limit_usd,
        premiumApprovalThresholdUsd: form.premium_approval_threshold_usd,
        requireApprovalAboveUsd: form.require_approval_above_usd,
        autoEconomyAtPercent: form.auto_economy_at_percent,
        blockPremiumAtLimit: form.block_premium_at_limit,
        allowMultiModel: form.allow_multi_model,
        qualityMode: form.quality_mode,
        useExistingFirst: form.use_existing_first,
      }),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/ai/budgets"] }); toast({ title: "Budget saved" }); },
    onError: () => toast({ title: "Failed to save budget", variant: "destructive" }),
  });

  const addSub = useMutation({
    mutationFn: () => fetch("/api/ai/subscriptions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(newSub),
    }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai/subscriptions"] });
      setNewSub({ provider: "", displayName: "", monthlyCostUsd: 0, includedUsageDescription: "", prioritise: false });
      toast({ title: "Subscription added" });
    },
    onError: () => toast({ title: "Failed to add subscription", variant: "destructive" }),
  });

  const deleteSub = useMutation({
    mutationFn: (id: number) => fetch(`/api/ai/subscriptions/${id}`, { method: "DELETE", credentials: "include" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/ai/subscriptions"] }); toast({ title: "Subscription removed" }); },
  });

  const subs = subsData?.subscriptions ?? [];
  const totalMonthlyAiCost = subs.reduce((acc, s) => acc + s.monthly_cost_usd, 0);

  return (
    <AppLayout>
      <div className="container max-w-4xl py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Budgets & Subscriptions</h1>
          <p className="text-muted-foreground mt-1">Set spending limits and track your existing AI subscriptions.</p>
        </div>

        {/* Budget controls */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" /> Budget Controls
            </CardTitle>
            <CardDescription>VIBA enforces these limits on all AI task routing.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { label: "Monthly budget (USD)", field: "monthly_budget_usd", placeholder: "e.g. 50" },
                { label: "Warn threshold (USD)", field: "warn_threshold_usd", placeholder: "e.g. 40" },
                { label: "Hard limit (USD)", field: "hard_limit_usd", placeholder: "e.g. 50" },
              ].map(({ label, field, placeholder }) => (
                <div key={field}>
                  <Label className="text-xs mb-1.5 block">{label}</Label>
                  <Input
                    type="number" min={0} step={0.01} placeholder={placeholder}
                    value={form[field as keyof Budget] as number ?? ""}
                    onChange={e => setForm(f => ({ ...f, [field]: e.target.value ? Number(e.target.value) : null }))}
                    className="h-9 text-sm"
                  />
                </div>
              ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { label: "Warn before tasks above ($)", field: "premium_approval_threshold_usd" },
                { label: "Require approval above ($)", field: "require_approval_above_usd" },
                { label: "Switch to Economy at (% of budget)", field: "auto_economy_at_percent" },
              ].map(({ label, field }) => (
                <div key={field}>
                  <Label className="text-xs mb-1.5 block">{label}</Label>
                  <Input
                    type="number" min={0} step={field.includes("percent") ? 1 : 0.01}
                    value={form[field as keyof Budget] as number ?? ""}
                    onChange={e => setForm(f => ({ ...f, [field]: Number(e.target.value) }))}
                    className="h-9 text-sm"
                  />
                </div>
              ))}
              <div>
                <Label className="text-xs mb-1.5 block">Default quality mode</Label>
                <Select value={form.quality_mode ?? "balanced"} onValueChange={v => setForm(f => ({ ...f, quality_mode: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="economy">Economy</SelectItem>
                    <SelectItem value="balanced">Balanced</SelectItem>
                    <SelectItem value="maximum">Maximum Quality</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              {[
                { id: "block_premium", label: "Block premium models at budget limit", desc: "Automatically use economy models when the hard limit is reached.", field: "block_premium_at_limit" },
                { id: "allow_multi", label: "Allow multi-model execution", desc: "Permit VIBA to use multiple models for complex tasks when in Maximum Quality mode.", field: "allow_multi_model" },
                { id: "use_existing", label: "Use My Existing AI First", desc: "Prefer providers you already pay for before routing to additional services.", field: "use_existing_first" },
              ].map(({ id, label, desc, field }) => (
                <div key={id} className="flex items-start gap-3">
                  <Switch
                    id={id}
                    checked={Boolean(form[field as keyof Budget])}
                    onCheckedChange={v => setForm(f => ({ ...f, [field]: v }))}
                  />
                  <div>
                    <Label htmlFor={id} className="text-sm font-medium cursor-pointer">{label}</Label>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <Button size="sm" onClick={() => saveBudget.mutate()} disabled={saveBudget.isPending}>
              {saveBudget.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save Budget Settings
            </Button>
          </CardContent>
        </Card>

        {/* AI subscriptions */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">AI Services You Already Pay For</CardTitle>
            <CardDescription>
              Record your existing subscriptions so VIBA can prioritise them.
              <span className="block mt-1 text-amber-400/80 text-xs flex items-center gap-1">
                <Info className="h-3 w-3 inline" />
                Utilisation estimates are based on tasks routed through VIBA and may not reflect full usage.
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {subs.length > 0 && (
              <div className="space-y-2">
                {subs.map(s => (
                  <div key={s.id} className="flex items-center justify-between py-3 border-b border-border/30 last:border-0 gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{s.display_name}</p>
                        {s.prioritise && <Badge className="text-[10px] bg-primary/15 text-primary border border-primary/25 px-1.5">Prioritised</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.included_usage_description ?? "No usage description"}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <p className="text-sm font-medium">${s.monthly_cost_usd}/mo</p>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => deleteSub.mutate(s.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-muted-foreground">Total monthly AI subscriptions</p>
                  <p className="text-sm font-bold">${totalMonthlyAiCost.toFixed(2)}/mo</p>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-dashed border-border/50 p-4 space-y-4">
              <p className="text-sm font-medium">Add a subscription</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs mb-1.5 block">Provider</Label>
                  <Select value={newSub.provider} onValueChange={v => {
                    const found = COMMON_PROVIDERS.find(p => p.value === v);
                    setNewSub(s => ({ ...s, provider: v, displayName: found?.label ?? v }));
                  }}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select provider" /></SelectTrigger>
                    <SelectContent>
                      {COMMON_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">Display name</Label>
                  <Input placeholder="e.g. ChatGPT Plus" value={newSub.displayName} onChange={e => setNewSub(s => ({ ...s, displayName: e.target.value }))} className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">Monthly cost (USD)</Label>
                  <Input type="number" min={0} step={0.01} placeholder="20" value={newSub.monthlyCostUsd || ""} onChange={e => setNewSub(s => ({ ...s, monthlyCostUsd: Number(e.target.value) }))} className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">What's included</Label>
                  <Input placeholder="e.g. GPT-4o access, DALL-E 3" value={newSub.includedUsageDescription} onChange={e => setNewSub(s => ({ ...s, includedUsageDescription: e.target.value }))} className="h-9 text-sm" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch id="prioritiseSub" checked={newSub.prioritise} onCheckedChange={v => setNewSub(s => ({ ...s, prioritise: v }))} />
                <Label htmlFor="prioritiseSub" className="text-xs cursor-pointer">Prioritise this provider in VIBA routing</Label>
              </div>
              <Button size="sm" onClick={() => addSub.mutate()} disabled={!newSub.provider || addSub.isPending}>
                {addSub.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                Add Subscription
              </Button>
            </div>

            {subs.length > 0 && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400/70" />
                This subscription may be underutilised based on tasks routed through VIBA. Do not cancel a subscription solely from estimated usage — check directly with your provider.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
