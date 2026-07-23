import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Info,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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

interface NewSubscription {
  provider: string;
  displayName: string;
  monthlyCostUsd: number;
  includedUsageDescription: string;
  renewalDay: string;
  prioritise: boolean;
}

const DEFAULTS: Budget = {
  monthly_budget_usd: null,
  warn_threshold_usd: null,
  hard_limit_usd: null,
  premium_approval_threshold_usd: 0.25,
  require_approval_above_usd: 1,
  auto_economy_at_percent: 80,
  block_premium_at_limit: true,
  allow_multi_model: false,
  quality_mode: "balanced",
  use_existing_first: true,
};

const EMPTY_SUBSCRIPTION: NewSubscription = {
  provider: "",
  displayName: "",
  monthlyCostUsd: 0,
  includedUsageDescription: "",
  renewalDay: "",
  prioritise: false,
};

const COMMON_PROVIDERS = [
  { value: "chatgpt", label: "ChatGPT (OpenAI)" },
  { value: "claude", label: "Claude (Anthropic)" },
  { value: "gemini", label: "Gemini (Google)" },
  { value: "cursor", label: "Cursor" },
  { value: "replit", label: "Replit" },
  { value: "groq", label: "Groq" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "perplexity", label: "Perplexity" },
  { value: "copilot", label: "GitHub Copilot" },
  { value: "other", label: "Other" },
];

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const text = await response.text();
  let body: unknown;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error?: unknown }).error ?? `Request failed (${response.status})`)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return body as T;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function SkeletonField() {
  return <div className="h-9 animate-pulse rounded-md bg-muted/40" />;
}

