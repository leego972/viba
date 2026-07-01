import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";
import { sendWelcomeEmail, sendVerificationEmail } from "../lib/billingEmail";

declare module "express-session" {
  interface SessionData {
    oauthNonce?: string;
  }
}

interface UserRow {
  id: number;
  email: string;
  password_hash: string | null;
  name: string | null;
  google_id: string | null;
  github_id: string | null;
  subscription_status?: string | null;
  credits_remaining?: number | null;
  credits_period_end?: string | Date | null;
}

function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    subscriptionStatus: user.subscription_status ?? "none",
    creditsRemaining: Number(user.credits_remaining ?? 0),
    creditsPeriodEnd: user.credits_period_end ?? null,
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function getBaseUrl(req: { protocol: string; hostname: string }): string {
  const host = process.env["PUBLIC_ORIGIN"] ?? `${req.protocol}://${req.hostname}`;
  return host;
}

function encodeOAuthState(returnPath: string, nonce: string): string {
  return Buffer.from(JSON.stringify({ r: returnPath, n: nonce })).toString("base64url");
}

function decodeOAuthState(state: string): { r: string; n: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString()) as { r?: string; n?: string };
    if (typeof parsed.r !== "string" || typeof parsed.n !== "string") return null;
    return { r: parsed.r, n: parsed.n };
  } catch {
    return null;
  }
}

const router: IRouter = Router();

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
router.get("/auth/me", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const { rows } = await pool.query<UserRow>(
      "SELECT id, email, name, subscription_status, credits_remaining, credits_period_end FROM users WHERE id = $1",
      [req.session.userId],
    );
    if (!rows[0]) {
      req.session.destroy(() => {});
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    res.json(publicUser(rows[0]));
  } catch (err) {
    req.log?.error?.({ err }, "auth/me error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /auth/login ─────────────────────────────────────────────────────────
router.post("/auth/login", async (req, res): Promise<void> => {
  const body = req.body as { email?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  // DB operations only — session callbacks live outside this try/catch to
  // prevent double-send if the session store throws AND fires its callback.
  let user: UserRow;
  try {
    const { rows } = await pool.query<UserRow>(
      "SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL",
      [email],
    );
    const found = rows[0];

    if (!found || !found.password_hash) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const valid = await bcrypt.compare(password, found.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    user = found;
  } catch (err) {
    req.log?.error?.({ err }, "auth/login error");
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  // Session fixation protection: regenerate outside try/catch to avoid double-send
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      req.log?.error?.({ err: regenErr }, "session regenerate error on login");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    req.session.userId = user.id;
    req.session.save((saveErr) => {
      if (saveErr) {
        req.log?.error?.({ err: saveErr }, "session save error on login");
        res.status(500).json({ error: "Internal server error" });
        return;
      }
      res.json({ user: publicUser(user) });
    });
  });
});

// ─── POST /auth/register ──────────────────────────────────────────────────────
router.post("/auth/register", async (req, res): Promise<void> => {
  const body = req.body as { email?: unknown; password?: unknown; name?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() || null : null;

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  // DB operations only — session callbacks live outside this try/catch to
  // prevent double-send if the session store throws AND fires its callback.
  let user: UserRow;
  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query<UserRow>(
      "INSERT INTO users (email, password_hash, name, subscription_status, credits_remaining) VALUES ($1, $2, $3, 'none', 0) RETURNING *",
      [email, hash, name],
    );
    user = rows[0]!;
  } catch (err) {
    req.log?.error?.({ err }, "auth/register error");
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  // Fire-and-forget emails — outside try/catch so errors never reach catch above
  sendVerificationEmail(user.id, email, name ?? undefined, getBaseUrl(req)).catch(() => {});
  sendWelcomeEmail(email, name ?? undefined).catch(() => {});

  // Session fixation protection: regenerate outside try/catch to avoid double-send
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      req.log?.error?.({ err: regenErr }, "session regenerate error on register");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    req.session.userId = user.id;
    req.session.save((saveErr) => {
      if (saveErr) {
        req.log?.error?.({ err: saveErr }, "session save error on register");
        res.status(500).json({ error: "Internal server error" });
        return;
      }
      res.status(201).json({ user: publicUser(user) });
    });
  });
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.clearCookie("viba.sid");
    res.json({ ok: true });
  });
});

// ─── Google OAuth ─────────────────────────────────────────────────────────────
router.get("/auth/google", (req, res): void => {
  const clientId = process.env["GOOGLE_CLIENT_ID"];
  if (!clientId) {
    res.status(503).json({ error: "Google OAuth is not configured." });
    return;
  }
  const returnPath = typeof req.query["returnPath"] === "string" ? req.query["returnPath"] : "/dashboard";
  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/auth/google/callback`;

  // CSRF protection: embed a nonce in the state param
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = encodeOAuthState(returnPath, nonce);
  req.session.oauthNonce = nonce;

  req.session.save(() => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });
});

router.get("/auth/google/callback", async (req, res): Promise<void> => {
  const code = typeof req.query["code"] === "string" ? req.query["code"] : "";
  const stateRaw = typeof req.query["state"] === "string" ? req.query["state"] : "";
  const decoded = stateRaw ? decodeOAuthState(stateRaw) : null;
  const returnPath = decoded?.r ?? "/dashboard";
  if (!code || !decoded || decoded.n !== req.session.oauthNonce) {
    res.redirect(`/login?oauth=google_failed`);
    return;
  }

  try {
    const baseUrl = getBaseUrl(req);
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env["GOOGLE_CLIENT_ID"] ?? "",
        client_secret: process.env["GOOGLE_CLIENT_SECRET"] ?? "",
        redirect_uri: `${baseUrl}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error("Google token exchange failed");
    const token = await tokenRes.json() as { access_token: string };
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!profileRes.ok) throw new Error("Google profile fetch failed");
    const profile = await profileRes.json() as { id: string; email: string; name?: string };

    const { rows } = await pool.query<UserRow>(
      `INSERT INTO users (email, name, google_id, email_verified, subscription_status, credits_remaining)
       VALUES ($1, $2, $3, true, 'none', 0)
       ON CONFLICT (email) DO UPDATE SET google_id = EXCLUDED.google_id, name = COALESCE(users.name, EXCLUDED.name), email_verified = true, updated_at = NOW()
       RETURNING *`,
      [profile.email.toLowerCase(), profile.name ?? null, profile.id],
    );
    const user = rows[0]!;
    req.session.regenerate((regenErr) => {
      if (regenErr) { res.redirect("/login?oauth=google_failed"); return; }
      req.session.userId = user.id;
      req.session.save(() => res.redirect(returnPath));
    });
  } catch (err) {
    req.log?.error?.({ err }, "google oauth callback error");
    res.redirect("/login?oauth=google_failed");
  }
});

