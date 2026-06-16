import Stripe from "stripe";

export function getStripeClient(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set — add it in Railway environment variables.",
    );
  }
  return new Stripe(key, {
    apiVersion: "2025-01-27.acacia" as Stripe.LatestApiVersion,
  });
}

export function isStripeConfigured(): boolean {
  return !!(process.env["STRIPE_SECRET_KEY"] && process.env["STRIPE_PRICE_ID"]);
}

export function getPublishableKey(): string {
  return process.env["STRIPE_PUBLISHABLE_KEY"] ?? "";
}

export function getPriceId(): string {
  const id = process.env["STRIPE_PRICE_ID"];
  if (!id) throw new Error("STRIPE_PRICE_ID is not set — run the seed script and copy the price ID.");
  return id;
}
