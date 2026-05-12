import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetSettings, useSaveSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Key, ShieldAlert } from "lucide-react";

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const saveSettings = useSaveSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [keys, setKeys] = useState({
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    GEMINI_API_KEY: "",
    MANUS_API_KEY: "",
    REPLIT_API_KEY: "",
    PERPLEXITY_API_KEY: ""
  });

  useEffect(() => {
    if (settings) {
      const newKeys = { ...keys };
      settings.forEach(setting => {
        if (setting.key in newKeys) {
          (newKeys as any)[setting.key] = setting.value;
        }
      });
      setKeys(newKeys);
    }
  }, [settings]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setKeys(prev => ({ ...prev, [e.target.name]: e.target.value }));
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
        }
      }
    );
  };

  return (
    <AppLayout>
      <div className="flex flex-col space-y-6 max-w-3xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">Manage your provider API keys</p>
        </div>

        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex gap-4">
          <ShieldAlert className="h-6 w-6 text-primary flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-primary">MVP - Local Storage Only</h3>
            <p className="text-sm text-primary/80">
              For this MVP, your API keys are stored securely in your browser's local storage or the local database. They are only sent to the server when needed to make API calls to the respective providers.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" /> API Keys</CardTitle>
            <CardDescription>Enter the API keys for the providers you want to use.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} id="settings-form">
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="h-10 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="OPENAI_API_KEY">OpenAI API Key (ChatGPT)</Label>
                  <Input 
                    type="password" 
                    id="OPENAI_API_KEY" 
                    name="OPENAI_API_KEY" 
                    placeholder="sk-..." 
                    value={keys.OPENAI_API_KEY} 
                    onChange={handleChange} 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ANTHROPIC_API_KEY">Anthropic API Key (Claude)</Label>
                  <Input 
                    type="password" 
                    id="ANTHROPIC_API_KEY" 
                    name="ANTHROPIC_API_KEY" 
                    placeholder="sk-ant-..." 
                    value={keys.ANTHROPIC_API_KEY} 
                    onChange={handleChange} 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="GEMINI_API_KEY">Google Gemini API Key</Label>
                  <Input 
                    type="password" 
                    id="GEMINI_API_KEY" 
                    name="GEMINI_API_KEY" 
                    placeholder="AIza..." 
                    value={keys.GEMINI_API_KEY} 
                    onChange={handleChange} 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="MANUS_API_KEY">Manus API Key</Label>
                  <Input 
                    type="password" 
                    id="MANUS_API_KEY" 
                    name="MANUS_API_KEY" 
                    placeholder="..." 
                    value={keys.MANUS_API_KEY} 
                    onChange={handleChange} 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="REPLIT_API_KEY">Replit API Key</Label>
                  <Input 
                    type="password" 
                    id="REPLIT_API_KEY" 
                    name="REPLIT_API_KEY" 
                    placeholder="..." 
                    value={keys.REPLIT_API_KEY} 
                    onChange={handleChange} 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="PERPLEXITY_API_KEY">Perplexity API Key</Label>
                  <Input 
                    type="password" 
                    id="PERPLEXITY_API_KEY" 
                    name="PERPLEXITY_API_KEY" 
                    placeholder="pplx-..." 
                    value={keys.PERPLEXITY_API_KEY} 
                    onChange={handleChange} 
                  />
                </div>
              </>
            )}
            </form>
          </CardContent>
          <CardFooter>
            <Button type="submit" form="settings-form" disabled={saveSettings.isPending || isLoading}>
              {saveSettings.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </AppLayout>
  );
}
