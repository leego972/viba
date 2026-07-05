import { useEffect, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/contexts/ThemeContext";
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
import VaultPage from "@/pages/vault";
import UiAuditPage from "@/pages/ui-audit";
import ConnectionsPage from "@/pages/connections";
import { useAuth } from "@/hooks/useAuth";
import { isBypassValid } from "@/lib/auth";

const queryClient = new QueryClient();

function Spinner() {
  return <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">Loading…</div>;
}

function AuthGuard({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  useEffect(() => { if (!isLoading && !isAuthenticated && !isBypassValid()) setLocation("/login"); }, [isLoading, isAuthenticated, setLocation]);
  if (isBypassValid()) return <>{children}</>;
  if (isLoading || !isAuthenticated) return <Spinner />;
  return <>{children}</>;
}

function GatedRouter() {
  return (
    <AuthGuard>
      <Switch>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/sessions/new" component={NewSession} />
        <Route path="/sessions/:id" component={SessionWorkspace} />
        <Route path="/settings" component={Settings} />
        <Route path="/billing" component={Billing} />
        <Route path="/workbench" component={Workbench} />
        <Route path="/bridge" component={Bridge} />
        <Route path="/credentials" component={VaultPage} />
        <Route path="/connections" component={ConnectionsPage} />
        <Route path="/ui-audit" component={UiAuditPage} />
        <Route component={NotFound} />
      </Switch>
    </AuthGuard>
  );
}

function App() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <WouterRouter base={basePath}>
              <Switch>
                <Route path="/login" component={LoginPage} />
                <Route path="/signup" component={SignUpPage} />
                <Route path="/forgot-password" component={ForgotPassword} />
                <Route path="/reset-password" component={ResetPassword} />
                <Route path="/verify-email" component={VerifyEmail} />
                <Route path="/pricing" component={Pricing} />
                <Route path="/checkout/success" component={CheckoutSuccess} />
                <Route path="/admin" component={Admin} />
                <Route path="/" component={Home} />
                <Route component={GatedRouter} />
              </Switch>
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
