import { ShieldCheck } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { GenericApiKeysCard } from "@/components/GenericApiKeysCard";
import { DangerZone } from "@/components/DangerZone";

export default function Settings() {
  return (
    <AppLayout>
      <div className="flex flex-col space-y-6 max-w-3xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">Manage VIBA API keys and account controls.</p>
        </div>

        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex gap-4">
          <ShieldCheck className="h-6 w-6 text-primary flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-primary">Keys are stored securely in the VIBA vault</h3>
            <p className="text-sm text-primary/80">
              Add any API provider by name and value. Raw key values are stored server-side and are not returned to the browser.
            </p>
          </div>
        </div>

        <GenericApiKeysCard />

        <DangerZone />
      </div>
    </AppLayout>
  );
}
