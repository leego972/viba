import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Apple, Check, CheckCircle2, ChevronLeft, ChevronRight, Github, Globe2,
  KeyRound, Loader2, Play, Rocket, Save, ShieldCheck, Smartphone, Store,
  WandSparkles,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const GITHUB_CONFIG_KEY = "viba.appPublisher.githubConfig.v1";

type Platform = "android" | "apple";
type Issue = { field: string; message: string; severity: "error" | "warning" };
type PublisherInput = {
  platforms: Platform[];
  websiteUrl: string;
  appName: string;
  bundleId: string;
  version: string;
  buildNumber: number;
  githubRepository: string;
  githubRef: string;
  githubWorkflow: string;
};
type ValidationResponse = {
  ok: boolean;
  score: number;
  issues: Issue[];
  input?: PublisherInput;
  infrastructureVerified?: boolean;
  message?: string;
};
type LoadingAction = "save" | "validate" | "publish" | null;
type SavedGithubConfig = {
  repository: string;
  ref: string;
  workflow: string;
  savedAt: string;
};

const STEPS = ["Stores", "Website", "App details", "Review", "Publish"];
const BUNDLE_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?){1,5}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF_PATTERN = /^[A-Za-z0-9._/-]+$/;
const WORKFLOW_PATTERN = /^[A-Za-z0-9_.-]+\.(?:yml|yaml)$/;

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

