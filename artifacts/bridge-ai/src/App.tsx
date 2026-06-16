import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AccessGate } from "@/components/AccessGate";
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
import { initAuth } from "@/lib/auth";

// Register the stored access token as the bearer for every API request
initAuth();

const queryClient = new QueryClient();

function GatedRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/sessions/new" component={NewSession} />
      <Route path="/sessions/:id" component={SessionWorkspace} />
      <Route path="/settings" component={Settings} />
      <Route path="/workbench" component={Workbench} />
      <Route path="/bridge" component={Bridge} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <ErrorBoundary>
            <Switch>
              {/* Public routes — bypass AccessGate entirely */}
              <Route path="/pricing" component={Pricing} />
              <Route path="/checkout/success" component={CheckoutSuccess} />
              {/* All other routes — gated by AccessGate */}
              <Route>
                <AccessGate>
                  <GatedRouter />
                </AccessGate>
              </Route>
            </Switch>
          </ErrorBoundary>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
