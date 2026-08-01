import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Search, Package, Store, Upload, ShoppingCart, BadgeCheck } from "lucide-react";

type ModuleCard = {
  id: number;
  slug: string;
  name: string;
  shortDescription: string;
  category: string;
  language?: string | null;
  framework?: string | null;
  version: string;
  priceCents: number;
  currency: string;
  sellerName: string;
  sellerVerified: boolean;
  sellerIsPlatformBot: boolean;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, { credentials: "include", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || "Request failed");
  return data as T;
}

function money(cents: number, currency = "usd") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export default function MarketplacePage() {
  const [, setLocation] = useLocation();
  const [modules, setModules] = useState<ModuleCard[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [seller, setSeller] = useState<any>(null);
  const [showSell, setShowSell] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const suffix = query.trim() ? `?search=${encodeURIComponent(query.trim())}` : "";
      const [market, sellerResult] = await Promise.all([
        api<{ modules: ModuleCard[] }>(`/marketplace/modules${suffix}`),
        api<{ seller: any }>("/marketplace/seller/me"),
      ]);
      setModules(market.modules);
      setSeller(sellerResult.seller);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Bazaar");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  const categories = useMemo(() => Array.from(new Set(modules.map((item) => item.category))).sort(), [modules]);

  const buy = async (moduleId: number) => {
    setMessage("");
    try {
      const result = await api<{ checkoutUrl: string }>(`/marketplace/modules/${moduleId}/checkout`, { method: "POST", body: "{}" });
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout failed");
    }
  };

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-zinc-950">
      <header className="border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">VIBA</p>
            <h1 className="text-2xl font-semibold">The Bazaar</h1>
          </div>
          <div className="flex gap-2">
            <Link href="/module-inventory" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50">My Modules</Link>
            <button onClick={() => setShowSell((value) => !value)} className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">{seller ? "Seller studio" : "Become a seller"}</button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-8">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight">Reusable technology for faster VIBA builds.</h2>
              <p className="mt-2 text-zinc-600">Buy verified modules once, keep them permanently in your inventory, download them, or attach them to future VIBA projects.</p>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); void load(); }} className="flex w-full max-w-md gap-2">
              <div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-zinc-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search modules" className="w-full rounded-lg border border-zinc-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-zinc-950" /></div>
              <button className="rounded-lg border border-zinc-300 px-4 text-sm font-medium">Search</button>
            </form>
          </div>
          {categories.length > 0 && <div className="mt-5 flex flex-wrap gap-2">{categories.map((category) => <span key={category} className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">{category}</span>)}</div>}
        </div>

        {message && <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{message}</div>}
        {showSell && <SellerStudio seller={seller} onRegistered={(next) => { setSeller(next); }} onCreated={() => { void load(); }} />}

        <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading ? <p className="text-zinc-500">Loading Bazaar…</p> : modules.map((module) => (
            <article key={module.id} className="flex min-h-72 flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="rounded-xl bg-zinc-100 p-3"><Package className="h-5 w-5" /></div>
                <span className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600">v{module.version}</span>
              </div>
              <h3 className="mt-4 text-xl font-semibold">{module.name}</h3>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-600">{module.shortDescription}</p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-500">
                <span>{module.category}</span>{module.language && <span>• {module.language}</span>}{module.framework && <span>• {module.framework}</span>}
              </div>
              <div className="mt-auto border-t border-zinc-100 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div><div className="flex items-center gap-1 text-sm font-medium">{module.sellerName}{module.sellerVerified && <BadgeCheck className="h-4 w-4" />}</div><p className="text-xs text-zinc-500">{module.sellerIsPlatformBot ? "VIBA seller bot" : "Community seller"}</p></div>
                  <div className="text-right"><p className="text-lg font-semibold">{money(module.priceCents, module.currency)}</p><button onClick={() => void buy(module.id)} className="mt-1 inline-flex items-center gap-1 rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white"><ShoppingCart className="h-4 w-4" /> Buy</button></div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function SellerStudio({ seller, onRegistered, onCreated }: { seller: any; onRegistered: (seller: any) => void; onCreated: () => void }) {
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [form, setForm] = useState({ name: "", shortDescription: "", description: "", category: "module", language: "TypeScript", framework: "", version: "1.0.0", license: "commercial", price: "19", downloadUrl: "" });
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");

  const register = async () => {
    try {
      const result = await api<{ seller: any }>("/marketplace/seller/register", { method: "POST", body: JSON.stringify({ displayName, bio }) });
      onRegistered(result.seller); setStatus("Seller profile created.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Registration failed"); }
  };

  const create = async () => {
    try {
      let fileBase64 = "";
      if (file) fileBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.onerror = reject; reader.readAsDataURL(file); });
      await api("/marketplace/seller/modules", { method: "POST", body: JSON.stringify({ ...form, priceCents: Math.round(Number(form.price) * 100), fileName: file?.name, mimeType: file?.type || "application/zip", fileBase64 }) });
      setStatus("Module submitted for verification."); onCreated();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Module submission failed"); }
  };

  return <section className="mt-5 rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm">
    <div className="flex items-center gap-3"><Store className="h-5 w-5" /><div><h2 className="font-semibold">Seller studio</h2><p className="text-sm text-zinc-500">List modules for verification and sale through VIBA.</p></div></div>
    {!seller ? <div className="mt-5 grid gap-3 md:grid-cols-2"><input className="rounded-lg border p-3" placeholder="Seller display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /><input className="rounded-lg border p-3" placeholder="Short seller bio" value={bio} onChange={(e) => setBio(e.target.value)} /><button onClick={() => void register()} className="rounded-lg bg-zinc-950 px-4 py-3 text-white md:col-span-2">Create seller profile</button></div> : <div className="mt-5 grid gap-3 md:grid-cols-2">
      {Object.entries(form).map(([key, value]) => <input key={key} className="rounded-lg border p-3" placeholder={key} value={value} onChange={(e) => setForm((current) => ({ ...current, [key]: e.target.value }))} />)}
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed p-3 text-sm"><Upload className="h-4 w-4" />{file?.name || "Upload module ZIP (small files)"}<input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <button onClick={() => void create()} className="rounded-lg bg-zinc-950 px-4 py-3 text-white">Submit module</button>
    </div>}
    {status && <p className="mt-3 text-sm text-zinc-600">{status}</p>}
  </section>;
}
