import { useState, useCallback, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Apple, CheckCircle2, XCircle, Clock, ShieldCheck, KeyRound,
  Rocket, RefreshCw, Trash2, Loader2, FileCode2, Smartphone, ChevronRight,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppStoreStatus {
  appleConfigured: boolean;
  expoConfigured: boolean;
  missing: string[];
}

interface AscApp {
  id: string;
  bundleId: string;
  name: string;
  sku: string | null;
}

interface AscVersion {
  id: string;
  versionString: string;
  appStoreState: string;
  createdDate: string | null;
}

interface PipelineStep {
  step: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  detail: string;
  at: string;
}

interface BuildPlan {
  command: string;
  envVars: string[];
  githubWorkflowYaml: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stepIcon(status: string) {
  switch (status) {
    case "passed": return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    case "failed": return <XCircle className="h-4 w-4 text-red-400" />;
    case "skipped": return <Clock className="h-4 w-4 text-white/30" />;
    default: return <Loader2 className="h-4 w-4 animate-spin text-blue-400" />;
  }
}

function stateBadge(state: string): string {
  if (state === "READY_FOR_SALE") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (state.includes("REJECT") || state === "INVALID_BINARY") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (state === "PREPARE_FOR_SUBMISSION") return "bg-blue-500/15 text-blue-400 border-blue-500/30";
  if (state.includes("REVIEW")) return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  return "bg-white/10 text-white/40 border-white/20";
}

const STEP_LABELS: Record<string, string> = {
  verify_credentials: "Verify Apple credentials",
  resolve_version: "Resolve App Store version",
  update_metadata: "Update listing metadata",
  attach_build: "Attach latest build",
  submit_for_review: "Submit for App Review",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AppStoreDeploymentPage() {
  const { toast } = useToast();

  // Status
  const [status, setStatus] = useState<AppStoreStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Credentials form
  const [p8Key, setP8Key] = useState("");
  const [keyId, setKeyId] = useState("");
  const [issuerId, setIssuerId] = useState("");
  const [expoToken, setExpoToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);

  // Apps & versions
  const [apps, setApps] = useState<AscApp[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [selectedApp, setSelectedApp] = useState<AscApp | null>(null);
  const [versions, setVersions] = useState<AscVersion[]>([]);

  // Ship form
  const [versionString, setVersionString] = useState("");
  const [whatsNew, setWhatsNew] = useState("");
  const [description, setDescription] = useState("");
  const [attachBuild, setAttachBuild] = useState(true);
  const [submitReview, setSubmitReview] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([]);

  // Build plan
  const [repoUrl, setRepoUrl] = useState("");
  const [appDir, setAppDir] = useState("");
  const [buildPlan, setBuildPlan] = useState<BuildPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch(`${BASE}/api/appstore/status`);
      if (res.ok) {
        const data = await res.json();
        setStatus({ appleConfigured: data.appleConfigured, expoConfigured: data.expoConfigured, missing: data.missing ?? [] });
      }
    } catch { /* network error — leave status null */ }
    setLoadingStatus(false);
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const saveCredentials = useCallback(async () => {
    if (!p8Key && !keyId && !issuerId && !expoToken) {
      toast({ title: "Nothing to save", description: "Fill in at least one credential field.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/appstore/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p8Key: p8Key || undefined, keyId: keyId || undefined, issuerId: issuerId || undefined, expoToken: expoToken || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Could not save", description: data.error ?? "Unknown error", variant: "destructive" });
      } else {
        toast({ title: "Credentials saved", description: "Stored encrypted in the VIBA vault." });
        setP8Key(""); setKeyId(""); setIssuerId(""); setExpoToken("");
        void loadStatus();
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    }
    setSaving(false);
  }, [p8Key, keyId, issuerId, expoToken, toast, loadStatus]);

  const verifyCredentials = useCallback(async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch(`${BASE}/api/appstore/verify`, { method: "POST" });
      const data = await res.json();
      if (data.apple?.ok) {
        const expoNote = data.expo ? (data.expo.ok ? ` Expo token valid (${data.expo.username}).` : ` Expo token invalid: ${data.expo.error}`) : "";
        setVerifyResult(`Connected to App Store Connect — ${data.apple.appsCount} app(s) visible.${expoNote}`);
        toast({ title: "Verified", description: "Apple credentials are working." });
      } else {
        const msg = data.apple?.error ?? (data.missing?.length ? `Missing: ${data.missing.join(", ")}` : "Verification failed");
        setVerifyResult(`Failed: ${msg}`);
        toast({ title: "Verification failed", description: msg, variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    }
    setVerifying(false);
  }, [toast]);

  const deleteCredentials = useCallback(async () => {
    if (!window.confirm("Remove all stored Apple / Expo credentials from the vault?")) return;
    await fetch(`${BASE}/api/appstore/credentials`, { method: "DELETE" });
    toast({ title: "Credentials removed" });
    setApps([]); setSelectedApp(null); setVersions([]); setVerifyResult(null);
    void loadStatus();
  }, [toast, loadStatus]);

  const loadApps = useCallback(async () => {
    setLoadingApps(true);
    try {
      const res = await fetch(`${BASE}/api/appstore/apps`);
      const data = await res.json();
      if (res.ok) {
        setApps(data.apps ?? []);
        if ((data.apps ?? []).length === 0) toast({ title: "No apps found", description: "Create the app record in App Store Connect first." });
      } else {
        toast({ title: "Could not load apps", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    }
    setLoadingApps(false);
  }, [toast]);

  const selectApp = useCallback(async (app: AscApp) => {
    setSelectedApp(app);
    setPipelineSteps([]);
    try {
      const res = await fetch(`${BASE}/api/appstore/apps/${encodeURIComponent(app.id)}/versions`);
      const data = await res.json();
      if (res.ok) setVersions(data.versions ?? []);
    } catch { /* ignore */ }
  }, []);

  const runShip = useCallback(async () => {
    if (!selectedApp) return;
    setShipping(true);
    setPipelineSteps([]);
    try {
      const res = await fetch(`${BASE}/api/appstore/ship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId: selectedApp.id,
          versionString: versionString || undefined,
          metadata: { whatsNew: whatsNew || undefined, description: description || undefined },
          attachBuild,
          submit: submitReview,
          confirm: true,
        }),
      });
      const data = await res.json();
      setPipelineSteps(data.steps ?? []);
      if (data.ok) {
        toast({ title: "Pipeline completed", description: submitReview ? "Submitted for App Review." : "Steps completed." });
        void selectApp(selectedApp);
      } else {
        const lastFail = (data.steps ?? []).find((s: PipelineStep) => s.status === "failed");
        toast({ title: "Pipeline stopped", description: lastFail?.detail ?? data.error ?? "See step details.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    }
    setShipping(false);
  }, [selectedApp, versionString, whatsNew, description, attachBuild, submitReview, toast, selectApp]);

  const generatePlan = useCallback(async () => {
    if (!repoUrl) {
      toast({ title: "Repo URL required", variant: "destructive" });
      return;
    }
    setPlanLoading(true);
    setBuildPlan(null);
    try {
      const res = await fetch(`${BASE}/api/appstore/build-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, appDir: appDir || ".", ascAppId: selectedApp?.id ?? null, autoSubmit: true }),
      });
      const data = await res.json();
      if (res.ok) setBuildPlan(data.plan);
      else toast({ title: "Could not generate plan", description: data.error, variant: "destructive" });
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    }
    setPlanLoading(false);
  }, [repoUrl, appDir, selectedApp, toast]);

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-white/5 border border-white/10">
              <Apple className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Ship to App Store</h1>
              <p className="text-sm text-white/50">Automated iOS deployment via App Store Connect API — no 2FA, no Mac required.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadStatus()} disabled={loadingStatus}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loadingStatus ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {/* Status pills */}
        <div className="flex gap-2 flex-wrap">
          <Badge className={status?.appleConfigured ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-white/10 text-white/40 border-white/20"}>
            <ShieldCheck className="h-3 w-3 mr-1" /> Apple API {status?.appleConfigured ? "connected" : "not configured"}
          </Badge>
          <Badge className={status?.expoConfigured ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-white/10 text-white/40 border-white/20"}>
            <Smartphone className="h-3 w-3 mr-1" /> Expo {status?.expoConfigured ? "connected" : "not configured"}
          </Badge>
        </div>

        {/* Step 1 — Credentials */}
        <Card className="bg-white/[0.02] border-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" /> Step 1 — Apple &amp; Expo credentials
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-white/50">
              Create an API key in App Store Connect → Users and Access → Integrations → App Store Connect API.
              Download the .p8 file once, then paste its contents below. Keys are encrypted (AES-256-GCM) in the VIBA vault and never shown again.
            </p>
            <Textarea
              placeholder="-----BEGIN PRIVATE KEY-----  (paste your .p8 file contents)"
              value={p8Key}
              onChange={(e) => setP8Key(e.target.value)}
              rows={4}
              className="font-mono text-xs"
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input placeholder="Key ID (e.g. 2WG5YUFL55)" value={keyId} onChange={(e) => setKeyId(e.target.value)} />
              <Input placeholder="Issuer ID (UUID)" value={issuerId} onChange={(e) => setIssuerId(e.target.value)} />
              <Input placeholder="Expo access token (optional)" value={expoToken} onChange={(e) => setExpoToken(e.target.value)} type="password" />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={() => void saveCredentials()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1" />} Save to vault
              </Button>
              <Button variant="outline" onClick={() => void verifyCredentials()} disabled={verifying || !status?.appleConfigured}>
                {verifying ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />} Verify connection
              </Button>
              {status?.appleConfigured && (
                <Button variant="ghost" className="text-red-400" onClick={() => void deleteCredentials()}>
                  <Trash2 className="h-4 w-4 mr-1" /> Remove
                </Button>
              )}
            </div>
            {verifyResult && (
              <p className={`text-sm ${verifyResult.startsWith("Failed") ? "text-red-400" : "text-emerald-400"}`}>{verifyResult}</p>
            )}
          </CardContent>
        </Card>

        {/* Step 2 — Pick app */}
        <Card className="bg-white/[0.02] border-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Smartphone className="h-4 w-4" /> Step 2 — Choose your app
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" onClick={() => void loadApps()} disabled={loadingApps || !status?.appleConfigured}>
              {loadingApps ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />} Load my apps
            </Button>
            {apps.length > 0 && (
              <div className="space-y-2">
                {apps.map((app) => (
                  <button
                    key={app.id}
                    onClick={() => void selectApp(app)}
                    className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                      selectedApp?.id === app.id ? "border-blue-500/50 bg-blue-500/10" : "border-white/10 bg-white/[0.02] hover:bg-white/5"
                    }`}
                  >
                    <div>
                      <div className="font-medium">{app.name}</div>
                      <div className="text-xs text-white/40">{app.bundleId}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-white/30" />
                  </button>
                ))}
              </div>
            )}
            {selectedApp && versions.length > 0 && (
              <div className="space-y-1 pt-2">
                <div className="text-xs uppercase tracking-wide text-white/40">Recent versions</div>
                {versions.slice(0, 5).map((v) => (
                  <div key={v.id} className="flex items-center gap-2 text-sm">
                    <span className="font-mono">{v.versionString}</span>
                    <Badge className={stateBadge(v.appStoreState)}>{v.appStoreState.replace(/_/g, " ").toLowerCase()}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 3 — Ship */}
        <Card className="bg-white/[0.02] border-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Rocket className="h-4 w-4" /> Step 3 — Ship it
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input placeholder="New version number (e.g. 1.0.1) — leave blank to use editable version" value={versionString} onChange={(e) => setVersionString(e.target.value)} />
            </div>
            <Textarea placeholder="What's new in this version (release notes shown to users)" value={whatsNew} onChange={(e) => setWhatsNew(e.target.value)} rows={2} />
            <Textarea placeholder="App description (optional — leave blank to keep current)" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={attachBuild} onChange={(e) => setAttachBuild(e.target.checked)} className="accent-blue-500" />
                Attach latest processed build
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={submitReview} onChange={(e) => setSubmitReview(e.target.checked)} className="accent-blue-500" />
                Submit for App Review
              </label>
            </div>
            <Button onClick={() => void runShip()} disabled={shipping || !selectedApp} className="bg-blue-600 hover:bg-blue-500">
              {shipping ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Rocket className="h-4 w-4 mr-1" />}
              {submitReview ? "Ship & submit for review" : "Run pipeline"}
            </Button>
            {pipelineSteps.length > 0 && (
              <div className="space-y-2 pt-2">
                {pipelineSteps.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    {stepIcon(s.status)}
                    <div>
                      <span className="font-medium">{STEP_LABELS[s.step] ?? s.step}</span>
                      <span className="text-white/50"> — {s.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Build plan */}
        <Card className="bg-white/[0.02] border-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileCode2 className="h-4 w-4" /> Need a fresh iOS build? Generate a zero-touch build plan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-white/50">
              Binaries are compiled by Expo EAS in the cloud. Generate a ready-to-commit GitHub Actions workflow that builds and auto-submits your app — no Mac, no Xcode, no interactive login.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input placeholder="GitHub repo URL" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
              <Input placeholder="App directory (e.g. apps/my-mobile-app)" value={appDir} onChange={(e) => setAppDir(e.target.value)} />
            </div>
            <Button variant="outline" onClick={() => void generatePlan()} disabled={planLoading}>
              {planLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileCode2 className="h-4 w-4 mr-1" />} Generate build plan
            </Button>
            {buildPlan && (
              <div className="space-y-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-white/40 mb-1">One-line command</div>
                  <pre className="p-3 rounded-lg bg-black/40 border border-white/10 text-xs overflow-x-auto">{buildPlan.command}</pre>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-white/40 mb-1">Required environment variables</div>
                  <pre className="p-3 rounded-lg bg-black/40 border border-white/10 text-xs overflow-x-auto">{buildPlan.envVars.join("\n")}</pre>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-white/40 mb-1">GitHub Actions workflow (.github/workflows/ship-ios.yml)</div>
                  <pre className="p-3 rounded-lg bg-black/40 border border-white/10 text-xs overflow-x-auto max-h-72">{buildPlan.githubWorkflowYaml}</pre>
                  <Button
                    variant="ghost" size="sm" className="mt-1"
                    onClick={() => { void navigator.clipboard.writeText(buildPlan.githubWorkflowYaml); toast({ title: "Copied workflow YAML" }); }}
                  >
                    Copy workflow
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
