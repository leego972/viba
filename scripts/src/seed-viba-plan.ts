/**
 * Create the VIBA Pro subscription plan in Stripe.
 *
 * Run once (idempotent — skips creation if the product/price already exists).
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... \
 *   pnpm --filter @workspace/scripts exec tsx src/seed-viba-plan.ts
 *
 * After running, copy the printed STRIPE_PRICE_ID into Railway environment variables.
 */
import Stripe from "stripe";

const key = process.env["STRIPE_SECRET_KEY"];
if (!key) {
  console.error("❌  STRIPE_SECRET_KEY is not set");
  process.exit(1);
}

const isLive = key.startsWith("sk_live_");
console.log(`\nStripe mode: ${isLive ? "🟢 LIVE" : "🟡 TEST"}`);
console.log(`Key prefix:  ${key.slice(0, 12)}...\n`);

const stripe = new Stripe(key, {
  apiVersion: "2025-01-27.acacia" as Stripe.LatestApiVersion,
});

async function seed() {
  // ── Find or create product ────────────────────────────────────────────────
  console.log("Checking for existing VIBA Pro product…");
  const existingProducts = await stripe.products.search({
    query: "name:'VIBA Pro' AND active:'true'",
  });

  let product: Stripe.Product;
  if (existingProducts.data.length > 0) {
    product = existingProducts.data[0]!;
    console.log(`  ✅ Product already exists: ${product.id} — "${product.name}"`);
  } else {
    product = await stripe.products.create({
      name: "VIBA Pro",
      description:
        "Full access to VIBA — Collaborative Multi-Agent Orchestration System. " +
        "Coordinate ChatGPT, Claude, Gemini, Perplexity, and more in a single session. " +
        "7-day free trial included.",
    });
    console.log(`  ✅ Created product: ${product.id} — "${product.name}"`);
  }

  // ── Find or create price ($50/month) ────────────────────────────────────
  console.log("\nChecking for existing $50/month price…");
  const existingPrices = await stripe.prices.list({
    product: product.id,
    active: true,
  });

  const monthly = existingPrices.data.find(
    (p) => p.recurring?.interval === "month" && p.unit_amount === 5000,
  );

  let price: Stripe.Price;
  if (monthly) {
    price = monthly;
    console.log(`  ✅ Price already exists: ${price.id} — $50.00/month`);
  } else {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: 5000, // $50.00 USD
      currency: "usd",
      recurring: { interval: "month" },
    });
    console.log(`  ✅ Created price: ${price.id} — $50.00/month`);
  }

  // ── Output ────────────────────────────────────────────────────────────────
  console.log("\n────────────────────────────────────────────────────────────");
  console.log("  Add these to Railway environment variables:");
  console.log(`  STRIPE_PRICE_ID=${price.id}`);
  console.log("────────────────────────────────────────────────────────────\n");
}

seed().catch((err) => {
  console.error("❌  Error:", (err as Error).message);
  process.exit(1);
});
