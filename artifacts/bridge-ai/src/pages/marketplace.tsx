import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

type Module = {
  id: number;
  slug: string;
  name: string;
  shortDescription: string;
  category: string;
  priceCents: number;
  currency: string;
  sellerName: string;
  sellerVerified: boolean;
  sellerIsPlatformBot: boolean;
};

export default function MarketplacePage() {
  const [modules, setModules] = useState<Module[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
    setLoading(true);
    fetch(`/api/marketplace/modules${query}`, { credentials: "include", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Bazaar is temporarily unavailable.");
        return res.json() as Promise<{ modules: Module[] }>;
      })
      .then((data) => {
        setModules(data.modules ?? []);
        setError("");
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Bazaar could not be loaded.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [search]);

  const visible = useMemo(() => modules, [modules]);

  async function buy(moduleId: number) {
    const res = await fetch(`/api/marketplace/modules/${moduleId}/checkout`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await res.json() as { checkoutUrl?: string; error?: string };
    if (!res.ok || !data.checkoutUrl) {
      setError(data.error === "already_owned" ? "You already own this module." : "Checkout could not be started.");
      return;
    }
    window.location.assign(data.checkoutUrl);
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">VIBA Bazaar</p>
            <h1 className="text-3xl font-semibold tracking-tight">Verified reusable modules</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Only active modules that have passed verification are shown for sale.
            </p>
          </div>
          <Link href="/module-inventory" className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">
            My module inventory
          </Link>
        </header>

        <label className="block">
          <span className="sr-only">Search modules</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search verified modules"
            className="w-full rounded-lg border bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">{error}</div>}
        {loading ? <p className="text-sm text-muted-foreground">Loading Bazaar…</p> : null}
        {!loading && visible.length === 0 ? (
          <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
            No verified modules are currently available. Pending submissions remain hidden until approved.
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((module) => (
            <article key={module.id} className="flex min-h-64 flex-col rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{module.category}</p>
                  <h2 className="mt-1 text-lg font-semibold">{module.name}</h2>
                </div>
                <span className="rounded-full bg-muted px-2 py-1 text-xs">
                  {new Intl.NumberFormat(undefined, { style: "currency", currency: module.currency || "USD" }).format(module.priceCents / 100)}
                </span>
              </div>
              <p className="mt-3 flex-1 text-sm text-muted-foreground">{module.shortDescription}</p>
              <p className="mt-4 text-xs text-muted-foreground">
                Seller: {module.sellerName}{module.sellerVerified ? " · Verified" : ""}{module.sellerIsPlatformBot ? " · VIBA bot" : ""}
              </p>
              <div className="mt-5 flex gap-2">
                <Link href={`/marketplace/${module.slug}`} className="flex-1 rounded-md border px-3 py-2 text-center text-sm hover:bg-muted">
                  Details
                </Link>
                <button onClick={() => void buy(module.id)} className="flex-1 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
                  Buy
                </button>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
