import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Trash2, AlertTriangle, ShieldAlert, RotateCcw, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface DeletionStatus {
  pending: boolean;
  requestedAt?: string;
  deleteAfter?: string;
  status?: string;
  archived?: boolean;
}

export function DangerZone() {
  const { toast } = useToast();
  const [showConfirm, setShowConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  useEffect(() => {
    void fetchStatus();
  }, []);

  async function fetchStatus() {
    try {
      setLoadingStatus(true);
      const res = await fetch(`${BASE}/api/account/deletion-status`, { credentials: "include" });
      if (res.ok) setStatus(await res.json() as DeletionStatus);
    } catch {
      // silently ignore — not critical
    } finally {
      setLoadingStatus(false);
    }
  }

  async function requestDeletion() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/account/request-deletion`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        throw new Error(err.message ?? "Request failed");
      }
      const data = await res.json() as { deleteAfter: string; archived: boolean };
      toast({
        title: "Account deletion scheduled",
        description: `Your data will be permanently deleted on ${new Date(data.deleteAfter).toLocaleDateString()}. You've been signed out.`,
      });
      // Brief delay then force logout — session was destroyed server-side
      setTimeout(() => { window.location.href = "/"; }, 2500);
    } catch (err) {
      toast({
        title: "Failed to schedule deletion",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  }

  async function cancelDeletion() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/account/cancel-deletion`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Cancel failed");
      toast({ title: "Deletion canceled", description: "Your account has been fully restored." });
      await fetchStatus();
    } catch {
      toast({ title: "Failed to cancel deletion", variant: "destructive" });
    } finally {
      setLoading(false);
      setShowCancelConfirm(false);
    }
  }

  if (loadingStatus) return null;

  return (
    <>
      <Card className="border-destructive/30 bg-destructive/5 mt-2">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-destructive text-base">
            <ShieldAlert className="h-4 w-4" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Irreversible actions — read carefully before proceeding.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {status?.pending ? (
            /* ── Deletion already scheduled ────────────────────────────── */
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Clock className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-amber-200">Account deletion scheduled</p>
                    {status.archived && (
                      <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                        Archived
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Requested{" "}
                    {status.requestedAt
                      ? new Date(status.requestedAt).toLocaleDateString(undefined, { dateStyle: "medium" })
                      : "recently"}
                    . All your data will be permanently purged on{" "}
                    <span className="text-amber-300 font-medium">
                      {status.deleteAfter
                        ? new Date(status.deleteAfter).toLocaleDateString(undefined, { dateStyle: "long" })
                        : "—"}
                    </span>
                    .
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Your sessions and work remain safe until that date. You can cancel anytime before then.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                onClick={() => setShowCancelConfirm(true)}
                disabled={loading}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Cancel deletion &amp; restore account
              </Button>
            </div>
          ) : (
            /* ── Delete account option ──────────────────────────────────── */
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Delete account</p>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-md">
                  Your data will be securely archived for 6 months, then permanently deleted.
                  Sessions pause immediately. You can cancel within the 6-month window.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={() => setShowConfirm(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete account
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Confirm delete dialog ────────────────────────────────────────── */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> Delete your account?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left">
              <span className="block">Here's exactly what happens:</span>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>All active sessions are paused immediately</li>
                <li>Your data is securely archived for <strong>6 months</strong></li>
                <li>After 6 months it is permanently and irrecoverably deleted</li>
                <li>You are signed out right away</li>
                <li>You can cancel this at any time within the 6-month window</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Keep my account</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void requestDeletion(); }}
              disabled={loading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {loading ? "Scheduling…" : "Yes, delete my account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Confirm cancel-deletion dialog ───────────────────────────────── */}
      <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel deletion and restore account?</AlertDialogTitle>
            <AlertDialogDescription>
              Your account will be fully restored. All your sessions and data remain intact.
              The scheduled deletion will be permanently canceled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Go back</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void cancelDeletion(); }}
              disabled={loading}
            >
              {loading ? "Restoring…" : "Yes, restore my account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
