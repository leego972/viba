import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetSettings, useSaveSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Key, ShieldCheck, Zap } from "lucide-react";

const PROVIDERS = [
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API Key (ChatGPT)",
    placeholder: "sk-...",
    hint: "Powers ChatGPT agents — gpt-4.1-mini by default.",
  },
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API Key (Claude)",
    placeholder: "sk-ant-...",
    hint: "Powers Claude agents — claude-3-5-haiku by default.",
  },
  {
    key: "GEMINI_API_KEY",
    label: "Google Gemini API Key",
    placeholder: "AIza...",
    hint: "Powers Gemini agents — gemini-2.0-flash by default.",
  },
  {
    key: "PERPLEXITY_API_KEY",
    label: "Perplexity API Key",
    placeholder: "pplx-...",
    hint: "Powers Perplexity research agents — sonar model.",
  },
  {
    key: "REPLIT_API_KEY",
    label: "Replit Agent API Key",
    placeholder: "replit-...",
    hint: "Powers Replit code agents. Obtain your key from replit.com/account.",
  },
  {
    key: "MANUS_API_KEY",
    label: "Manus API Key",
    placeholder: "manus-...",
    hint: "Powers Manus research agents. Obtain your key from manus.im.",
  },
];

type KeyState = Record<string, string>;

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const saveSettings = useSaveSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [keys, setKeys] = useState<KeyState>(() =>
    Object.fromEntries(PROVIDERS.map((p) => [p.key, ""]))
  );

  useEffect(() => {
    if (settings) {
      setKeys((prev) => {
        const next = { ...prev };
        settings.forEach((s) => {
          if (s.key in next) next[s.key] = s.value ?? "";
        });
        return next;
      });
    }
  }, [settings]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setKeys((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = () => {
    const settingsToSave = Object.entries(keys)
      .filter(([_, value]) => value !== "")
      .map(([key, value]) => ({ key, value }));

    saveSettings.mutate(
      { data: { settings: settingsToSave } },
      {
        onSuccess: () => {
          toast({ title: "Settings saved", description: "Your API keys have been updated." });
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <AppLayout>
      <div className="flex flex-col space-y-6 max-w-3xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">Manage your AI provider API keys</p>
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" /> API Keys
            </CardTitle>
            <CardDescription>
              Enter keys for the providers you want to use. Sessions with a valid key call the{" "}
              <span className="inline-flex items-center gap-1 font-medium text-green-600 dark:text-green-400">
                <Zap className="h-3 w-3" /> live
              </span>{" "}
              model; others run a simulation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} id="settings-form">
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="h-16 bg-muted rounded animate-pulse" />
                  ))}
                </div>
              ) : (
                PROVIDERS.map(({ key, label, placeholder, hint }) => (
                  <div key={key} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={key}>{label}</Label>
                      <Badge variant="outline" className="text-green-600 border-green-500/40 bg-green-500/10 gap-1 px-1.5 py-0 text-[10px]">
                        <Zap className="h-2.5 w-2.5" /> Live
                      </Badge>
                    </div>
                    <Input
                      type="password"
                      id={key}
                      name={key}
                      placeholder={placeholder}
                      value={keys[key] ?? ""}
                      onChange={handleChange}
                    />
                    <p className="text-xs text-muted-foreground">{hint}</p>
                  </div>
                ))
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
