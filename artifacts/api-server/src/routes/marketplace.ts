import { createHash, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { ensureMarketplaceSchema } from "../lib/marketplaceBootstrap";
import { fulfillMarketplaceCheckout } from "../lib/marketplaceFulfillment";
import { getStripeClient, isStripeConfigured } from "../lib/stripe/client";

const router = Router();
const PLATFORM_FEE_BPS = 1000;
const MAX_INLINE_MODULE_BYTES = 350_000;

function userId(req: Request): number | null {
  return typeof req.session?.userId === "number" ? req.session.userId : null;
}

function safeText(value: unknown, fallback = "", max = 180): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
}

router.use(async (_req, res, next): Promise<void> => {
  try {
    await ensureMarketplaceSchema();
    next();
  } catch {
    res.status(503).json({ error: "marketplace_unavailable" });
  }
});

router.get("/marketplace/modules", async (req, res): Promise<void> => {
  const search = safeText(req.query.search, "", 100);
  const category = safeText(req.query.category, "", 80);
  const params: unknown[] = [];
  const where = ["m.status = 'active'", "m.verification_status = 'verified'", "s.status = 'active'"];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(m.name ILIKE $${params.length} OR m.short_description ILIKE $${params.length})`);
  }
  if (category) {
    params.push(category);
    where.push(`m.category = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT m.id, m.slug, m.name, m.short_description AS "shortDescription", m.description,
            m.category, m.tags, m.language, m.framework, m.version, m.license,
            m.price_cents AS "priceCents", m.currency, m.preview_image_url AS "previewImageUrl",
            m.demo_url AS "demoUrl", m.featured, m.total_sales AS "totalSales",
            s.display_name AS "sellerName", s.slug AS "sellerSlug", s.verified AS "sellerVerified",
            s.is_platform_bot AS "sellerIsPlatformBot"
       FROM marketplace_modules m
       JOIN marketplace_sellers s ON s.id = m.seller_id
      WHERE ${where.join(" AND ")}
      ORDER BY m.featured DESC, m.total_sales DESC, m.created_at DESC
      LIMIT 100`,
    params,
  );
  res.json({ modules: rows });
});

router.get("/marketplace/modules/:slug", async (req, res): Promise<void> => {
  const { rows } = await pool.query(
    `SELECT m.*, s.display_name AS seller_name, s.slug AS seller_slug,
            s.verified AS seller_verified, s.is_platform_bot AS seller_is_platform_bot
       FROM marketplace_modules m
       JOIN marketplace_sellers s ON s.id = m.seller_id
      WHERE m.slug = $1 AND m.status = 'active' AND m.verification_status = 'verified' AND s.status = 'active'
      LIMIT 1`,
    [req.params.slug],
  );
  if (!rows[0]) {
    res.status(404).json({ error: "module_not_found" });
    return;
  }
  res.json({ module: rows[0] });
});

router.post("/marketplace/modules/:id/checkout", async (req, res): Promise<void> => {
  const buyerUserId = userId(req);
  if (!buyerUserId) {
    res.status(401).json({ error: "authentication_required" });
    return;
  }
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "stripe_not_configured" });
    return;
  }
  const moduleId = Number(req.params.id);
  if (!Number.isInteger(moduleId) || moduleId <= 0) {
    res.status(400).json({ error: "invalid_module_id" });
    return;
  }

  const { rows } = await pool.query(
    `SELECT m.id, m.slug, m.name, m.short_description, m.price_cents, m.currency, m.version,
            m.seller_id, u.stripe_customer_id
       FROM marketplace_modules m
       JOIN marketplace_sellers s ON s.id = m.seller_id
       JOIN users u ON u.id = $2
      WHERE m.id = $1 AND m.status = 'active' AND m.verification_status = 'verified' AND s.status = 'active'
      LIMIT 1`,
    [moduleId, buyerUserId],
  );
  const mod = rows[0];
  if (!mod) {
    res.status(404).json({ error: "module_not_available" });
    return;
  }

  const owned = await pool.query(
    `SELECT id FROM user_module_inventory WHERE user_id = $1 AND module_id = $2 LIMIT 1`,
    [buyerUserId, moduleId],
  );
  if (owned.rows[0]) {
    res.status(409).json({ error: "already_owned", inventoryId: owned.rows[0].id });
    return;
  }

  const stripe = getStripeClient();
  let customerId = mod.stripe_customer_id as string | null;
  if (!customerId) {
    const userResult = await pool.query<{ email: string; name: string | null }>(
      `SELECT email, name FROM users WHERE id = $1 LIMIT 1`,
      [buyerUserId],
    );
    const customer = await stripe.customers.create({
      email: userResult.rows[0]?.email,
      name: userResult.rows[0]?.name ?? undefined,
      metadata: { userId: String(buyerUserId), system: "viba" },
    });
    customerId = customer.id;
    await pool.query(`UPDATE users SET stripe_customer_id = $1 WHERE id = $2`, [customerId, buyerUserId]);
  }

  const origin = (process.env.PUBLIC_ORIGIN ?? process.env.PUBLIC_SITE_URL ?? "https://viba.guru").replace(/\/$/, "");
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: String(mod.currency || "usd").toLowerCase(),
        unit_amount: Number(mod.price_cents),
        product_data: {
          name: String(mod.name),
          description: String(mod.short_description).slice(0, 500),
          metadata: { moduleId: String(moduleId), sellerId: String(mod.seller_id) },
        },
      },
    }],
    success_url: `${origin}/module-inventory?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/marketplace/${String(mod.slug)}?purchase=cancelled`,
    metadata: {
      system: "viba_marketplace",
      type: "module_purchase",
      buyerUserId: String(buyerUserId),
      moduleId: String(moduleId),
      sellerId: String(mod.seller_id),
      moduleVersion: String(mod.version),
    },
  });

  const amountCents = Number(mod.price_cents);
  const platformFeeCents = Math.floor((amountCents * PLATFORM_FEE_BPS) / 10_000);
  await pool.query(
    `INSERT INTO marketplace_purchases
       (buyer_user_id, module_id, seller_id, stripe_checkout_session_id, amount_cents,
        currency, platform_fee_cents, seller_net_cents, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
     ON CONFLICT (stripe_checkout_session_id) DO NOTHING`,
    [buyerUserId, moduleId, mod.seller_id, session.id, amountCents, mod.currency, platformFeeCents, amountCents - platformFeeCents],
  );
  res.json({ checkoutUrl: session.url });
});

router.post("/marketplace/checkout/confirm", async (req, res): Promise<void> => {
  const id = userId(req);
  if (!id) {
    res.status(401).json({ error: "authentication_required" });
    return;
  }
  const checkoutSessionId = safeText((req.body as { sessionId?: unknown })?.sessionId, "", 255);
  if (!checkoutSessionId) {
    res.status(400).json({ error: "session_id_required" });
    return;
  }
  try {
    const result = await fulfillMarketplaceCheckout(checkoutSessionId, id);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(409).json({
      error: "purchase_not_fulfilled",
      message: error instanceof Error ? error.message : "Purchase could not be fulfilled",
    });
  }
});

router.get("/marketplace/inventory", async (req, res): Promise<void> => {
  const id = userId(req);
  if (!id) {
    res.status(401).json({ error: "authentication_required" });
    return;
  }
  const { rows } = await pool.query(
    `SELECT i.id AS "inventoryId", i.module_id AS "moduleId", i.acquired_via AS "acquiredVia",
            i.version_owned AS "versionOwned", i.download_count AS "downloadCount",
            i.last_downloaded_at AS "lastDownloadedAt", i.added_at AS "addedAt",
            m.slug, m.name, m.short_description AS "shortDescription", m.category,
            m.language, m.framework, m.version AS "currentVersion", m.preview_image_url AS "previewImageUrl",
            s.display_name AS "sellerName"
       FROM user_module_inventory i
       JOIN marketplace_modules m ON m.id = i.module_id
       JOIN marketplace_sellers s ON s.id = m.seller_id
      WHERE i.user_id = $1
      ORDER BY i.added_at DESC`,
    [id],
  );
  res.json({ modules: rows });
});

router.post("/marketplace/inventory/:inventoryId/use", async (req, res): Promise<void> => {
  const id = userId(req);
  if (!id) {
    res.status(401).json({ error: "authentication_required" });
    return;
  }
  const inventoryId = Number(req.params.inventoryId);
  const { rows } = await pool.query(
    `SELECT i.id, i.module_id, m.name, m.version, m.manifest, m.compatibility, m.requirements
       FROM user_module_inventory i
       JOIN marketplace_modules m ON m.id = i.module_id
      WHERE i.id = $1 AND i.user_id = $2 LIMIT 1`,
    [inventoryId, id],
  );
  if (!rows[0]) {
    res.status(404).json({ error: "inventory_item_not_found" });
    return;
  }
  res.json({
    ok: true,
    module: rows[0],
    instruction: "Attach this module entitlement to a VIBA build session; verify compatibility before installation.",
  });
});

router.get("/marketplace/inventory/:inventoryId/download", async (req, res): Promise<void> => {
  const id = userId(req);
  if (!id) {
    res.status(401).json({ error: "authentication_required" });
    return;
  }
  const inventoryId = Number(req.params.inventoryId);
  const { rows } = await pool.query(
    `SELECT i.id, m.id AS module_id, m.download_url, m.file_name, f.mime_type, f.data
       FROM user_module_inventory i
       JOIN marketplace_modules m ON m.id = i.module_id
       LEFT JOIN marketplace_module_files f ON f.module_id = m.id
      WHERE i.id = $1 AND i.user_id = $2 LIMIT 1`,
    [inventoryId, id],
  );
  const item = rows[0];
  if (!item) {
    res.status(404).json({ error: "inventory_item_not_found" });
    return;
  }
  if (!item.data && !item.download_url) {
    res.status(409).json({ error: "module_file_unavailable" });
    return;
  }
  await pool.query(
    `UPDATE user_module_inventory SET download_count = download_count + 1, last_downloaded_at = NOW() WHERE id = $1`,
    [inventoryId],
  );
  await pool.query(`UPDATE marketplace_modules SET total_downloads = total_downloads + 1 WHERE id = $1`, [item.module_id]);
  if (item.data) {
    const filename = safeText(item.file_name, "viba-module.zip").replace(/[\"\r\n]/g, "");
    res.setHeader("Content-Type", item.mime_type || "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(item.data);
    return;
  }
  res.redirect(302, String(item.download_url));
});

router.get("/marketplace/seller/me", async (req, res): Promise<void> => {
  const id = userId(req);
  if (!id) {
    res.status(401).json({ error: "authentication_required" });
    return;
  }
  const { rows } = await pool.query(`SELECT * FROM marketplace_sellers WHERE user_id = $1 LIMIT 1`, [id]);
  res.json({ seller: rows[0] ?? null });
});

router.post("/marketplace/seller/register", async (req, res): Promise<void> => {
  const id = userId(req);
  if (!id) {
    res.status(401).json({ error: "authentication_required" });
    return;
  }
  const body = req.body as { displayName?: unknown; bio?: unknown };
  const displayName = safeText(body.displayName);
  if (displayName.length < 2) {
    res.status(400).json({ error: "display_name_required" });
    return;
  }
  const slug = `${slugify(displayName)}-${id}`;
  const { rows } = await pool.query(
    `INSERT INTO marketplace_sellers (user_id, slug, display_name, bio, verified, status)
     VALUES ($1,$2,$3,$4,false,'active')
     ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name, bio = EXCLUDED.bio, updated_at = NOW()
     RETURNING *`,
    [id, slug, displayName, safeText(body.bio, "", 2000) || null],
  );
  res.status(201).json({ seller: rows[0] });
});

router.get("/marketplace/seller/modules", async (req, res): Promise<void> => {
  const id = userId(req);
  if (!id) {
    res.status(401).json({ error: "authentication_required" });
    return;
  }
  const { rows } = await pool.query(
    `SELECT m.* FROM marketplace_modules m
       JOIN marketplace_sellers s ON s.id = m.seller_id
      WHERE s.user_id = $1 ORDER BY m.created_at DESC`,
    [id],
  );
  res.json({ modules: rows });
});

router.post("/marketplace/seller/modules", async (req, res): Promise<void> => {
  const id = userId(req);
  if (!id) {
    res.status(401).json({ error: "authentication_required" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const seller = await pool.query<{ id: number }>(
    `SELECT id FROM marketplace_sellers WHERE user_id = $1 AND status = 'active' LIMIT 1`,
    [id],
  );
  if (!seller.rows[0]) {
    res.status(403).json({ error: "seller_registration_required" });
    return;
  }

  const name = safeText(body.name);
  const shortDescription = safeText(body.shortDescription, "", 500);
  if (name.length < 3 || shortDescription.length < 10) {
    res.status(400).json({ error: "name_and_description_required" });
    return;
  }

  const baseSlug = slugify(name);
  const slug = `${baseSlug}-${randomUUID().slice(0, 8)}`;
  const priceCents = Math.max(0, Math.round(Number(body.priceCents ?? 0)));
  const fileBase64 = typeof body.fileBase64 === "string" ? body.fileBase64 : "";
  let fileData: Buffer | null = null;
  if (fileBase64) {
    fileData = Buffer.from(fileBase64, "base64");
    if (!fileData.length || fileData.length > MAX_INLINE_MODULE_BYTES) {
      res.status(413).json({ error: "module_file_too_large", maxBytes: MAX_INLINE_MODULE_BYTES });
      return;
    }
  }
  const hash = fileData ? createHash("sha256").update(fileData).digest("hex") : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO marketplace_modules
       (seller_id, slug, name, short_description, description, category, tags, language, framework,
        version, license, price_cents, currency, status, verification_status, manifest, compatibility,
        requirements, download_url, file_name, file_size_bytes, file_hash_sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'usd','draft','pending',$13::jsonb,$14::jsonb,
               $15::jsonb,$16,$17,$18,$19)
       RETURNING id`,
      [
        seller.rows[0].id,
        slug,
        name,
        shortDescription,
        safeText(body.description, "", 10000) || null,
        safeText(body.category, "module", 80),
        Array.isArray(body.tags) ? body.tags.map(String).slice(0, 20) : [],
        safeText(body.language) || null,
        safeText(body.framework) || null,
        safeText(body.version, "1.0.0", 40),
        safeText(body.license, "commercial", 80),
        priceCents,
        JSON.stringify(body.manifest ?? {}),
        JSON.stringify(body.compatibility ?? {}),
        JSON.stringify(body.requirements ?? {}),
        safeText(body.downloadUrl, "", 2000) || null,
        safeText(body.fileName, `${baseSlug}.zip`, 255),
        fileData?.length ?? null,
        hash,
      ],
    );
    if (fileData) {
      await client.query(
        `INSERT INTO marketplace_module_files (module_id, file_name, mime_type, data, sha256)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          inserted.rows[0]!.id,
          safeText(body.fileName, `${baseSlug}.zip`, 255),
          safeText(body.mimeType, "application/zip", 120),
          fileData,
          hash,
        ],
      );
    }
    await client.query("COMMIT");
    res.status(201).json({
      ok: true,
      moduleId: inserted.rows[0]!.id,
      slug,
      status: "draft",
      verificationStatus: "pending",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({
      error: "module_creation_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    client.release();
  }
});

router.get("/marketplace/seller-bots/health", async (_req, res): Promise<void> => {
  const { rows } = await pool.query(
    `SELECT s.id, s.display_name AS "displayName", s.bot_key AS "botKey",
            s.bot_enabled AS "botEnabled", s.status, MAX(r.started_at) AS "lastRunAt",
            (ARRAY_AGG(r.status ORDER BY r.started_at DESC))[1] AS "lastRunStatus",
            (ARRAY_AGG(r.error ORDER BY r.started_at DESC))[1] AS "lastError"
       FROM marketplace_sellers s
       LEFT JOIN marketplace_bot_runs r ON r.seller_id = s.id
      WHERE s.is_platform_bot = true
      GROUP BY s.id ORDER BY s.display_name`,
  );
  res.json({ bots: rows });
});

export default router;
