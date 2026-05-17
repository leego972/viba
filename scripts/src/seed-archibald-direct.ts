import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_KEY!, {
  apiVersion: "2025-01-27.acacia" as Stripe.LatestApiVersion,
});

const SUBSCRIPTION_PLANS = [
  { id: "pro",        name: "Pro",        tagline: "For power users and professionals",                     monthlyPrice: 29,   yearlyPrice: 290   },
  { id: "enterprise", name: "Enterprise", tagline: "For organizations at scale",                            monthlyPrice: 99,   yearlyPrice: 990   },
  { id: "cyber",      name: "Cyber",      tagline: "Elite cybersecurity arsenal for professionals",         monthlyPrice: 199,  yearlyPrice: 1990  },
  { id: "cyber_plus", name: "Cyber+",     tagline: "Maximum firepower for security teams and agencies",     monthlyPrice: 499,  yearlyPrice: 4990  },
  { id: "titan",      name: "Titan",      tagline: "Unlimited power for large-scale enterprise operations", monthlyPrice: 4999, yearlyPrice: 49990 },
];

const CREDIT_PACKS = [
  { id: "pack_500",   name: "Quick Top-Up",  credits: 10000,  price: 4.99  },
  { id: "pack_2500",  name: "Boost Pack",    credits: 25000,  price: 9.99  },
  { id: "pack_5000",  name: "Power Top-Up",  credits: 50000,  price: 17.99 },
  { id: "pack_10000", name: "Mega Top-Up",   credits: 150000, price: 49.99 },
];

const CLONE_PLANS = [
  { id: "clone_simple",     name: "Clone — Simple",     price: 500  },
  { id: "clone_standard",   name: "Clone — Standard",   price: 1000 },
  { id: "clone_advanced",   name: "Clone — Advanced",   price: 2000 },
  { id: "clone_enterprise", name: "Clone — Enterprise", price: 3500 },
];

async function findOrCreateProduct(name: string, metadata: Record<string, string>) {
  const key = Object.keys(metadata)[0];
  const val = metadata[key];
  const existing = await stripe.products.search({ query: `metadata['${key}']:'${val}'` });
  if (existing.data.length > 0) return existing.data[0];
  return stripe.products.create({ name, metadata });
}

async function findOrCreatePrice(productId: string, amount: number, currency: string, recurring?: Stripe.PriceCreateParams.Recurring) {
  const prices = await stripe.prices.list({ product: productId, active: true });
  const cents = Math.round(amount * 100);
  const match = prices.data.find(p =>
    p.unit_amount === cents &&
    (recurring ? p.recurring?.interval === recurring.interval : !p.recurring)
  );
  if (match) return match;
  return stripe.prices.create({ product: productId, unit_amount: cents, currency, ...(recurring ? { recurring } : {}) });
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  Archibald Titan AI — Stripe Product Seeder  ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // Verify account
  const account = await stripe.account.retrieve();
  console.log(`Account: ${account.id} (${account.email ?? "no email"})\n`);

  console.log("── Subscription Plans ─────────────────────────────────────────\n");
  for (const plan of SUBSCRIPTION_PLANS) {
    const product = await findOrCreateProduct(`Archibald Titan ${plan.name}`, { plan_id: plan.id });
    const monthly = await findOrCreatePrice(product.id, plan.monthlyPrice, "usd", { interval: "month" });
    const yearly  = await findOrCreatePrice(product.id, plan.yearlyPrice,  "usd", { interval: "year"  });
    console.log(`✓ ${plan.name}: product=${product.id}`);
    console.log(`    monthly $${plan.monthlyPrice} → ${monthly.id}`);
    console.log(`    yearly  $${plan.yearlyPrice}  → ${yearly.id}\n`);
  }

  console.log("── Credit Packs ───────────────────────────────────────────────\n");
  for (const pack of CREDIT_PACKS) {
    const product = await findOrCreateProduct(`Archibald Titan Credits — ${pack.name}`, { pack_id: pack.id });
    const price   = await findOrCreatePrice(product.id, pack.price, "usd");
    console.log(`✓ ${pack.name} (${pack.credits.toLocaleString()} credits): product=${product.id} price=${price.id}\n`);
  }

  console.log("── Clone Plans ────────────────────────────────────────────────\n");
  for (const clone of CLONE_PLANS) {
    const product = await findOrCreateProduct(clone.name, { clone_id: clone.id });
    const price   = await findOrCreatePrice(product.id, clone.price, "usd");
    console.log(`✓ ${clone.name}: product=${product.id} price=${price.id}\n`);
  }

  console.log("✅ All products seeded successfully in your Stripe account.");
}

main().catch(console.error);
