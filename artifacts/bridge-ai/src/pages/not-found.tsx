import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Cpu, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background px-4">
      <div className="flex flex-col items-center text-center max-w-md gap-6">
        <Link href="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
          <Cpu className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg tracking-tight text-foreground">VIBA</span>
        </Link>

        <div className="space-y-2">
          <p className="text-7xl font-extrabold tracking-tight text-primary">404</p>
          <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            The page you're looking for doesn't exist or has been moved.
          </p>
        </div>

        <Link href="/dashboard">
          <Button className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
