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
import { initAuth } from "@/lib/auth";

// Register the stored access token as the bearer for every API request
initAuth();

const queryClient = new QueryClient();

function Router() {
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
        <AccessGate>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <ErrorBoundary>
              <Router />
            </ErrorBoundary>
          </WouterRouter>
        </AccessGate>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
