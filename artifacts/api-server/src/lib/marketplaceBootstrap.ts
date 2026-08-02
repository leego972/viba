import { pool } from "@workspace/db";
import { logger } from "./logger";

let bootstrapPromise: Promise<void> | null = null;

export function ensureMarketplaceSchema(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_sellers (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      bio TEXT,
      avatar_url TEXT,
      is_platform_bot BOOLEAN NOT NULL DEFAULT false,
      bot_key TEXT UNIQUE,
      bot_enabled BOOLEAN NOT NULL DEFAULT true,
      verified BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'active',
      stripe_connect_account_id TEXT,
      stripe_connect_onboarded BOOLEAN NOT NULL DEFAULT false,
      total_sales INTEGER NOT NULL DEFAULT 0,
      total_revenue_cents INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_modules (
      id SERIAL PRIMARY KEY,
      seller_id INTEGER NOT NULL REFERENCES marketplace_sellers(id) ON DELETE RESTRICT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      short_description TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'module',
      tags TEXT[] NOT NULL DEFAULT '{}',
      language TEXT,
      framework TEXT,
      version TEXT NOT NULL DEFAULT '1.0.0',
      license TEXT NOT NULL DEFAULT 'commercial',
      price_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'usd',
      status TEXT NOT NULL DEFAULT 'draft',
      verification_status TEXT NOT NULL DEFAULT 'pending',
      verification_report JSONB,
      manifest JSONB NOT NULL DEFAULT '{}',
      compatibility JSONB NOT NULL DEFAULT '{}',
      requirements JSONB NOT NULL DEFAULT '{}',
      storage_key TEXT,
      download_url TEXT,
      file_name TEXT,
      file_size_bytes INTEGER,
      file_hash_sha256 TEXT,
      preview_image_url TEXT,
      demo_url TEXT,
      featured BOOLEAN NOT NULL DEFAULT false,
      generated_by_viba BOOLEAN NOT NULL DEFAULT false,
      source_build_id TEXT,
      total_sales INTEGER NOT NULL DEFAULT 0,
      total_downloads INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_purchases (
      id SERIAL PRIMARY KEY,
      buyer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      module_id INTEGER NOT NULL REFERENCES marketplace_modules(id) ON DELETE RESTRICT,
      seller_id INTEGER NOT NULL REFERENCES marketplace_sellers(id) ON DELETE RESTRICT,
      stripe_checkout_session_id TEXT UNIQUE,
      stripe_payment_intent_id TEXT,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      platform_fee_cents INTEGER NOT NULL DEFAULT 0,
      seller_net_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_module_inventory (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      module_id INTEGER NOT NULL REFERENCES marketplace_modules(id) ON DELETE RESTRICT,
      purchase_id INTEGER REFERENCES marketplace_purchases(id) ON DELETE SET NULL,
      acquired_via TEXT NOT NULL DEFAULT 'purchase',
      license_snapshot JSONB NOT NULL DEFAULT '{}',
      version_owned TEXT NOT NULL DEFAULT '1.0.0',
      download_count INTEGER NOT NULL DEFAULT 0,
      last_downloaded_at TIMESTAMPTZ,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, module_id)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_bot_runs (
      id SERIAL PRIMARY KEY,
      seller_id INTEGER NOT NULL REFERENCES marketplace_sellers(id) ON DELETE CASCADE,
      run_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      modules_created INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      report JSONB NOT NULL DEFAULT '{}',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_module_files (
      id SERIAL PRIMARY KEY,
      module_id INTEGER NOT NULL UNIQUE REFERENCES marketplace_modules(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/zip',
      data BYTEA NOT NULL,
      sha256 TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketplace_modules_status ON marketplace_modules(status, verification_status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketplace_modules_seller ON marketplace_modules(seller_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketplace_inventory_user ON user_module_inventory(user_id, added_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketplace_purchases_buyer ON marketplace_purchases(buyer_user_id, created_at DESC)`);
    logger.info("VIBA marketplace schema ready");
  })().catch((error) => {
    bootstrapPromise = null;
    logger.error({ error }, "VIBA marketplace schema bootstrap failed");
    throw error;
  });
  return bootstrapPromise;
}