// ─── GitHub OAuth ─────────────────────────────────────────────────────────────
router.get("/auth/github", (req, res): void => {
  const clientId = process.env["GITHUB_CLIENT_ID"];
  if (!clientId) {
    res.status(503).json({ error: "GitHub OAuth is not configured." });
    return;
  }
  const returnPath = typeof req.query["returnPath"] === "string" ? req.query["returnPath"] : "/dashboard";
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = encodeOAuthState(returnPath, nonce);
  req.session.oauthNonce = nonce;
  req.session.save(() => {
    const params = new URLSearchParams({ client_id: clientId, scope: "read:user user:email", state });
    res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
  });
});

router.get("/auth/github/callback", async (req, res): Promise<void> => {
  const code = typeof req.query["code"] === "string" ? req.query["code"] : "";
  const stateRaw = typeof req.query["state"] === "string" ? req.query["state"] : "";
  const decoded = stateRaw ? decodeOAuthState(stateRaw) : null;
  const returnPath = decoded?.r ?? "/dashboard";
  if (!code || !decoded || decoded.n !== req.session.oauthNonce) {
    res.redirect("/login?oauth=github_failed");
    return;
  }

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env["GITHUB_CLIENT_ID"] ?? "",
        client_secret: process.env["GITHUB_CLIENT_SECRET"] ?? "",
        code,
      }),
    });
    if (!tokenRes.ok) throw new Error("GitHub token exchange failed");
    const token = await tokenRes.json() as { access_token: string };
    const profileRes = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json" } });
    const profile = await profileRes.json() as { id: number; name?: string; email?: string };
    let email = profile.email;
    if (!email) {
      const emailsRes = await fetch("https://api.github.com/user/emails", { headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json" } });
      const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      email = emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email;
    }
    if (!email) throw new Error("GitHub email unavailable");

    const { rows } = await pool.query<UserRow>(
      `INSERT INTO users (email, name, github_id, email_verified, subscription_status, credits_remaining)
       VALUES ($1, $2, $3, true, 'none', 0)
       ON CONFLICT (email) DO UPDATE SET github_id = EXCLUDED.github_id, name = COALESCE(users.name, EXCLUDED.name), email_verified = true, updated_at = NOW()
       RETURNING *`,
      [email.toLowerCase(), profile.name ?? null, String(profile.id)],
    );
    const user = rows[0]!;
    req.session.regenerate((regenErr) => {
      if (regenErr) { res.redirect("/login?oauth=github_failed"); return; }
      req.session.userId = user.id;
      req.session.save(() => res.redirect(returnPath));
    });
  } catch (err) {
    req.log?.error?.({ err }, "github oauth callback error");
    res.redirect("/login?oauth=github_failed");
  }
});

// ─── Password reset placeholder endpoints ────────────────────────────────────
router.post("/auth/forgot-password", (_req, res): void => {
  res.json({ ok: true, message: "If that email exists, a reset link will be sent." });
});

router.post("/auth/reset-password", (_req, res): void => {
  res.json({ ok: true });
});

export default router;
