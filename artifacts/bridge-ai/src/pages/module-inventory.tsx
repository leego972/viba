import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Download, PackageCheck, PlugZap, Store } from "lucide-react";

type InventoryModule = {
  inventoryId: number;
  moduleId: number;
  name: string;
  slug: string;
  shortDescription: string;
  category: string;
  language?: string | null;
  framework?: string | null;
  versionOwned: string;
  currentVersion: string;
  downloadCount: number;
  sellerName: string;
  addedAt: string;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, { credentials: "include", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || "Request failed");
  return data as T;
}

export default function ModuleInventoryPage() {
  const [modules, setModules] = useState<InventoryModule[]>([]);
  const [status, setStatus] = useState("Loading your modules…");

  const load = async () => {
    try {
      const result = await api<{ modules: InventoryModule[] }>("/marketplace/inventory");
      setModules(result.modules);
      setStatus(result.modules.length ? "" : "You have not purchased any modules yet.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Inventory could not be loaded");
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const finish = async () => {
      if (sessionId) {
        setStatus("Confirming payment and adding the module to your inventory…");
        try {
          await api("/marketplace/checkout/confirm", { method: "POST", body: JSON.stringify({ sessionId }) });
          window.history.replaceState(null, "", "/module-inventory?purchase=success");
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "Payment could not be confirmed");
        }
      }
      await load();
    };
    void finish();
  }, []);

  const useModule = async (inventoryId: number) => {
    try {
      const result = await api<{ instruction: string; module: { name: string } }>(`/marketplace/inventory/${inventoryId}/use`, { method: "POST", body: "{}" });
      sessionStorage.setItem("vibaSelectedMarketplaceModule", JSON.stringify(result.module));
      setStatus(`${result.module.name} is ready to attach to a new VIBA build.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Module could not be prepared");
    }
  };

  return <main className="min-h-screen bg-[#f7f7f4] text-zinc-950">
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">VIBA</p><h1 className="text-2xl font-semibold">Module inventory</h1></div>
        <Link href="/marketplace" className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white"><Store className="h-4 w-4" />Browse Bazaar</Link>
      </div>
    </header>

    <section className="mx-auto max-w-6xl px-5 py-8">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4"><div className="rounded-xl bg-zinc-100 p-3"><PackageCheck className="h-6 w-6" /></div><div><h2 className="text-2xl font-semibold">Your permanent reusable assets</h2><p className="mt-1 text-zinc-600">Purchased modules remain here for future builds. Download them or ask VIBA to reuse them in another project.</p></div></div>
      </div>
      {status && <div className="mt-4 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">{status}</div>}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {modules.map((module) => <article key={module.inventoryId} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-wider text-zinc-500">{module.category}</p><h3 className="mt-1 text-xl font-semibold">{module.name}</h3><p className="mt-2 text-sm leading-6 text-zinc-600">{module.shortDescription}</p></div><span className="rounded-full bg-zinc-100 px-3 py-1 text-xs">v{module.versionOwned}</span></div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-500"><span>{module.sellerName}</span>{module.language && <span>• {module.language}</span>}{module.framework && <span>• {module.framework}</span>}<span>• {module.downloadCount} downloads</span></div>
          <div className="mt-5 flex gap-2 border-t border-zinc-100 pt-4">
            <button onClick={() => void useModule(module.inventoryId)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white"><PlugZap className="h-4 w-4" />Use in VIBA build</button>
            <a href={`/api/marketplace/inventory/${module.inventoryId}/download`} className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium"><Download className="h-4 w-4" />Download</a>
          </div>
        </article>)}
      </div>
    </section>
  </main>;
}
