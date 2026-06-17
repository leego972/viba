import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { CheckCircle2, XCircle, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

type VerifyState = "loading" | "success" | "error" | "missing";

export default function VerifyEmail() {
  const [, setLocation] = useLocation();
  const [state, setState] = useState<VerifyState>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setState("missing");
      return;
    }

    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json() as { ok?: boolean; error?: string };
        if (res.ok && data.ok) {
          setState("success");
        } else {
          setErrorMsg(data.error ?? "Verification failed.");
          setState("error");
        }
      })
      .catch(() => {
        setErrorMsg("Network error — please try again.");
        setState("error");
      });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md text-center space-y-6">
        {state === "loading" && (
          <>
            <div className="flex justify-center">
              <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                <Loader2 className="h-7 w-7 text-muted-foreground animate-spin" />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-semibold">Verifying your email…</h1>
              <p className="text-sm text-muted-foreground mt-1">Please wait a moment.</p>
            </div>
          </>
        )}

        {state === "success" && (
          <>
            <div className="flex justify-center">
              <div className="h-14 w-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                <CheckCircle2 className="h-7 w-7 text-emerald-400" />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-semibold">Email verified!</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Your email address has been confirmed. You're all set.
              </p>
            </div>
            <Button onClick={() => setLocation("/dashboard")} className="gap-2">
              Go to Dashboard
            </Button>
          </>
        )}

        {state === "error" && (
          <>
            <div className="flex justify-center">
              <div className="h-14 w-14 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                <XCircle className="h-7 w-7 text-red-400" />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-semibold">Verification failed</h1>
              <p className="text-sm text-muted-foreground mt-1">{errorMsg}</p>
              <p className="text-xs text-muted-foreground mt-2">
                Verification links expire after 24 hours. You can request a new one from your account settings.
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              <Link href="/login">
                <Button variant="outline">Back to Login</Button>
              </Link>
              <Link href="/dashboard">
                <Button>Dashboard</Button>
              </Link>
            </div>
          </>
        )}

        {state === "missing" && (
          <>
            <div className="flex justify-center">
              <div className="h-14 w-14 rounded-full bg-muted border flex items-center justify-center">
                <Mail className="h-7 w-7 text-muted-foreground" />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-semibold">No verification token</h1>
              <p className="text-sm text-muted-foreground mt-1">
                This link is missing a verification token. Check your email for the correct link.
              </p>
            </div>
            <Link href="/dashboard">
              <Button variant="outline">Back to Dashboard</Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
