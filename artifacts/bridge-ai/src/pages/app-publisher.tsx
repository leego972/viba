import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
type PublisherInput = {
  platforms: Platform[];
  websiteUrl: string;
  appName: string;
  bundleId: string;
  version: string;
  buildNumber: number;
};
type ValidationResponse = {
  ok: boolean;
  score: number;
  issues: Issue[];
  input?: PublisherInput;
  infrastructureVerified?: boolean;
  message?: string;
};

type LoadingAction = "validate" | "publish" | null;

const STEPS = ["Stores", "Website", "App details", "Review", "Publish"];
const BUNDLE_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?){1,5}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

async function responseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) throw new Error(`The server returned an empty response (${response.status}).`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`The server returned an unreadable response (${response.status}).`);
  }
}

function publicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".");
  } catch {
    return false;
  }
}

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
  const [infrastructureVerified, setInfrastructureVerified] = useState(false);
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [published, setPublished] = useState(false);

  const canContinue = useMemo(() => {
    if (step === 0) return platforms.length > 0;
    if (step === 1) return publicHttpsUrl(websiteUrl);
    if (step === 2) {
      return (
        appName.trim().length >= 2 &&
        appName.trim().length <= 50 &&
        BUNDLE_PATTERN.test(bundleId.trim().toLowerCase()) &&
        VERSION_PATTERN.test(version.trim()) &&
        Number.isInteger(buildNumber) &&
        buildNumber > 0
      );
    }
    return true;
  }, [appName, buildNumber, bundleId, platforms.length, step, version, websiteUrl]);

  function togglePlatform(platform: Platform) {
    setPlatforms((current) =>
      current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform],
    );
  }

  function applyValidation(data: ValidationResponse) {
    setIssues(Array.isArray(data.issues) ? data.issues : []);
    setScore(typeof data.score === "number" ? data.score : 0);
    setInfrastructureVerified(data.infrastructureVerified === true);
    if (data.input) {
      setPlatforms(data.input.platforms);
      setWebsiteUrl(data.input.websiteUrl);
      setAppName(data.input.appName);
      setBundleId(data.input.bundleId);
      setVersion(data.input.version);
      setBuildNumber(data.input.buildNumber || 1);
    }
    setStep(3);
  }

  async function validate() {
    setLoadingAction("validate");
    try {
      const response = await fetch(`${BASE}/api/app-publisher/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ platforms, websiteUrl, appName, bundleId, version, buildNumber }),
      });
      const data = await responseJson<ValidationResponse>(response);
      if (Array.isArray(data.issues)) {
        applyValidation(data);
        return;
      }
      throw new Error(data.message || `Readiness check failed (${response.status}).`);
    } catch (error) {
      toast({
        title: "Validation failed",
        description: error instanceof Error ? error.message : "VIBA could not complete the store readiness check.",
        variant: "destructive",
      });
    } finally {
      setLoadingAction(null);
    }
  }

  async function publish() {
    setLoadingAction("publish");
    try {
      const response = await fetch(`${BASE}/api/app-publisher/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ platforms, websiteUrl, appName, bundleId, version, buildNumber }),
      });
      const data = await responseJson<ValidationResponse & { status?: string }>(response);
      if (!response.ok) {
        if (Array.isArray(data.issues)) applyValidation(data);
        throw new Error(data.message || "Publishing could not start.");
      }
      setPublished(true);
      setStep(4);
      toast({ title: "Build queued", description: data.message || "VIBA has started preparing your app." });
    } catch (error) {
      toast({
        title: "Publishing unavailable",
        description: error instanceof Error ? error.message : "Publishing could not start.",
        variant: "destructive",
      });
    } finally {
      setLoadingAction(null);
    }
  }

  function resetPublisher() {
    setStep(0);
    setPublished(false);
    setIssues([]);
    setScore(null);
    setInfrastructureVerified(false);
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  const hasWarnings = issues.some((issue) => issue.severity === "warning");
  const loading = loadingAction !== null;

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge variant="outline" className="mb-3 gap-1.5"><Rocket className="h-3.5 w-3.5" /> App Publisher</Badge>
            <h1 className="text-3xl font-semibold tracking-tight">Publish your website as an app</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Choose the stores, verify the website and app identity, then start a signed native build.</p>
          </div>
          <div className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
            VIBA runs the build tooling after GitHub and store signing are verified.
          </div>
        </div>

        <div className="grid grid-cols-5 gap-1.5 sm:gap-2" aria-label="Publishing progress">
          {STEPS.map((label, index) => (
            <div key={label} className={`min-w-0 rounded-lg border px-1.5 py-2 sm:rounded-xl sm:px-3 sm:py-3 ${index === step ? "border-primary bg-primary/10" : index < step ? "border-emerald-500/30 bg-emerald-500/5" : "bg-card"}`}>
              <div className="flex items-center justify-center gap-2 text-sm font-medium sm:justify-start">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${index < step ? "bg-emerald-500 text-white" : index === step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>
                <span className="hidden truncate sm:inline">{label}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
          {step === 0 && (
            <div className="space-y-5">
              <div><h2 className="text-xl font-semibold">Where should the app be published?</h2><p className="mt-1 text-sm text-muted-foreground">Select Google Play, Apple App Store, or both.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <button type="button" aria-pressed={platforms.includes("android")} onClick={() => togglePlatform("android")} className={`rounded-2xl border p-5 text-left transition ${platforms.includes("android") ? "border-primary bg-primary/10" : "hover:border-primary/40"}`}>
                  <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-500/10 p-3"><Play className="h-6 w-6 text-emerald-500" /></div><div><div className="font-semibold">Google Play</div><div className="text-sm text-muted-foreground">Signed Android app bundle</div></div></div>{platforms.includes("android") && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />}</div>
                </button>
                <button type="button" aria-pressed={platforms.includes("apple")} onClick={() => togglePlatform("apple")} className={`rounded-2xl border p-5 text-left transition ${platforms.includes("apple") ? "border-primary bg-primary/10" : "hover:border-primary/40"}`}>
                  <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-xl bg-foreground/5 p-3"><Apple className="h-6 w-6" /></div><div><div className="font-semibold">Apple App Store</div><div className="text-sm text-muted-foreground">Signed iPhone and iPad archive</div></div></div>{platforms.includes("apple") && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />}</div>
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div><h2 className="text-xl font-semibold">Choose the website</h2><p className="mt-1 text-sm text-muted-foreground">The native wrapper will securely load this public HTTPS website.</p></div>
              <div className="space-y-2"><label htmlFor="publisher-website" className="text-sm font-medium">Website URL</label><div className="relative"><Globe2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="publisher-website" inputMode="url" autoCapitalize="none" autoCorrect="off" className="pl-9" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://yourwebsite.com" /></div></div>
              <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground"><ShieldCheck className="mr-2 inline h-4 w-4 text-emerald-500" />Localhost, private-network addresses and insecure HTTP URLs are rejected.</div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div><h2 className="text-xl font-semibold">App details</h2><p className="mt-1 text-sm text-muted-foreground">These values are applied to the generated Android and Apple builds.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><label htmlFor="publisher-name" className="text-sm font-medium">App name</label><Input id="publisher-name" maxLength={50} value={appName} onChange={(event) => setAppName(event.target.value)} /></div>
                <div className="space-y-2"><label htmlFor="publisher-bundle" className="text-sm font-medium">Bundle ID</label><Input id="publisher-bundle" autoCapitalize="none" autoCorrect="off" value={bundleId} onChange={(event) => setBundleId(event.target.value.toLowerCase())} placeholder="com.company.app" /></div>
                <div className="space-y-2"><label htmlFor="publisher-version" className="text-sm font-medium">Version</label><Input id="publisher-version" inputMode="numeric" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.0" /></div>
                <div className="space-y-2"><label htmlFor="publisher-build" className="text-sm font-medium">Build number</label><Input id="publisher-build" type="number" min={1} max={2100000000} value={buildNumber} onChange={(event) => setBuildNumber(Math.max(1, Number(event.target.value) || 1))} /></div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-semibold">Store readiness review</h2><p className="mt-1 text-sm text-muted-foreground">VIBA checked the app metadata, workflow access and signing configuration.</p></div><div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-8 border-primary/15 text-2xl font-bold">{score ?? 0}%</div></div>
              {issues.length === 0 ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-600"><CheckCircle2 className="mr-2 inline h-4 w-4" />The build request and publishing infrastructure are verified.</div>
              ) : (
                <div className="space-y-2">{issues.map((issue, index) => <div key={`${issue.field}-${index}`} role={issue.severity === "error" ? "alert" : undefined} className={`rounded-xl border p-4 text-sm ${issue.severity === "error" ? "border-red-500/30 bg-red-500/10" : "border-amber-500/30 bg-amber-500/10"}`}><strong className="capitalize">{issue.field}:</strong> {issue.message}</div>)}</div>
              )}
              <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border p-4"><Store className="mb-2 h-5 w-5 text-primary" /><div className="font-medium">Stores</div><div className="text-sm text-muted-foreground">{platforms.map((platform) => platform === "android" ? "Google Play" : "Apple").join(" + ")}</div></div><div className="rounded-xl border p-4"><Smartphone className="mb-2 h-5 w-5 text-primary" /><div className="font-medium">App</div><div className="break-words text-sm text-muted-foreground">{appName} · {version} ({buildNumber})</div></div><div className="rounded-xl border p-4"><Globe2 className="mb-2 h-5 w-5 text-primary" /><div className="font-medium">Website</div><div className="break-all text-sm text-muted-foreground">{websiteUrl}</div></div></div>
              <p className="text-xs text-muted-foreground">Automation status: {infrastructureVerified ? "verified" : hasWarnings ? "partially verified" : "not verified"}.</p>
            </div>
          )}

          {step === 4 && (
            <div className="py-8 text-center"><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10"><CheckCircle2 className="h-8 w-8 text-emerald-500" /></div><h2 className="text-2xl font-semibold">{published ? "Build queued" : "Ready to publish"}</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">VIBA queued the selected signed build. Google and Apple still control store-account review and final publication approval.</p></div>
          )}

          <div className="mt-7 flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || loading}><ChevronLeft className="mr-2 h-4 w-4" />Back</Button>
            <div className="flex justify-end">
              {step < 2 && <Button type="button" onClick={() => setStep((current) => current + 1)} disabled={!canContinue || loading}>Continue<ChevronRight className="ml-2 h-4 w-4" /></Button>}
              {step === 2 && <Button type="button" onClick={validate} disabled={!canContinue || loading}>{loadingAction === "validate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WandSparkles className="mr-2 h-4 w-4" />}Review everything</Button>}
              {step === 3 && <Button type="button" onClick={publish} disabled={loading || hasErrors}>{loadingAction === "publish" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}Publish app</Button>}
              {step === 4 && <Button type="button" onClick={resetPublisher}>Publish another app</Button>}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
