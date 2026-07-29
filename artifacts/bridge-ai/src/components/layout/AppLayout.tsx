import { Navbar } from "./Navbar";
import { AppVisualSystem } from "./AppVisualSystem";
import { assetUrl, hero } from "@/lib/assets";
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
        {variant === "default" && (
          <section
            aria-label="VIBA intelligence"
            className="relative mb-6 flex h-44 w-full items-center justify-center overflow-hidden rounded-2xl border border-indigo-500/20 bg-[#080b18] sm:h-56 md:h-64"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.22),rgba(99,102,241,0.09)_42%,transparent_72%)]" />
            <img
              src={assetUrl(hero.brain)}
              width={hero.brain.width}
              height={hero.brain.height}
              alt="VIBA electric blue orchestration brain"
              className="relative z-10 h-[92%] w-auto max-w-[92%] object-contain drop-shadow-[0_0_34px_rgba(59,130,246,0.7)]"
            />
          </section>
        )}
        {children}
      </main>
    </div>
  );
}
