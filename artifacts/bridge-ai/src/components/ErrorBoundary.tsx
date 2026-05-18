import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex min-h-screen items-center justify-center p-8">
          <div className="max-w-md w-full rounded-lg border border-destructive bg-destructive/10 p-8 text-center space-y-4">
            <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
            <h2 className="text-lg font-semibold text-destructive">Something went wrong</h2>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
            <Button variant="outline" onClick={this.handleReset}>
              Try again
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
