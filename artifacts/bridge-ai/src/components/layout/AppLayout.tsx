import { Navbar } from "./Navbar";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: React.ReactNode;
  variant?: "default" | "command";
}

export function AppLayout({ children, variant = "default" }: AppLayoutProps) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background overflow-x-clip">
      <Navbar />
      <main
        className={cn(
          "flex-1 w-full animate-fade-in",
          variant === "default" &&
            "max-w-screen-2xl mx-auto container px-4 py-6 md:px-6 md:py-8 pb-16",
          variant === "command" && "flex flex-col overflow-hidden",
        )}
      >
        {children}
      </main>
    </div>
  );
}
