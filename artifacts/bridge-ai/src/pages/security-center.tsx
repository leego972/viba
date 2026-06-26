import { useQuery } from "@tanstack/react-query";
import { Shield, Lock, Zap, Upload, Globe, CreditCard, Rocket, Activity, AlertTriangle, CheckCircle2, XCircle, Info, Eye, RefreshCw } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchSecurityStatus() {
  const res = await fetch(`${BASE}/api/security/status`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load security status");
  return res.json();
}

async function fetchSecurityBlockers() {
  const res = await fetch(`${BASE}/api/security/blockers`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load security blockers");
  return res.json();
}

function StatusBadge({ active, label }: { active: boolean; label?: string }) {
  return active ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
      <CheckCircle2 className="h-3 w-3" /> {label ?? "Active"}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
      <XCircle className="h-3 w-3" /> {label ?? "Inactive"}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-500/10 text-red-400 border-red-500/20",
    high: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    low: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${map[severity] ?? map.medium}`}>
      {severity.toUpperCase()}
    </span>
  );
}

interface SectionCardProps {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}

function SectionCard({ icon: Icon, title, children }: SectionCardProps) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <h3 className="font-semibold text-sm text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-white/[0.05] last:border-0">
      <span className="text-xs text-muted-foreground shrink-0 pt-0.5">{label}</span>
      <span className="text-xs text-right">{value}</span>
    </div>
  );
}

export default function SecurityCenterPage() {
  const {
    data: status,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useQuery({ queryKey: ["security", "status"], queryFn: fetchSecurityStatus });

  const {
    data: blockersData,
    isLoading: blockersLoading,
  } = useQuery({ queryKey: ["security", "blockers"], queryFn: fetchSecurityBlockers });

  const blockers: Array<{ id: string; title: string; status: string; description: string; severity: string }> =
    blockersData?.blockers ?? [];

  const isLoading = statusLoading || blockersLoading;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <Shield className="h-5 w-5 text-emerald-400" />
              </div>
              <h1 className="text-xl font-bold text-foreground">Security Center</h1>
            </div>
            <p className="text-sm text-muted-foreground max-w-2xl">
              VIBA blocks unsafe actions by default. Credentials stay encrypted in your vault. High-risk tools require
              approval, deployments require safe-build, and uploads are quarantined before use.
            </p>
          </div>
          <button
            onClick={() => refetchStatus()}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-medium border border-white/[0.08] text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {/* Notice banner */}
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <Info className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
          <p className="text-xs text-emerald-300/80 leading-relaxed">
            No secrets are displayed on this page. Credential values are never returned to the browser — only labels
            and status metadata are shown. This page reflects the live security posture of your VIBA instance.
          </p>
        </div>

        {isLoading && (
          <div className="text-center py-16 text-muted-foreground text-sm">Loading security status…</div>
        )}

        {!isLoading && status && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. Vault Safety */}
            <SectionCard icon={Lock} title="1. Vault Safety">
              <InfoRow label="Encryption" value={<StatusBadge active={status.vaultSafety?.encrypted} label="AES-256-GCM" />} />
              <InfoRow label="Raw values returned to client" value={<StatusBadge active={false} label="Never" />} />
              <InfoRow label="Description" value={
                <span className="text-muted-foreground">{status.vaultSafety?.description}</span>
              } />
            </SectionCard>

            {/* 2. BYOK Safety */}
            <SectionCard icon={Eye} title="2. BYOK Safety">
              <InfoRow label="Enabled" value={<StatusBadge active={status.byokSafety?.enabled} />} />
              <InfoRow label="Raw key returned after save" value={<StatusBadge active={false} label="Never" />} />
              <InfoRow label="Description" value={
                <span className="text-muted-foreground">{status.byokSafety?.description}</span>
              } />
            </SectionCard>

            {/* 3. Tool Broker Risk */}
            <SectionCard icon={Zap} title="3. Tool Broker Risk">
              <InfoRow label="Approval required for high-risk" value={<StatusBadge active={status.toolBrokerSafety?.approvalRequired} />} />
              <InfoRow label="Safe-build required" value={<StatusBadge active={status.toolBrokerSafety?.safeBuildRequired} />} />
              <InfoRow label="Dry-run required" value={<StatusBadge active={status.toolBrokerSafety?.dryRunRequired} />} />
              <InfoRow label="Placeholder adapters blocked" value={<StatusBadge active={status.toolBrokerSafety?.placeholderAdaptersBlocked} />} />
              <InfoRow label="Payload / result redacted" value={<StatusBadge active={status.toolBrokerSafety?.payloadRedacted} />} />
            </SectionCard>

            {/* 4. Upload Safety */}
            <SectionCard icon={Upload} title="4. Upload Safety">
              <InfoRow label="Max upload" value={<span className="text-muted-foreground">50 MB</span>} />
              <InfoRow label="Max extracted" value={<span className="text-muted-foreground">200 MB / 2,000 files</span>} />
              <InfoRow label="Path traversal blocked" value={<StatusBadge active={status.uploadSafety?.pathTraversalBlocked} />} />
              <InfoRow label="Zip bomb heuristic" value={<StatusBadge active={status.uploadSafety?.zipBombHeuristicEnabled} />} />
            </SectionCard>

            {/* 5. Browser Safety */}
            <SectionCard icon={Globe} title="5. Browser Safety">
              <InfoRow label="Isolated profile per job" value={<StatusBadge active={status.browserSafety?.isolatedProfilePerJob} />} />
              <InfoRow label="Cookie sharing blocked" value={<StatusBadge active={status.browserSafety?.cookieSharingBlocked} />} />
              <InfoRow label="Download execution blocked" value={<StatusBadge active={status.browserSafety?.downloadedFileExecutionBlocked} />} />
              <InfoRow label="OAuth/payment pauses" value={<StatusBadge active={status.browserSafety?.oauthPaymentPausesForApproval} />} />
              <InfoRow label="Target URL validated" value={<StatusBadge active={status.browserSafety?.urlValidatedBySsrfGuard} />} />
              <InfoRow label="Screenshots redacted" value={<StatusBadge active={status.browserSafety?.screenshotsRedacted} />} />
            </SectionCard>

            {/* 6. Payment / Credit Safety */}
            <SectionCard icon={CreditCard} title="6. Payment / Credit Safety">
              <InfoRow label="Webhook signature required" value={<StatusBadge active={status.paymentSafety?.webhookSignatureRequired} />} />
              <InfoRow label="Idempotency enforced" value={<StatusBadge active={status.paymentSafety?.idempotencyEnforced} />} />
              <InfoRow label="Duplicate credit grant blocked" value={<StatusBadge active={status.paymentSafety?.duplicateCreditGrantBlocked} />} />
              <InfoRow label="Client self-credit blocked" value={<StatusBadge active={status.paymentSafety?.clientSelfCreditBlocked} />} />
              <InfoRow label="Negative balance blocked" value={<StatusBadge active={status.paymentSafety?.negativeBalanceBlocked} />} />
            </SectionCard>

            {/* 7. Deployment Safety */}
            <SectionCard icon={Rocket} title="7. Deployment Safety">
              <InfoRow label="Safe-build required" value={<StatusBadge active={status.deploymentSafety?.safeBuildRequired} />} />
              <InfoRow label="User approval required" value={<StatusBadge active={status.deploymentSafety?.approvalRequired} />} />
              <InfoRow label="Dry-run required" value={<StatusBadge active={status.deploymentSafety?.dryRunRequired} />} />
              <InfoRow label="Placeholder adapters blocked" value={<StatusBadge active={status.deploymentSafety?.placeholderAdaptersBlocked} />} />
            </SectionCard>

            {/* 8. Production Incidents / URL Safety */}
            <SectionCard icon={Activity} title="8. SSRF / URL Safety">
              <InfoRow label="SSRF protection" value={<StatusBadge active={status.urlSafety?.ssrfProtectionEnabled} />} />
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-2">Blocked ranges:</p>
                <ul className="space-y-1">
                  {(status.urlSafety?.blockedRanges ?? []).map((range: string) => (
                    <li key={range} className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
                      <XCircle className="h-3 w-3 text-red-400 shrink-0" /> {range}
                    </li>
                  ))}
                </ul>
              </div>
            </SectionCard>
          </div>
        )}

        {/* 9. Security Blockers */}
        {!isLoading && blockers.length > 0 && (
          <SectionCard icon={AlertTriangle} title="9. Security Controls & Blockers">
            <div className="space-y-2">
              {blockers.map((b) => (
                <div
                  key={b.id}
                  className="flex items-start gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] p-3"
                >
                  {b.status === "active" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-xs font-medium text-foreground">{b.title}</span>
                      <SeverityBadge severity={b.severity} />
                    </div>
                    <p className="text-xs text-muted-foreground">{b.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* 10. QA Gate / Recommended Fixes */}
        {!isLoading && status && (
          <SectionCard icon={Shield} title="10. QA Gate — Security Checks">
            <p className="text-xs text-muted-foreground mb-3">
              The QA Release Gate blocks any release when any of the following security checks fail:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {(status.qaGateIntegration?.blocksOn ?? []).map((check: string) => (
                <div key={check} className="flex items-center gap-2 text-xs text-muted-foreground/80">
                  <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                  {check.replace(/_/g, " ")}
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground/50 pb-4">
          Security posture last refreshed:{" "}
          {status?.generatedAt ? new Date(status.generatedAt).toLocaleString() : "—"} ·{" "}
          Environment: {status?.environment ?? "—"}
        </p>
      </div>
    </AppLayout>
  );
}
