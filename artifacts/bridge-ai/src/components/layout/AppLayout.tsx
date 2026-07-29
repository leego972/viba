import { Navbar } from "./Navbar";
import { AppVisualSystem } from "./AppVisualSystem";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: React.ReactNode;
  variant?: "default" | "command";
}

export function AppLayout({ children, variant = "default" }: AppLayoutProps) {
  return (
    <div className="viba-app-shell relative flex min-h-screen flex-col overflow-x-clip bg-background">
      <AppVisualSystem />
      <Navbar />
      <main
        className={cn(
          "viba-app-content relative z-10 flex-1 w-full min-w-0 animate-fade-in",
          variant === "default" &&
            "max-w-screen-2xl mx-auto container px-4 py-6 md:px-6 md:py-8 pb-16",
          variant === "command" && "flex min-w-0 flex-col overflow-hidden",
        )}
      >
        {children}
      </main>
    </div>
  );
}