function readSavedGithubConfig(): SavedGithubConfig | null {
  try {
    const raw = window.localStorage.getItem(GITHUB_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedGithubConfig>;
    if (
      typeof parsed.repository !== "string" ||
      typeof parsed.ref !== "string" ||
      typeof parsed.workflow !== "string" ||
      typeof parsed.savedAt !== "string"
    ) return null;
    return parsed as SavedGithubConfig;
  } catch {
    return null;
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
  const [githubToken, setGithubToken] = useState("");
  const [githubTokenSaved, setGithubTokenSaved] = useState(false);
  const [githubRepository, setGithubRepository] = useState("leego972/viba");
  const [githubRef, setGithubRef] = useState("main");
  const [githubWorkflow, setGithubWorkflow] = useState("mobile-store-build.yml");
  const [savedGithubConfig, setSavedGithubConfig] = useState<SavedGithubConfig | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [infrastructureVerified, setInfrastructureVerified] = useState(false);
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [published, setPublished] = useState(false);

  useEffect(() => {
    const saved = readSavedGithubConfig();
    if (!saved) return;
    setSavedGithubConfig(saved);
    setGithubRepository(saved.repository);
    setGithubRef(saved.ref);
    setGithubWorkflow(saved.workflow);
    setGithubTokenSaved(true);
  }, []);

  const githubFieldsValid = useMemo(
    () =>
      REPOSITORY_PATTERN.test(githubRepository.trim()) &&
      REF_PATTERN.test(githubRef.trim()) &&
      !githubRef.includes("..") &&
      WORKFLOW_PATTERN.test(githubWorkflow.trim()),
    [githubRef, githubRepository, githubWorkflow],
  );

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
        buildNumber > 0 &&
        (githubTokenSaved || githubToken.trim().length >= 20) &&
        githubFieldsValid
      );
    }
    return true;
  }, [
    appName, buildNumber, bundleId, githubFieldsValid, githubToken,
    githubTokenSaved, platforms.length, step, version, websiteUrl,
  ]);

  function togglePlatform(platform: Platform) {
    setPlatforms((current) =>
      current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform],
    );
  }

  function publisherBody(includeToken: boolean) {
    return {
      platforms,
      websiteUrl,
      appName,
      bundleId,
      version,
      buildNumber,
      githubRepository,
      githubRef,
      githubWorkflow,
      ...(includeToken && githubToken.trim() ? { githubToken: githubToken.trim() } : {}),
    };
  }

  function persistGithubConfig() {
    const saved: SavedGithubConfig = {
      repository: githubRepository.trim(),
      ref: githubRef.trim(),
      workflow: githubWorkflow.trim(),
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(saved));
    setSavedGithubConfig(saved);
  }

  function applyValidation(data: ValidationResponse, moveToReview = true) {
    const nextIssues = Array.isArray(data.issues) ? data.issues : [];
    setIssues(nextIssues);
    setScore(typeof data.score === "number" ? data.score : 0);
    setInfrastructureVerified(data.infrastructureVerified === true);
    if (!nextIssues.some((issue) => issue.field === "githubToken")) {
      setGithubTokenSaved(true);
      setGithubToken("");
    }
    if (data.input) {
      setPlatforms(data.input.platforms);
      setWebsiteUrl(data.input.websiteUrl);
      setAppName(data.input.appName);
      setBundleId(data.input.bundleId);
      setVersion(data.input.version);
      setBuildNumber(data.input.buildNumber || 1);
      setGithubRepository(data.input.githubRepository);
      setGithubRef(data.input.githubRef);
      setGithubWorkflow(data.input.githubWorkflow);
    }
    if (moveToReview) setStep(3);
  }

  async function saveGithubConnection() {
    if (!githubFieldsValid || (!githubTokenSaved && githubToken.trim().length < 20)) {
      toast({
        title: "GitHub details incomplete",
        description: "Enter a valid PAT, repository, branch and workflow filename.",
        variant: "destructive",
      });
      return;
    }

    setLoadingAction("save");
    try {
      const response = await fetch(`${BASE}/api/app-publisher/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(publisherBody(true)),
      });
      const data = await responseJson<ValidationResponse>(response);
      const blockingConnectionIssue = (data.issues ?? []).find((issue) =>
        ["githubToken", "githubRepository", "githubRef", "githubWorkflow", "automation"].includes(issue.field),
      );

      if (blockingConnectionIssue) {
        applyValidation(data, false);
        throw new Error(blockingConnectionIssue.message);
      }

      applyValidation(data, false);
      persistGithubConfig();
      setGithubTokenSaved(true);
      setGithubToken("");
      toast({
        title: "GitHub connection saved",
        description: `${githubRepository.trim()} · ${githubRef.trim()} · ${githubWorkflow.trim()}`,
      });
    } catch (error) {
      toast({
        title: "Could not save GitHub connection",
        description: error instanceof Error ? error.message : "VIBA could not validate and save these GitHub credentials.",
        variant: "destructive",
      });
    } finally {
      setLoadingAction(null);
    }
  }

  async function validate() {
    setLoadingAction("validate");
    try {
      const response = await fetch(`${BASE}/api/app-publisher/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(publisherBody(true)),
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
        body: JSON.stringify(publisherBody(false)),
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
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Choose the stores, enter your GitHub connection and start a signed native build.</p>
          </div>
          <div className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
            Your GitHub PAT is encrypted after validation and is never displayed again.
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
            <div className="space-y-6">
              <div><h2 className="text-xl font-semibold">App and GitHub details</h2><p className="mt-1 text-sm text-muted-foreground">VIBA uses your repository workflow to build the native app.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><label htmlFor="publisher-name" className="text-sm font-medium">App name</label><Input id="publisher-name" maxLength={50} value={appName} onChange={(event) => setAppName(event.target.value)} /></div>
                <div className="space-y-2"><label htmlFor="publisher-bundle" className="text-sm font-medium">Bundle ID</label><Input id="publisher-bundle" autoCapitalize="none" autoCorrect="off" value={bundleId} onChange={(event) => setBundleId(event.target.value.toLowerCase())} placeholder="com.company.app" /></div>
                <div className="space-y-2"><label htmlFor="publisher-version" className="text-sm font-medium">Version</label><Input id="publisher-version" inputMode="numeric" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.0" /></div>
                <div className="space-y-2"><label htmlFor="publisher-build" className="text-sm font-medium">Build number</label><Input id="publisher-build" type="number" min={1} max={2100000000} value={buildNumber} onChange={(event) => setBuildNumber(Math.max(1, Number(event.target.value) || 1))} /></div>
              </div>

              <div className="rounded-2xl border bg-muted/20 p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2"><Github className="h-5 w-5" /><h3 className="font-semibold">GitHub build connection</h3></div>
                  {githubTokenSaved && (
                    <Badge variant="outline" className="border-emerald-500/30 text-emerald-600">
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Saved
                    </Badge>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <label htmlFor="publisher-github-token" className="text-sm font-medium">GitHub personal access token</label>
                    <div className="relative"><KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="publisher-github-token" type="password" autoCapitalize="none" autoCorrect="off" autoComplete="new-password" className="pl-9" value={githubToken} onChange={(event) => { setGithubToken(event.target.value); setGithubTokenSaved(false); }} placeholder={githubTokenSaved ? "PAT saved securely — enter a new PAT to replace it" : "github_pat_... or ghp_..."} /></div>
                    <p className="text-xs text-muted-foreground">The PAT must access this repository and allow GitHub Actions workflow dispatch. It is encrypted server-side.</p>
                  </div>
                  <div className="space-y-2"><label htmlFor="publisher-github-repo" className="text-sm font-medium">Repository</label><Input id="publisher-github-repo" autoCapitalize="none" autoCorrect="off" value={githubRepository} onChange={(event) => { setGithubRepository(event.target.value.trim()); setGithubTokenSaved(false); }} placeholder="owner/repo" /></div>
                  <div className="space-y-2"><label htmlFor="publisher-github-ref" className="text-sm font-medium">Branch or tag</label><Input id="publisher-github-ref" autoCapitalize="none" autoCorrect="off" value={githubRef} onChange={(event) => { setGithubRef(event.target.value.trim()); setGithubTokenSaved(false); }} placeholder="main" /></div>
                  <div className="space-y-2 sm:col-span-2"><label htmlFor="publisher-github-workflow" className="text-sm font-medium">Workflow filename</label><Input id="publisher-github-workflow" autoCapitalize="none" autoCorrect="off" value={githubWorkflow} onChange={(event) => { setGithubWorkflow(event.target.value.trim()); setGithubTokenSaved(false); }} placeholder="mobile-store-build.yml" /></div>
                </div>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">
                    {savedGithubConfig ? `Last saved ${new Date(savedGithubConfig.savedAt).toLocaleString()}` : "Not saved yet"}
                  </p>
                  <Button type="button" variant="outline" onClick={saveGithubConnection} disabled={loading || !githubFieldsValid || (!githubTokenSaved && githubToken.trim().length < 20)}>
                    {loadingAction === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save GitHub connection
                  </Button>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-semibold">Store readiness review</h2><p className="mt-1 text-sm text-muted-foreground">VIBA checked the app metadata, repository workflow access and signing configuration.</p></div><div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-8 border-primary/15 text-2xl font-bold">{score ?? 0}%</div></div>
              {issues.length === 0 ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-600"><CheckCircle2 className="mr-2 inline h-4 w-4" />The GitHub connection and publishing infrastructure are verified.</div>
              ) : (
                <div className="space-y-2">{issues.map((issue, index) => <div key={`${issue.field}-${index}`} role={issue.severity === "error" ? "alert" : undefined} className={`min-w-0 break-words [overflow-wrap:anywhere] rounded-xl border p-4 text-sm ${issue.severity === "error" ? "border-red-500/30 bg-red-500/10" : "border-amber-500/30 bg-amber-500/10"}`}><strong className="capitalize">{issue.field}:</strong> {issue.message}</div>)}</div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-xl border p-4"><Store className="mb-2 h-5 w-5 text-primary" /><div className="font-medium">Stores</div><div className="text-sm text-muted-foreground">{platforms.map((platform) => platform === "android" ? "Google Play" : "Apple").join(" + ")}</div></div><div className="rounded-xl border p-4"><Smartphone className="mb-2 h-5 w-5 text-primary" /><div className="font-medium">App</div><div className="break-words text-sm text-muted-foreground">{appName} · {version} ({buildNumber})</div></div><div className="rounded-xl border p-4"><Globe2 className="mb-2 h-5 w-5 text-primary" /><div className="font-medium">Website</div><div className="break-all text-sm text-muted-foreground">{websiteUrl}</div></div><div className="rounded-xl border p-4"><Github className="mb-2 h-5 w-5 text-primary" /><div className="font-medium">GitHub</div><div className="break-all text-sm text-muted-foreground">{githubRepository} · {githubRef}<br />{githubWorkflow}</div></div></div>
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
              {step === 2 && <Button type="button" onClick={validate} disabled={!canContinue || loading}>{loadingAction === "validate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WandSparkles className="mr-2 h-4 w-4" />}Validate GitHub and review</Button>}
              {step === 3 && <Button type="button" onClick={publish} disabled={loading || hasErrors}>{loadingAction === "publish" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}Publish app</Button>}
              {step === 4 && <Button type="button" onClick={resetPublisher}>Publish another app</Button>}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
