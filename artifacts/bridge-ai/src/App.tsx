import { useEffect, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import NewSession from "@/pages/new-session";
import SessionWorkspace from "@/pages/session-workspace";
import Settings from "@/pages/settings";
import Workbench from "@/pages/workbench";
import Bridge from "@/pages/bridge";
import Pricing from "@/pages/pricing";
import CheckoutSuccess from "@/pages/checkout-success";
import Admin from "@/pages/admin";
import LoginPage from "@/pages/login";
import SignUpPage from "@/pages/signup";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import VerifyEmail from "@/pages/verify-email";
import Billing from "@/pages/billing";
import ProvidersPage from "@/pages/providers";
import DoctorPage from "@/pages/doctor";
import CompletionPage, {
  CollaborationMapPage,
  DemoDoctorReport,
  DemoPage,
  DemoProofReport,
  SessionTimelinePage,
  ShareReportPage,
} from "@/pages/market-completion";
import { useAuth } from "@/hooks/useAuth";
import { isBypassValid, setBypassValid } from "@/lib/auth";

const queryClient = new QueryClient();

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-muted-foreground">
        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        <span className="text-sm">Loading…</span>
      </div>
    </div>
  );
}

function AuthGuard({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isBypassValid()) {
      setLocation("/login");
    }
  }, [isLoading, isAuthenticated, setLocation]);

  // Archibald Titan AI embedded bypass — skip auth entirely
  if (isBypassValid()) return <>{children}</>;

  if (isLoading) return <Spinner />;

  if (!isAuthenticated) return <Spinner />;

  return <>{children}</>;
}

function GatedRouter() {
  return (
    <AuthGuard>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/sessions/new" component={NewSession} />
        <Route path="/sessions/:id/timeline" component={SessionTimelinePage} />
        <Route path="/sessions/:id/map" component={CollaborationMapPage} />
        <Route path="/sessions/:id" component={SessionWorkspace} />
        <Route path="/settings" component={Settings} />
        <Route path="/billing" component={Billing} />
        <Route path="/workbench" component={Workbench} />
        <Route path="/bridge" component={Bridge} />
        <Route path="/providers" component={ProvidersPage} />
        <Route path="/doctor" component={DoctorPage} />
        <Route path="/connectors" component={CompletionPage} />
        <Route path="/self-audit" component={CompletionPage} />
        <Route path="/crews" component={CompletionPage} />
        <Route path="/production-smoke-test" component={CompletionPage} />
        <Route path="/mobile-readiness" component={CompletionPage} />
        <Route path="/team" component={CompletionPage} />
        <Route path="/usage" component={CompletionPage} />
        <Route path="/recovery" component={CompletionPage} />
        <Route path="/doctor/trends" component={CompletionPage} />
        <Route path="/clients" component={CompletionPage} />
        <Route path="/security-evidence" component={CompletionPage} />
        <Route path="/reports/compare" component={CompletionPage} />
        <Route path="/market-readiness" component={CompletionPage} />
        <Route component={NotFound} />
      </Switch>
    </AuthGuard>
  );
}

// Handles ?bypass= param at app startup (Archibald Titan AI embed)
function BypassHandler() {
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const bypassParam = urlParams.get("bypass");
    if (!bypassParam || isBypassValid()) return;

    fetch("/api/auth/verify-bypass", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token: bypassParam }),
    })
      .then(async (res) => {
        if (res.ok) {
          setBypassValid();
          const cleanUrl = window.location.pathname + window.location.hash;
          window.history.replaceState(null, "", cleanUrl);
          // Force re-render so AuthGuard picks up the new bypass state
          queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
        }
      })
      .catch(() => {});
  }, []);

  return null;
}

function App() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <BypassHandler />
          <ErrorBoundary>
            <Switch>
              {/* Public routes */}
              <Route path="/login" component={LoginPage} />
              <Route path="/signup" component={SignUpPage} />
              <Route path="/forgot-password" component={ForgotPassword} />
              <Route path="/reset-password" component={ResetPassword} />
              <Route path="/verify-email" component={VerifyEmail} />
              <Route path="/pricing" component={Pricing} />
              <Route path="/checkout/success" component={CheckoutSuccess} />
              {/* Public demo & share — no auth required */}
              <Route path="/demo/doctor-report" component={DemoDoctorReport} />
              <Route path="/demo/proof-report" component={DemoProofReport} />
              <Route path="/demo" component={DemoPage} />
              <Route path="/share/reports/:shareId" component={ShareReportPage} />
              {/* Admin — self-gated by ADMIN_TOKEN, no session required */}
              <Route path="/admin" component={Admin} />
              {/* All other routes — gated by AuthGuard */}
              <Route component={GatedRouter} />
            </Switch>
          </ErrorBoundary>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
