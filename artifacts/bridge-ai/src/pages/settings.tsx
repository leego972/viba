import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetSettings, useSaveSettings, useGetStats, useSendTestNotification, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Key, ShieldCheck, Zap, RotateCcw, BarChart2, Cpu, Bell, X } from "lucide-react";

type ModelOption = { value: string; label: string };

type ProviderConfig = {
  key: string;
  label: string;
  placeholder: string;
  hint: string;
  providerName: string;
  modelKey?: string;
  defaultModel?: string;
  models?: ModelOption[];
};

const PROVIDERS: ProviderConfig[] = [
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API Key (ChatGPT)",
    placeholder: "sk-...",
    hint: "Powers ChatGPT agents.",
    providerName: "openai",
    modelKey: "OPENAI_MODEL",
    defaultModel: "gpt-4.1-mini",
    models: [
      { value: "gpt-4.1-mini", label: "GPT-4.1 Mini (default)" },
      { value: "gpt-4.1", label: "GPT-4.1" },
      { value: "gpt-4o", label: "GPT-4o" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini" },
      { value: "o3-mini", label: "o3-mini" },
      { value: "o1-mini", label: "o1-mini" },
    ],
  },
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API Key (Claude)",
    placeholder: "sk-ant-...",
    hint: "Powers Claude agents.",
    providerName: "anthropic",
    modelKey: "ANTHROPIC_MODEL",
    defaultModel: "claude-3-5-haiku-20241022",
    models: [
      { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (default)" },
      { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
      { value: "claude-3-opus-20240229", label: "Claude 3 Opus" },
      { value: "claude-3-haiku-20240307", label: "Claude 3 Haiku" },
    ],
  },
  {
    key: "GEMINI_API_KEY",
    label: "Google Gemini API Key",
    placeholder: "AIza...",
    hint: "Powers Gemini agents.",
    providerName: "gemini",
    modelKey: "GEMINI_MODEL",
    defaultModel: "gemini-2.0-flash",
    models: [
      { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash (default)" },
      { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
      { value: "gemini-2.5-pro-preview-05-06", label: "Gemini 2.5 Pro" },
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
      { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    ],
  },
  {
    key: "PERPLEXITY_API_KEY",
    label: "Perplexity API Key",
    placeholder: "pplx-...",
    hint: "Powers Perplexity research agents.",
    providerName: "perplexity",
    modelKey: "PERPLEXITY_MODEL",
    defaultModel: "sonar",
    models: [
      { value: "sonar", label: "Sonar (default)" },
      { value: "sonar-pro", label: "Sonar Pro" },
      { value: "sonar-reasoning", label: "Sonar Reasoning" },
      { value: "sonar-reasoning-pro", label: "Sonar Reasoning Pro" },
    ],
  },
  {
    key: "REPLIT_API_KEY",
    label: "Replit Agent API Key",
    placeholder: "replit-...",
    hint: "Powers Replit code agents. Obtain your key from replit.com/account.",
    providerName: "replit",
  },
  {
    key: "MANUS_API_KEY",
    label: "Manus API Key",
    placeholder: "manus-...",
    hint: "Powers Manus research agents. Obtain your key from manus.im.",
    providerName: "manus",
  },
];

const ALERT_KEYS = ["FALLBACK_ALERT_ENABLED", "FALLBACK_ALERT_THRESHOLD", "NOTIFICATION_WEBHOOK_URL", "NOTIFICATION_EMAIL"] as const;

const CLEARABLE_NOTIFICATION_KEYS = [
  "NOTIFICATION_WEBHOOK_URL",
  "NOTIFICATION_EMAIL",
  ...PROVIDERS.map((p) => p.key),
];

const ALL_SETTING_KEYS = [
  ...PROVIDERS.flatMap((p) => (p.modelKey ? [p.key, p.modelKey] : [p.key])),
  ...ALERT_KEYS,
];

type KeyState = Record<string, string>;

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const { data: stats } = useGetStats();
  const saveSettings = useSaveSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const sendTestNotification = useSendTestNotification();

  const [values, setValues] = useState<KeyState>(() =>
    Object.fromEntries(ALL_SETTING_KEYS.map((k) => [k, ""]))
  );
  const [clearedKeys, setClearedKeys] = useState<Set<string>>(new Set());
  const [thresholdError, setThresholdError] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setValues((prev) => {
        const next = { ...prev };
        settings.forEach((s) => {
          if (s.key in next) next[s.key] = s.value ?? "";
        });
        return next;
      });
    }
  }, [settings]);

  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    if (clearedKeys.has(name)) {
      setClearedKeys((prev) => { const next = new Set(prev); next.delete(name); return next; });
    }
  };

  const handleClearKey = (key: string) => {
    setValues((prev) => ({ ...prev, [key]: "" }));
    setClearedKeys((prev) => new Set(prev).add(key));
  };

  const handleModelChange = (modelKey: string, value: string) => {
    setValues((prev) => ({ ...prev, [modelKey]: value }));
  };

  const handleSave = () => {
    if (alertEnabled) {
      const n = parseInt(alertThreshold, 10);
      if (!alertThreshold || !/^\d+$/.test(alertThreshold) || n < 1 || n > 100) {
        toast({ title: "Invalid threshold", description: "Alert threshold must be a whole number between 1 and 100.", variant: "destructive" });
        return;
      }
      if (notificationWebhookUrl) {
        try {
          const parsed = new URL(notificationWebhookUrl);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            toast({ title: "Invalid webhook URL", description: "Webhook URL must start with http:// or https://.", variant: "destructive" });
            return;
          }
        } catch {
          toast({ title: "Invalid webhook URL", description: "Please enter a valid URL (e.g. https://hooks.example.com/notify).", variant: "destructive" });
          return;
        }
      }
      if (notificationEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)) {
        toast({ title: "Invalid email", description: "Please enter a valid email address.", variant: "destructive" });
        return;
      }
    }

    const settingsToSave = Object.entries(values)
      .filter(([key, value]) => value !== "" || CLEARABLE_NOTIFICATION_KEYS.includes(key) || clearedKeys.has(key))
      .map(([key, value]) => ({ key, value }));

    saveSettings.mutate(
      { data: { settings: settingsToSave } },
      {
        onSuccess: () => {
          toast({ title: "Settings saved", description: "Your settings have been updated." });
          setClearedKeys(new Set());
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
        onError: (err) => {
          const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          if (message?.includes("FALLBACK_ALERT_THRESHOLD")) {
            setThresholdError(message);
          } else {
            toast({ title: "Error", description: message ?? "Failed to save settings.", variant: "destructive" });
          }
        },
      }
    );
  };

  const fallbackMap = new Map(
    (stats?.fallbacksByProvider ?? [])
      .filter(({ provider }) => provider)
      .map(({ provider, count }) => [provider.toLowerCase(), count])
  );
  const totalFallbacks = stats?.fallbackEvents ?? 0;
  const modelUsage = stats?.modelUsage ?? [];
  const spikeProviders = new Set(stats?.spikeProviders ?? []);

  const alertEnabled = values["FALLBACK_ALERT_ENABLED"] !== "false";
  const alertThreshold = values["FALLBACK_ALERT_THRESHOLD"] || "5";
  const notificationWebhookUrl = values["NOTIFICATION_WEBHOOK_URL"] || "";
  const notificationEmail = values["NOTIFICATION_EMAIL"] || "";

  const savedWebhookUrl = settings
    ? (settings.find((s) => s.key === "NOTIFICATION_WEBHOOK_URL")?.value ?? "")
    : "";
  const webhookUrlIsSaved = notificationWebhookUrl === savedWebhookUrl && !!notificationWebhookUrl;

  const savedEmail = settings
    ? (settings.find((s) => s.key === "NOTIFICATION_EMAIL")?.value ?? "")
    : "";
  const emailIsSaved = notificationEmail === savedEmail && !!notificationEmail;

  const handleAlertEnabledChange = (checked: boolean) => {
    setValues((prev) => ({ ...prev, FALLBACK_ALERT_ENABLED: checked ? "true" : "false" }));
  };

  const handleAlertThresholdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValues((prev) => ({ ...prev, FALLBACK_ALERT_THRESHOLD: v }));
    if (v === "") {
      setThresholdError("Threshold is required.");
    } else if (!/^\d+$/.test(v)) {
      setThresholdError("Must be a whole number.");
    } else {
      const n = parseInt(v, 10);
      if (n < 1 || n > 100) {
        setThresholdError("Must be between 1 and 100.");
      } else {
        setThresholdError(null);
      }
    }
  };

  const handleWebhookUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((prev) => ({ ...prev, NOTIFICATION_WEBHOOK_URL: e.target.value }));
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((prev) => ({ ...prev, NOTIFICATION_EMAIL: e.target.value }));
  };

  const handleTestNotification = () => {
    sendTestNotification.mutate(undefined, {
      onSuccess: (data) => {
        if (data.emailSent === false) {
          const hint = data.message.includes("SMTP not configured")
            ? " Configure SMTP_HOST, SMTP_USER, and SMTP_PASS to enable real email delivery."
            : "";
          toast({
            title: "Test sent — email not delivered",
            description: `${data.message}${hint}`,
            variant: "destructive",
          });
        } else {
          toast({ title: "Test sent", description: data.message });
        }
      },
      onError: (err) => {
        const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to send test notification.";
        toast({ title: "Test failed", description: message, variant: "destructive" });
      },
    });
  };

  return (
    <AppLayout>
      <div className="flex flex-col space-y-6 max-w-3xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">Manage your AI provider API keys and models</p>
        </div>

        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex gap-4">
          <ShieldCheck className="h-6 w-6 text-primary flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-primary">Keys are stored securely in the database</h3>
            <p className="text-sm text-primary/80">
              Your API keys are stored server-side and only used to call each provider.
              They are never returned to the browser — a masked placeholder is shown once set.
              Sessions fall back to a realistic simulation when no key is configured.
            </p>
          </div>
        </div>

        {/* Fallback stats summary */}
        {totalFallbacks > 0 && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-amber-400">
                <BarChart2 className="h-4 w-4" />
                Fallback Activity
              </CardTitle>
              <CardDescription>
                {totalFallbacks} live API {totalFallbacks === 1 ? "call has" : "calls have"} fallen back to simulation.
                Providers with issues are highlighted below.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {/* Model usage breakdown */}
        {modelUsage.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Cpu className="h-4 w-4 text-muted-foreground" />
                Model Usage
              </CardTitle>
              <CardDescription>Messages generated per model across all sessions — live vs. simulated</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                {modelUsage.map(({ model, count, liveCount, simulatedCount }) => {
                  const total = modelUsage.reduce((s, m) => s + m.count, 0);
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  const livePct = count > 0 ? Math.round((liveCount / count) * 100) : 0;
                  return (
                    <div key={model} className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono w-28 sm:w-44 truncate shrink-0">{model}</span>
                        <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-16 text-right shrink-0">
                          {count} msg{count !== 1 ? "s" : ""} ({pct}%)
                        </span>
                      </div>
                      <div className="flex items-center gap-2 pl-28 sm:pl-44 ml-0">
                        {liveCount > 0 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 h-4 border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
                            {liveCount} live ({livePct}%)
                          </Badge>
                        )}
                        {simulatedCount > 0 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 h-4 border-amber-500/40 text-amber-400 bg-amber-500/10">
                            {simulatedCount} sim ({100 - livePct}%)
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Alert configuration */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="h-4 w-4" /> Fallback Spike Alerts
            </CardTitle>
            <CardDescription>
              Get an alert on the dashboard when a provider exceeds the fallback threshold within the last hour.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="alert-enabled" className="font-medium">Enable spike alerts</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Show a prominent banner when a provider's fallback rate spikes.
                </p>
              </div>
              <Switch
                id="alert-enabled"
                checked={alertEnabled}
                onCheckedChange={handleAlertEnabledChange}
              />
            </div>
            <div className={`space-y-1.5 transition-opacity ${alertEnabled ? "" : "opacity-40 pointer-events-none"}`}>
              <Label htmlFor="alert-threshold">Alert threshold (fallbacks per hour)</Label>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Input
                  id="alert-threshold"
                  type="text"
                  inputMode="numeric"
                  className={`w-24 shrink-0 ${thresholdError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                  value={alertThreshold}
                  onChange={handleAlertThresholdChange}
                  disabled={!alertEnabled}
                />
                <p className="text-xs text-muted-foreground">
                  Alert fires when a provider hits this many fallbacks within the last hour.
                </p>
              </div>
              {thresholdError && alertEnabled && (
                <p className="text-xs text-red-500">{thresholdError}</p>
              )}
            </div>
            <div className={`space-y-4 border-t pt-4 transition-opacity ${alertEnabled ? "" : "opacity-40 pointer-events-none"}`}>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Out-of-band notifications</p>
              <div className="space-y-1.5">
                <Label htmlFor="notification-webhook">Webhook URL</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="notification-webhook"
                    type="url"
                    placeholder="https://hooks.example.com/notify"
                    value={notificationWebhookUrl}
                    onChange={handleWebhookUrlChange}
                    disabled={!alertEnabled}
                    className="flex-1"
                  />
                  {notificationWebhookUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleTestNotification}
                      disabled={!alertEnabled || sendTestNotification.isPending || !webhookUrlIsSaved}
                      title={!webhookUrlIsSaved ? "Save settings first to test this URL" : undefined}
                    >
                      {sendTestNotification.isPending ? "Sending..." : "Send test"}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  When a spike is detected, a POST request with JSON details (provider name, fallback count, settings link) is sent to this URL. Works with Slack incoming webhooks, PagerDuty, Make, Zapier, and any HTTP endpoint.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notification-email">Email address</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="notification-email"
                    type="email"
                    placeholder="alerts@example.com"
                    value={notificationEmail}
                    onChange={handleEmailChange}
                    disabled={!alertEnabled}
                    className="flex-1"
                  />
                  {notificationEmail && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleTestNotification}
                      disabled={!alertEnabled || sendTestNotification.isPending || !emailIsSaved}
                      title={!emailIsSaved ? "Save settings first to test this email" : undefined}
                    >
                      {sendTestNotification.isPending ? "Sending..." : "Send test"}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Receive spike alert emails at this address. Leave blank to disable email notifications.
                  Requires SMTP configuration (SMTP_HOST, SMTP_USER, SMTP_PASS).
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              onClick={handleSave}
              disabled={saveSettings.isPending || isLoading}
              variant="outline"
              size="sm"
            >
              {saveSettings.isPending ? "Saving..." : "Save Alert Settings"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" /> API Keys &amp; Models
            </CardTitle>
            <CardDescription>
              Enter keys for the providers you want to use, and optionally pick a model. Sessions with a valid key call the{" "}
              <span className="inline-flex items-center gap-1 font-medium text-green-600 dark:text-green-400">
                <Zap className="h-3 w-3" /> live
              </span>{" "}
              model; others run a simulation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} id="settings-form">
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="h-20 bg-muted rounded animate-pulse" />
                  ))}
                </div>
              ) : (
                PROVIDERS.map(({ key, label, placeholder, hint, providerName, modelKey, defaultModel, models }) => {
                  const fallbackCount = fallbackMap.get(providerName) ?? 0;
                  const isSpike = spikeProviders.has(providerName);
                  return (
                    <div
                      key={key}
                      className={`space-y-2 rounded-lg p-3 -mx-3 ${
                        isSpike
                          ? "bg-red-500/5 border border-red-500/20"
                          : fallbackCount > 0
                            ? "bg-amber-500/5 border border-amber-500/20"
                            : ""
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <Label htmlFor={key}>{label}</Label>
                        <Badge variant="outline" className="text-green-600 border-green-500/40 bg-green-500/10 gap-1 px-1.5 py-0 text-[10px]">
                          <Zap className="h-2.5 w-2.5" /> Live
                        </Badge>
                        {isSpike && (
                          <Badge variant="outline" className="text-red-400 border-red-500/40 bg-red-500/10 gap-1 px-1.5 py-0 text-[10px]">
                            ⚠ Spike: {fallbackCount} fallbacks
                          </Badge>
                        )}
                        {!isSpike && fallbackCount > 0 && (
                          <Badge variant="outline" className="text-amber-500 border-amber-500/40 bg-amber-500/10 gap-1 px-1.5 py-0 text-[10px]">
                            <RotateCcw className="h-2.5 w-2.5" />
                            {fallbackCount} {fallbackCount === 1 ? "fallback" : "fallbacks"}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="password"
                          id={key}
                          name={key}
                          placeholder={clearedKeys.has(key) ? "Will be cleared on save" : placeholder}
                          value={values[key] ?? ""}
                          onChange={handleKeyChange}
                          className="flex-1"
                        />
                        {(values[key] === "***SET***" || clearedKeys.has(key)) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleClearKey(key)}
                            disabled={clearedKeys.has(key)}
                            title="Remove saved key"
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-4 w-4" />
                            <span className="ml-1 text-xs">{clearedKeys.has(key) ? "Cleared" : "Clear"}</span>
                          </Button>
                        )}
                      </div>
                      {modelKey && models && (
                        <div className="flex items-center gap-2">
                          <Label htmlFor={modelKey} className="text-xs text-muted-foreground whitespace-nowrap">
                            Model
                          </Label>
                          <Select
                            value={values[modelKey] || defaultModel}
                            onValueChange={(v) => handleModelChange(modelKey, v)}
                          >
                            <SelectTrigger id={modelKey} className="h-8 text-xs">
                              <SelectValue placeholder={`Default: ${defaultModel}`} />
                            </SelectTrigger>
                            <SelectContent>
                              {models.map((m) => (
                                <SelectItem key={m.value} value={m.value} className="text-xs">
                                  {m.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">{hint}</p>
                    </div>
                  );
                })
              )}
            </form>
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              form="settings-form"
              disabled={saveSettings.isPending || isLoading}
            >
              {saveSettings.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </AppLayout>
  );
}
