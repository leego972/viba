import { useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, ClipboardCheck, Loader2, Play, ShieldCheck } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type AuthMethod = "none" | "password" | "google" | "github";

function cleanUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export default function UiAuditPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [targetUrl, setTargetUrl] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoBranch, setRepoBranch] = useState("main");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("none");
  const [username, setUsername] = useState("");
  const [passwordProvided, setPasswordProvided] = useState(false);
  const [notes, setNotes] = useState("");
  const [permission, setPermission] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function startAudit() {
    const url = cleanUrl(targetUrl);
    if (!url) {
      toast({ title: "Website URL required", variant: "destructive" });
      return;
    }
    if (!permission) {
      toast({ title: "Permission confirmation required", description: "Confirm you own or are authorized to test this website.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const authLine = authMethod === "none"
        ? "No login required."
        : authMethod === "password"
          ? `Login uses username/password. Username: ${username || "not supplied"}. Password was supplied in the intake UI and must be requested through the secure browser authorization flow; do not print, store, or expose it in reports.`
          : `Login uses ${authMethod === "google" ? "Google OAuth" : "GitHub OAuth"}. Pause for user authorization if the browser requires an account picker, 2FA, passkey, or consent screen.`;

      const goal = `Beta test my website UI via browser automation and repo comparison.\n\nTarget website: ${url}\nRepository: ${repoUrl.trim() || "not supplied"}\nBranch: ${repoBranch.trim() || "main"}\nAuthentication: ${authLine}\nExtra notes: ${notes.trim() || "none"}\n\nRequired report sections:\n1. Broken or missing UI elements, buttons, links, forms, pages, navigation, modals, and layout issues.\n2. Features/pages/components present in the repo but not connected to the live UI.\n3. Missing input places, missing buttons, missing confirmation states, and missing error states.\n4. Website flow logic: whether buttons lead to the correct pages and produce the intended output.\n5. Responsive/mobile Safari issues, horizontal overflow, obstructed menus, blocked scrolling, and visual overlap.\n6. Severity ranking: Critical, High, Medium, Low, Optional.\n7. Exact recommended fixes with file paths when the repository is available.\n\nUse available VIBA browser tools and repo tools. Do not perform destructive actions. Do not expose secrets in the report.`;

      const payload = {
        goal,
        autonomyMode: "supervised",
        repoUrl: repoUrl.trim() || undefined,
        repoBranch: repoBranch.trim() || undefined,
        workspaceEnv: "ui-beta-test",
        agents: [
          { name: "UI Browser Tester", provider: "groq", role: "Browser UI QA: click through flows, forms, mobile layout, and broken navigation", isMock: false, canUseTools: true },
          { name: "Repo Comparator", provider: "groq", role: "Compare live UI against repository routes, components, forms, and feature wiring", isMock: false, canUseTools: true },
          { name: "Report Writer", provider: "groq", role: "Produce severity-ranked final beta test report with exact fixes", isMock: false, canUseTools: false },
        ],
      };

      const res = await fetch(`${BASE}/api/sessions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({})) as { id?: number; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast({ title: "UI beta test session created", description: "Opening the agent workspace." });
      setLocation(`/sessions/${data.id}`);
    } catch (err) {
      toast({ title: "Could not start UI beta test", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <ClipboardCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Beta test my website UI</h1>
              <p className="text-sm text-muted-foreground">Create a VIBA browser/repo QA session for a complete UI report.</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Website intake</CardTitle>
            <CardDescription>VIBA will use available agents, browser tooling, and repo context to test live UI flow and report what is broken or missing.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label>Website URL</Label>
                <Input placeholder="https://example.com" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Repository URL</Label>
                <Input placeholder="https://github.com/owner/repo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Branch</Label>
                <Input placeholder="main" value={repoBranch} onChange={(e) => setRepoBranch(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Login method</Label>
                <Select value={authMethod} onValueChange={(value) => setAuthMethod(value as AuthMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No login required</SelectItem>
                    <SelectItem value="password">Username and password</SelectItem>
                    <SelectItem value="google">Google OAuth login</SelectItem>
                    <SelectItem value="github">GitHub OAuth login</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {authMethod === "password" && (
                <>
                  <div className="space-y-1.5">
                    <Label>Login username/email</Label>
                    <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Password handling</Label>
                    <button
                      type="button"
                      onClick={() => setPasswordProvided(!passwordProvided)}
                      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${passwordProvided ? "border-emerald-500/30 bg-emerald-500/10" : "border-border bg-background"}`}
                    >
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <span>
                        <span className="font-medium">Password will be requested during secure browser authorization.</span><br />
                        <span className="text-xs text-muted-foreground">To avoid storing secrets in a project prompt, VIBA will pause if login requires password/2FA/passkey.</span>
                      </span>
                    </button>
                  </div>
                </>
              )}
              <div className="space-y-1.5 md:col-span-2">
                <Label>Extra test notes</Label>
                <textarea
                  className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                  placeholder="Example: test checkout flow, dashboard nav, mobile menu, forms, file upload, Stripe flow, etc."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm">
              <input type="checkbox" className="mt-1" checked={permission} onChange={(e) => setPermission(e.target.checked)} />
              <span>
                <span className="font-medium text-amber-800">I own this website or have written authorization to test it.</span><br />
                <span className="text-xs text-muted-foreground">The audit is for UI, functional flow, repo/UI wiring, and non-destructive beta testing.</span>
              </span>
            </label>

            <div className="rounded-xl border border-border bg-background px-4 py-3 text-xs text-muted-foreground">
              <div className="mb-1 flex items-center gap-2 font-medium text-foreground"><AlertTriangle className="h-3.5 w-3.5" />Report scope</div>
              Broken UI, repo/UI mismatch, missing buttons/inputs, invalid navigation, responsive layout, Safari scroll/overflow, and severity-ranked fix instructions.
            </div>

            <Button onClick={() => void startAudit()} disabled={submitting || !permission || !targetUrl.trim()} className="w-full gap-2 md:w-auto">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {submitting ? "Creating session…" : "Start UI beta test"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
