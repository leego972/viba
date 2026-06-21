import { useEffect, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import VibaFooter from "@/components/VibaFooter";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import UserInstructions from "@/pages/user-instructions";
import Terms from "@/pages/terms";
import Dashboard from "@/pages/dashboard";
import NewSession from "@/pages/new-session";
import SessionWorkspace from "@/pages/session-workspace-clinical";
import Settings from "@/pages/settings";
import Workbench from "@/pages/workbench";
import Bridge from "@/pages/bridge";
import Pricing from "@/pages/pricing";
import CheckoutSuccess from "@/pages/checkout-success";
import AdminMaintenance from "@/pages/admin-maintenance";
import LoginPage from "@/pages/login";
import SignUpPage from "@/pages/signup";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import VerifyEmail from "@/pages/verify-email";
import Billing from "@/pages/billing";
import { useAuth } from "@/hooks/useAuth";

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
  useEffect(() => { if (!isLoading && !isAuthenticated) setLocation("/login"); }, [isLoading, isAuthenticated, setLocation]);
  if (isLoading) return <Spinner />;
  if (!isAuthenticated) return <Spinner />;
  return <>{children}</>;
}

function isAdminEmail(email: string | null | undefined): boolean {
  const configured = (import.meta.env.VITE_VIBA_ADMIN_EMAILS || import.meta.env.VITE_VIBA_ADMIN_EMAIL || "leego972@gmail.com") as string;
  return configured.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean).includes((email ?? "").toLowerCase());
}

function AdminOnly({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading } = useAuth();
  useEffect(() => { if (!isLoading && !isAuthenticated) setLocation("/login"); }, [isLoading, isAuthenticated, setLocation]);
  if (isLoading) return <Spinner />;
  if (!isAuthenticated) return <Spinner />;
  if (!isAdminEmail(user?.email)) return <NotFound />;
  return <>{children}</>;
}

function AdminMaintenanceRoute() {
  return <AdminOnly><AdminMaintenance /></AdminOnly>;
}

function GatedRouter() {
  return (
    <AuthGuard>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/sessions/new" component={NewSession} />
        <Route path="/sessions/:id" component={SessionWorkspace} />
        <Route path="/settings" component={Settings} />
        <Route path="/billing" component={Billing} />
        <Route path="/workbench" component={Workbench} />
        <Route path="/bridge" component={Bridge} />
        <Route component={NotFound} />
      </Switch>
    </AuthGuard>
  );
}

function App() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <ErrorBoundary>
            <Switch>
              <Route path="/login" component={LoginPage} />
              <Route path="/signup" component={SignUpPage} />
              <Route path="/forgot-password" component={ForgotPassword} />
              <Route path="/reset-password" component={ResetPassword} />
              <Route path="/verify-email" component={VerifyEmail} />
              <Route path="/pricing" component={Pricing} />
              <Route path="/user-instructions" component={UserInstructions} />
              <Route path="/terms" component={Terms} />
              <Route path="/checkout/success" component={CheckoutSuccess} />
              <Route path="/admin/maintenance" component={AdminMaintenanceRoute} />
              <Route path="/admin" component={AdminMaintenanceRoute} />
              <Route component={GatedRouter} />
            </Switch>
          </ErrorBoundary>
          <VibaFooter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