export default function BudgetsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: budgetData,
    isLoading: budgetLoading,
    isError: budgetFailed,
    error: budgetQueryError,
    refetch: refetchBudget,
  } = useQuery<{ budget: Budget | null }>({
    queryKey: ["/api/ai/budgets"],
    queryFn: () =>
      requestJson<{ budget: Budget | null }>("/api/ai/budgets", {
        credentials: "include",
      }),
  });

  const {
    data: subscriptionsData,
    isError: subscriptionsFailed,
    error: subscriptionsQueryError,
    refetch: refetchSubscriptions,
  } = useQuery<{ subscriptions: Subscription[] }>({
    queryKey: ["/api/ai/subscriptions"],
    queryFn: () =>
      requestJson<{ subscriptions: Subscription[] }>("/api/ai/subscriptions", {
        credentials: "include",
      }),
  });

  const [form, setForm] = useState<Budget>(DEFAULTS);
  const [formReady, setFormReady] = useState(false);
  const [newSubscription, setNewSubscription] = useState<NewSubscription>(EMPTY_SUBSCRIPTION);

  useEffect(() => {
    if (budgetLoading || budgetFailed) return;
    setForm(budgetData?.budget ?? DEFAULTS);
    setFormReady(true);
  }, [budgetData, budgetFailed, budgetLoading]);

  const saveBudget = useMutation({
    mutationFn: () =>
      requestJson<{ ok: boolean }>("/api/ai/budgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/budgets"] });
      toast({ title: "Budget settings saved" });
    },
    onError: (error) =>
      toast({
        title: "Budget settings were not saved",
        description: errorMessage(error, "The server rejected the update."),
        variant: "destructive",
      }),
  });

  const addSubscription = useMutation({
    mutationFn: () =>
      requestJson<{ ok: boolean }>("/api/ai/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          provider: newSubscription.provider,
          displayName: newSubscription.displayName.trim(),
          monthlyCostUsd: newSubscription.monthlyCostUsd,
          includedUsageDescription:
            newSubscription.includedUsageDescription.trim() || undefined,
          renewalDay: newSubscription.renewalDay
            ? Number(newSubscription.renewalDay)
            : undefined,
          prioritise: newSubscription.prioritise,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/subscriptions"] });
      setNewSubscription(EMPTY_SUBSCRIPTION);
      toast({ title: "Subscription added" });
    },
    onError: (error) =>
      toast({
        title: "Subscription was not added",
        description: errorMessage(error, "The server rejected the subscription."),
        variant: "destructive",
      }),
  });

  const deleteSubscription = useMutation({
    mutationFn: (id: number) =>
      requestJson<{ ok?: boolean }>(`/api/ai/subscriptions/${id}`, {
        method: "DELETE",
        credentials: "include",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/subscriptions"] });
      toast({ title: "Subscription removed" });
    },
    onError: (error) =>
      toast({
        title: "Subscription was not removed",
        description: errorMessage(error, "The server rejected the removal."),
        variant: "destructive",
      }),
  });

  const subscriptions = subscriptionsData?.subscriptions ?? [];
  const totalMonthlyAiCost = subscriptions.reduce(
    (total, subscription) => total + subscription.monthly_cost_usd,
    0,
  );

  const warningExceedsHardLimit =
    form.warn_threshold_usd !== null &&
    form.hard_limit_usd !== null &&
    form.warn_threshold_usd > form.hard_limit_usd;
  const economyPercentInvalid =
    form.auto_economy_at_percent < 1 || form.auto_economy_at_percent > 100;
  const formInvalid = warningExceedsHardLimit || economyPercentInvalid;

  const numericField = (
    label: string,
    field: keyof Budget,
    placeholder: string,
    isPercent = false,
  ) => (
    <div key={field}>
      <Label className="mb-1.5 block text-xs">{label}</Label>
      {!formReady ? (
        <SkeletonField />
      ) : (
        <Input
          type="number"
          min={isPercent ? 1 : 0}
          max={isPercent ? 100 : undefined}
          step={isPercent ? 1 : 0.01}
          placeholder={placeholder}
          value={(form[field] as number | null) ?? ""}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              [field]: event.target.value ? Number(event.target.value) : null,
            }))
          }
          className="h-9 text-sm"
        />
      )}
    </div>
  );

  return (
    <AppLayout>
      <div className="container max-w-4xl space-y-8 py-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Budgets & Subscriptions</h1>
          <p className="mt-1 text-muted-foreground">
            Set spending limits, approval thresholds, and track your existing AI subscriptions.
          </p>
        </div>

        {budgetFailed && (
          <div
            className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
            role="alert"
          >
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium">Budget settings could not be loaded</p>
                <p className="text-xs text-muted-foreground">
                  {errorMessage(budgetQueryError, "The server did not return the current settings.")}
                </p>
              </div>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => refetchBudget()}>
              Retry
            </Button>
          </div>
        )}

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-primary" /> Budget Controls
            </CardTitle>
            <CardDescription>
              VIBA enforces these limits automatically across all AI task routing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Monthly spending limits
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                {numericField("Monthly budget (USD)", "monthly_budget_usd", "No limit")}
                {numericField("Warn at (USD)", "warn_threshold_usd", "e.g. 40")}
                {numericField("Hard limit (USD)", "hard_limit_usd", "e.g. 50")}
              </div>
              <p className="mt-2 text-xs text-muted-foreground/60">
                Leave blank for no limit. At the hard limit, premium-model spending stops;
                compatible economy routing may continue.
              </p>
            </div>

            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Approval thresholds
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {numericField(
                  "Warn before tasks above ($)",
                  "premium_approval_threshold_usd",
                  "e.g. 0.25",
                )}
                {numericField(
                  "Require approval above ($)",
                  "require_approval_above_usd",
                  "e.g. 1.00",
                )}
              </div>
            </div>

            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Automatic behaviour
              </p>
              <div className="mb-4 grid gap-4 sm:grid-cols-2">
                {numericField(
                  "Switch to Economy at (% of budget used)",
                  "auto_economy_at_percent",
                  "e.g. 80",
                  true,
                )}
                <div>
                  <Label className="mb-1.5 block text-xs">Default quality mode</Label>
                  {!formReady ? (
                    <SkeletonField />
                  ) : (
                    <Select
                      value={form.quality_mode}
                      onValueChange={(value) =>
                        setForm((current) => ({ ...current, quality_mode: value }))
                      }
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="economy">Economy — minimise cost</SelectItem>
                        <SelectItem value="balanced">Balanced — cost + quality</SelectItem>
                        <SelectItem value="maximum">Maximum Quality — best results</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {[
                  {
                    id: "block_premium",
                    field: "block_premium_at_limit" as keyof Budget,
                    label: "Stop premium-model calls at the hard limit",
                    desc: "Prevents additional premium-model spend after the hard limit. Economy models can still be used when they are suitable.",
                  },
                  {
                    id: "allow_multi",
                    field: "allow_multi_model" as keyof Budget,
                    label: "Allow multi-model execution",
                    desc: "Permit VIBA to use multiple models in parallel for complex tasks when Maximum Quality mode is active.",
                  },
                  {
                    id: "use_existing",
                    field: "use_existing_first" as keyof Budget,
                    label: "Use my existing AI subscriptions first",
                    desc: "Prefer providers you already pay for before routing to additional paid services.",
                  },
                ].map(({ id, field, label, desc }) => (
                  <div key={id} className="flex items-start gap-3">
                    {!formReady ? (
                      <div className="mt-0.5 h-5 w-9 shrink-0 animate-pulse rounded-full bg-muted/40" />
                    ) : (
                      <Switch
                        id={id}
                        checked={Boolean(form[field])}
                        onCheckedChange={(value) =>
                          setForm((current) => ({ ...current, [field]: value }))
                        }
                      />
                    )}
                    <div>
                      <Label htmlFor={id} className="cursor-pointer text-sm font-medium">
                        {label}
                      </Label>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {(warningExceedsHardLimit || economyPercentInvalid) && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300" role="alert">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {warningExceedsHardLimit
                    ? "The warning amount cannot be higher than the hard limit."
                    : "The Economy switch point must be between 1% and 100%."}
                </span>
              </div>
            )}

            <Button
              type="button"
              size="sm"
              onClick={() => saveBudget.mutate()}
              disabled={saveBudget.isPending || !formReady || formInvalid}
            >
              {saveBudget.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Save Budget Settings
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">AI Services You Already Pay For</CardTitle>
            <CardDescription>
              Record your existing subscriptions so VIBA can route to them first and avoid
              unnecessary API spend.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {subscriptionsFailed && (
              <div
                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between"
                role="alert"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <p className="text-xs text-muted-foreground">
                    {errorMessage(
                      subscriptionsQueryError,
                      "Subscriptions could not be loaded.",
                    )}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => refetchSubscriptions()}
                >
                  Retry
                </Button>
              </div>
            )}

            {subscriptions.length > 0 && (
              <div className="space-y-1">
                {subscriptions.map((subscription) => (
                  <div
                    key={subscription.id}
                    className="flex items-center justify-between gap-3 border-b border-border/30 py-3 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{subscription.display_name}</p>
                        {subscription.prioritise && (
                          <Badge className="border border-primary/25 bg-primary/15 px-1.5 py-0 text-[10px] text-primary">
                            Prioritised
                          </Badge>
                        )}
                      </div>
                      {subscription.included_usage_description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {subscription.included_usage_description}
                        </p>
                      )}
                      {subscription.renewal_day && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                          Renews on day {subscription.renewal_day} of the month
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <p className="text-sm font-medium">
                        ${subscription.monthly_cost_usd.toFixed(2)}/mo
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteSubscription.mutate(subscription.id)}
                        disabled={deleteSubscription.isPending}
                        aria-label={`Remove ${subscription.display_name}`}
                        title="Remove subscription"
                      >
                        {deleteSubscription.isPending &&
                        deleteSubscription.variables === subscription.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-muted-foreground">
                    Total monthly AI subscriptions
                  </p>
                  <p className="text-sm font-bold">${totalMonthlyAiCost.toFixed(2)}/mo</p>
                </div>
              </div>
            )}

            <div className="space-y-4 rounded-xl border border-dashed border-border/50 p-4">
              <p className="text-sm font-medium">
                {subscriptions.length === 0
                  ? "Add your first subscription"
                  : "Add another subscription"}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1.5 block text-xs">Provider</Label>
                  <Select
                    value={newSubscription.provider}
                    onValueChange={(value) => {
                      const found = COMMON_PROVIDERS.find(
                        (provider) => provider.value === value,
                      );
                      setNewSubscription((current) => ({
                        ...current,
                        provider: value,
                        displayName: current.displayName || found?.label || value,
                      }));
                    }}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMON_PROVIDERS.map((provider) => (
                        <SelectItem key={provider.value} value={provider.value}>
                          {provider.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">Display name</Label>
                  <Input
                    placeholder="e.g. ChatGPT Plus"
                    value={newSubscription.displayName}
                    onChange={(event) =>
                      setNewSubscription((current) => ({
                        ...current,
                        displayName: event.target.value,
                      }))
                    }
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">Monthly cost (USD)</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="20"
                    value={newSubscription.monthlyCostUsd || ""}
                    onChange={(event) =>
                      setNewSubscription((current) => ({
                        ...current,
                        monthlyCostUsd: Number(event.target.value),
                      }))
                    }
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">Renewal day of month</Label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    placeholder="e.g. 1"
                    value={newSubscription.renewalDay}
                    onChange={(event) =>
                      setNewSubscription((current) => ({
                        ...current,
                        renewalDay: event.target.value,
                      }))
                    }
                    className="h-9 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="mb-1.5 block text-xs">What is included</Label>
                  <Input
                    placeholder="e.g. GPT-4o access, 40 messages / 3 hours"
                    value={newSubscription.includedUsageDescription}
                    onChange={(event) =>
                      setNewSubscription((current) => ({
                        ...current,
                        includedUsageDescription: event.target.value,
                      }))
                    }
                    className="h-9 text-sm"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="prioritiseSub"
                  checked={newSubscription.prioritise}
                  onCheckedChange={(value) =>
                    setNewSubscription((current) => ({
                      ...current,
                      prioritise: value,
                    }))
                  }
                />
                <Label htmlFor="prioritiseSub" className="cursor-pointer text-xs">
                  Prioritise this provider in VIBA routing
                </Label>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => addSubscription.mutate()}
                disabled={
                  !newSubscription.provider ||
                  !newSubscription.displayName.trim() ||
                  addSubscription.isPending
                }
              >
                {addSubscription.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Add Subscription
              </Button>
            </div>

            {subscriptions.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/70" />
                <span>
                  VIBA tracks usage routed through it only. This does not reflect your full usage
                  with each provider. Check the provider directly before changing or cancelling a
                  subscription.
                </span>
              </div>
            )}

            {subscriptions.length === 0 && !subscriptionsFailed && (
              <div className="flex items-start gap-2 rounded-lg bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/60" />
                Adding subscriptions helps VIBA route tasks to services you already pay for and
                reduce unnecessary API spend.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
