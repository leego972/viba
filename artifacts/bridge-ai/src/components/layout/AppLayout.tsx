import { Navbar } from "./Navbar";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <Navbar />
      <main className="flex-1 w-full max-w-screen-2xl mx-auto container px-4 py-6 md:px-6 md:py-8 pb-16 animate-fade-in">
        {children}
      </main>
    </div>
  );
}
