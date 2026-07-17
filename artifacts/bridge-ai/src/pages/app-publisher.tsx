import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Apple,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Globe2,
  Loader2,
  Play,
  Rocket,
  ShieldCheck,
  Smartphone,
  Store,
  WandSparkles,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
type Platform = "android" | "apple";
type Issue = { field: string; message: string; severity: "error" | "warning" };

const STEPS = ["Stores", "Website", "App details", "Review", "Publish"];

export default function AppPublisherPage() {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [platforms, setPlatforms] = useState<Platform[]>(["android"]);
  const [websiteUrl, setWebsiteUrl] = useState("https://viba.guru");
  const [appName, setAppName] = useState("VIBA");
  const [bundleId, setBundleId] = useState("guru.viba.app");
  const [version, setVersion] = useState("1.0.0");
  const [buildNumber, setBuildNumber] = useState(1);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [published, setPublished] = useState(false);

  const canContinue = useMemo(() => {
    if (step === 0) return platforms.length > 0;
    if (step === 1) return /^https:\/\//i.test(websiteUrl);
    if (step === 2) return appName.trim().length >= 2 && bundleId.includes(".");
    return true;
  }, [step, platforms, websiteUrl, appName, bundleId]);

  function togglePlatform(platform: Platform) {
    setPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  }

  async function validate() {
    setLoading(true);
    try {
      const response = await fetch(`${BASE}/api/app-publisher/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ platforms, websiteUrl, appName, bundleId, version, buildNumber }),
      });
      const data = await response.json();
      setIssues(data.issues ?? []);
      setScore(typeof data.score === "number" ? data.score : 0);
      setStep(3);
    } catch {
      toast({ title: "Validation failed", description: "VIBA could not complete the store readiness check.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    setLoading(true);
    try {
      const response = await fetch(`${BASE}/api/app-publisher/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ platforms, websiteUrl, appName, bundleId, version, buildNumber }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Publishing could not start.");
      setPublished(true);
      setStep(4);
      toast({ title: "Build queued", description: data.message || "VIBA has started preparing your app." });
    } catch (error) {
      toast({ title: "Publishing unavailable", description: error instanceof Error ? error.message : "Publishing could not start.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge variant="outline" className="mb-3 gap-1.5"><Rocket className="h-3.5 w-3.5" /> App Publisher</Badge>
            <h1 className="text-3xl font-semibold tracking-tight">Publish your website as an app</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Choose your stores, confirm the website, and let VIBA validate and start the mobile build.</p>
          </div>
          <div className="rounded-xl border bg-card px-4 py-3 text-sm">
            <span className="text-muted-foreground">No GitHub, Xcode or Android Studio required.</span>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-5">
          {STEPS.map((label, index) => (
            <div key={label} className={`rounded-xl border px-3 py-3 ${index === step ? "border-primary bg-primary/10" : index < step ? "border-emerald-500/30 bg-emerald-500/5" : "bg-card"}`}>
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${index < step ? "bg-emerald-500 text-white" : index === step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>
                {label}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
          {step === 0 && (
            <div className="space-y-5">
              <div><h2 className="text-xl font-semibold">Where should the app be published?</h2><p className="mt-1 text-sm text-muted-foreground">Select one store or both. Apple can be skipped completely.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <button onClick={() => togglePlatform("android")} className={`rounded-2xl border p-5 text-left transition ${platforms.includes("android") ? "border-primary bg-primary/10" : "hover:border-primary/40"}`}>
                  <div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-500/10 p-3"><Play className="h-6 w-6 text-emerald-500" /></div><div><div className="font-semibold">Google Play</div><div className="text-sm text-muted-foreground">Android app bundle</div></div></div>{platforms.includes("android") && <CheckCircle2 className="h-5 w-5 text-primary" />}</div>
                </button>
                <button onClick={() => togglePlatform("apple")} className={`rounded-2xl border p-5 text-left transition ${platforms.includes("apple") ? "border-primary bg-primary/10" : "hover:border-primary/40"}`}>
                  <div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="rounded-xl bg-foreground/5 p-3"><Apple className="h-6 w-6" /></div><div><div className="font-semibold">Apple App Store</div><div className="text-sm text-muted-foreground">iPhone and iPad</div></div></div>{platforms.includes("apple") && <CheckCircle2 className="h-5 w-5 text-primary" />}</div>
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div><h2 className="text-xl font-semibold">Choose the website</h2><p className="mt-1 text-sm text-muted-foreground">VIBA will use the live HTTPS website inside the mobile wrapper.</p></div>
              <div className="space-y-2"><label className="text-sm font-medium">Website URL</label><div className="relative"><Globe2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://yourwebsite.com" /></div></div>
              <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground"><ShieldCheck className="mr-2 inline h-4 w-4 text-emerald-500" />HTTPS is required for secure store distribution.</div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div><h2 className="text-xl font-semibold">App details</h2><p className="mt-1 text-sm text-muted-foreground">VIBA uses sensible defaults. These can be changed before publishing.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><label className="text-sm font-medium">App name</label><Input value={appName} onChange={(event) => setAppName(event.target.value)} /></div>
                <div className="space-y-2"><label className="text-sm font-medium">Bundle ID</label><Input value={bundleId} onChange={(event) => setBundleId(event.target.value)} /></div>
                <div className="space-y-2"><label className="text-sm font-medium">Version</label><Input value={version} onChange={(event) => setVersion(event.target.value)} /></div>
                <div className="space-y-2"><label className="text-sm font-medium">Build number</label><Input type="number" min={1} value={buildNumber} onChange={(event) => setBuildNumber(Math.max(1, Number(event.target.value) || 1))} /></div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-semibold">Store readiness review</h2><p className="mt-1 text-sm text-muted-foreground">VIBA checked the information required to begin the build.</p></div><div className="flex h-20 w-20 items-center justify-center rounded-full border-8 border-primary/15 text-2xl font-bold">{score ?? 0}%</div></div>
              {issues.length === 0 ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-600"><CheckCircle2 className="mr-2 inline h-4 w-4" />Everything required to start the build is ready.</div> : <div className="space-y-2">{issues.map((issue, index) => <div key={`${issue.field}-${index}`} className={`rounded-xl border p-4 text-sm ${issue.severity === "error" ? "border-red-500/30 bg-red-500/10" : "border-amber-500/30 bg-amber-500/10"}`}><strong className="capitalize">{issue.field}:</strong> {issue.message}</div>)}</div>}
              <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border p-4"><Store className="mb-2 h-5 w-5 text-primary" /><div className="font-medium">Stores</div><div className="text-sm text-muted-foreground">{platforms.map((p) => p === "android" ? "Google Play" : "Apple").join(" + ")}</div></div><div className="rounded-xl border p-4"><Smartphone className="mb-2 h-5 w-5 text-primary" /><div className="font-medium">App</div><div className="text-sm text-muted-foreground">{appName} · {version}</div></div><div className="rounded-xl border p-4"><Globe2 className="mb-2 h-5 w-5 text-primary" /><div className="font-medium">Website</div><div className="truncate text-sm text-muted-foreground">{websiteUrl}</div></div></div>
            </div>
          )}

          {step === 4 && (
            <div className="py-8 text-center"><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10"><CheckCircle2 className="h-8 w-8 text-emerald-500" /></div><h2 className="text-2xl font-semibold">{published ? "Build started" : "Ready to publish"}</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">VIBA has queued the selected store build. Store account verification and final legal approvals remain controlled by Google and Apple.</p></div>
          )}

          <div className="mt-7 flex items-center justify-between border-t pt-5">
            <Button variant="outline" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || loading}><ChevronLeft className="mr-2 h-4 w-4" />Back</Button>
            {step < 2 && <Button onClick={() => setStep((current) => current + 1)} disabled={!canContinue || loading}>Continue<ChevronRight className="ml-2 h-4 w-4" /></Button>}
            {step === 2 && <Button onClick={validate} disabled={!canContinue || loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WandSparkles className="mr-2 h-4 w-4" />}Review everything</Button>}
            {step === 3 && <Button onClick={publish} disabled={loading || issues.some((issue) => issue.severity === "error")}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}Publish app</Button>}
            {step === 4 && <Button onClick={() => { setStep(0); setPublished(false); setIssues([]); setScore(null); }}>Publish another app</Button>}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
