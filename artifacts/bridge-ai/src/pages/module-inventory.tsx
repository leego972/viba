import { useEffect, useState } from "react";
import { Link } from "wouter";

type InventoryModule = {
  inventoryId: number;
  moduleId: number;
  name: string;
  shortDescription: string;
  sellerName: string;
  versionOwned: string;
  currentVersion: string;
  downloadCount: number;
};

export default function ModuleInventoryPage() {
  const [modules, setModules] = useState<InventoryModule[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadInventory() {
    setLoading(true);
    try {
      const res = await fetch("/api/marketplace/inventory", { credentials: "include" });
      if (!res.ok) throw new Error("Inventory could not be loaded.");
      const data = await res.json() as { modules: InventoryModule[] };
      setModules(data.modules ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Inventory could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) {
      void loadInventory();
      return;
    }
    fetch("/api/marketplace/checkout/confirm", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
      .then(async (res) => {
        const data = await res.json() as { message?: string };
        if (!res.ok) throw new Error(data.message ?? "Purchase confirmation failed.");
        setMessage("Purchase confirmed. The module is now permanently available in your inventory.");
        window.history.replaceState(null, "", "/module-inventory");
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Purchase confirmation failed."))
      .finally(() => void loadInventory());
  }, []);

  async function useModule(inventoryId: number) {
    const res = await fetch(`/api/marketplace/inventory/${inventoryId}/use`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await res.json() as { instruction?: string; error?: string };
    setMessage(res.ok ? data.instruction ?? "Module is ready for a VIBA build." : data.error ?? "Module could not be attached.");
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-7">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Permanent ownership</p>
            <h1 className="text-3xl font-semibold tracking-tight">Module inventory</h1>
          </div>
          <Link href="/marketplace" className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">Browse Bazaar</Link>
        </header>

        {message && <div role="status" className="rounded-lg border bg-card p-4 text-sm">{message}</div>}
        {loading ? <p className="text-sm text-muted-foreground">Loading inventory…</p> : null}
        {!loading && modules.length === 0 ? (
          <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">You do not own any Bazaar modules yet.</div>
        ) : null}

        <section className="space-y-3">
          {modules.map((module) => (
            <article key={module.inventoryId} className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{module.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{module.shortDescription}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Seller: {module.sellerName} · Owned version {module.versionOwned} · Downloads {module.downloadCount}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={`/api/marketplace/inventory/${module.inventoryId}/download`} className="rounded-md border px-3 py-2 text-sm hover:bg-muted">Download</a>
                  <button onClick={() => void useModule(module.inventoryId)} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">Use in VIBA build</button>
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
