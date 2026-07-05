import { Navbar } from "./Navbar";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="relative flex min-h-screen min-w-0 flex-col overflow-x-hidden bg-background text-foreground">
      <Navbar />
      <main className="mx-auto w-full max-w-screen-2xl min-w-0 flex-1 px-4 py-5 pb-20 sm:px-5 md:px-6 md:py-8 animate-fade-in">
        {children}
      </main>
    </div>
  );
}
