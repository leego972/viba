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
      "SELECT id, email, name FROM users WHERE id = $1",
      [req.session.userId],
    );
    if (!rows[0]) {
      req.session.destroy(() => {});
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const user = rows[0];
    res.json({ id: user.id, email: user.email, name: user.name });
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
      "SELECT * FROM users WHERE email = $1",
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
      res.json({ user: { id: user.id, email: user.email, name: user.name } });
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
      "INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING *",
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
      res.status(201).json({ user: { id: user.id, email: user.email, name: user.name } });
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
      scope: "email profile",
      state,
      access_type: "online",
      prompt: "select_account",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });
});

router.get("/auth/google/callback", async (req, res): Promise<void> => {
  const clientId = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    res.status(503).send("Google OAuth not configured.");
    return;
  }

  const code = typeof req.query["code"] === "string" ? req.query["code"] : null;
  const stateStr = typeof req.query["state"] === "string" ? req.query["state"] : "";

  if (!code) {
    res.redirect(`/login?error=google_cancelled`);
    return;
  }

  // Verify CSRF nonce
  const stateData = decodeOAuthState(stateStr);
  if (!stateData || stateData.n !== req.session.oauthNonce) {
    res.redirect(`/login?error=oauth_csrf`);
    return;
  }
  const returnPath = stateData.r;
  delete req.session.oauthNonce;

  try {
    const baseUrl = getBaseUrl(req);
    const redirectUri = `${baseUrl}/api/auth/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      req.log?.error?.({ tokenData }, "Google token exchange failed");
      res.redirect(`/login?error=google_failed`);
      return;
    }

    // Get user info
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userRes.json() as { id?: string; email?: string; name?: string };
    if (!googleUser.email || !googleUser.id) {
      res.redirect(`/login?error=google_no_email`);
      return;
    }

    // Find or create user
    let { rows } = await pool.query<UserRow>("SELECT * FROM users WHERE google_id = $1", [googleUser.id]);
    let user = rows[0];

    if (!user) {
      // Check if email exists (link account)
      const emailCheck = await pool.query<UserRow>("SELECT * FROM users WHERE email = $1", [googleUser.email.toLowerCase()]);
      if (emailCheck.rows[0]) {
        await pool.query("UPDATE users SET google_id = $1 WHERE id = $2", [googleUser.id, emailCheck.rows[0].id]);
        user = { ...emailCheck.rows[0], google_id: googleUser.id };
      } else {
        // Create new user (OAuth emails are pre-verified)
        const insertResult = await pool.query<UserRow>(
          "INSERT INTO users (email, name, google_id, email_verified) VALUES ($1, $2, $3, true) RETURNING *",
          [googleUser.email.toLowerCase(), googleUser.name ?? null, googleUser.id],
        );
        user = insertResult.rows[0]!;
        // Send welcome email (fire-and-forget)
        sendWelcomeEmail(user.email, user.name ?? undefined).catch(() => {});
      }
    }

    // Session fixation protection on OAuth login
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        res.redirect(`/login?error=google_failed`);
        return;
      }
      req.session.userId = user!.id;
      req.session.save(() => {
        res.redirect(returnPath.startsWith("/") ? returnPath : "/dashboard");
      });
    });
  } catch (err) {
    req.log?.error?.({ err }, "Google OAuth callback error");
    res.redirect(`/login?error=google_failed`);
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
  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/auth/github/callback`;

  // CSRF protection: embed a nonce in the state param
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = encodeOAuthState(returnPath, nonce);
  req.session.oauthNonce = nonce;

  req.session.save(() => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "user:email",
      state,
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
  });
});

router.get("/auth/github/callback", async (req, res): Promise<void> => {
  const clientId = process.env["GITHUB_CLIENT_ID"];
  const clientSecret = process.env["GITHUB_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    res.status(503).send("GitHub OAuth not configured.");
    return;
  }

  const code = typeof req.query["code"] === "string" ? req.query["code"] : null;
  const stateStr = typeof req.query["state"] === "string" ? req.query["state"] : "";

  if (!code) {
    res.redirect(`/login?error=github_cancelled`);
    return;
  }

  // Verify CSRF nonce
  const stateData = decodeOAuthState(stateStr);
  if (!stateData || stateData.n !== req.session.oauthNonce) {
    res.redirect(`/login?error=oauth_csrf`);
    return;
  }
  const returnPath = stateData.r;
  delete req.session.oauthNonce;

  try {
    const baseUrl = getBaseUrl(req);
    const redirectUri = `${baseUrl}/api/auth/github/callback`;

    // Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    });
    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      res.redirect(`/login?error=github_failed`);
      return;
    }

    // Get GitHub user
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" },
    });
    const ghUser = await userRes.json() as { id?: number; login?: string; name?: string; email?: string };

    // Get primary email if not public
    let email = ghUser.email;
    if (!email) {
      const emailRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" },
      });
      const emails = await emailRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primary = emails.find((e) => e.primary && e.verified);
      email = primary?.email ?? undefined;
    }

    if (!email || !ghUser.id) {
      res.redirect(`/login?error=github_no_email`);
      return;
    }

    const githubIdStr = String(ghUser.id);

    // Find or create user
    let { rows } = await pool.query<UserRow>("SELECT * FROM users WHERE github_id = $1", [githubIdStr]);
    let user = rows[0];

    if (!user) {
      const emailCheck = await pool.query<UserRow>("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
      if (emailCheck.rows[0]) {
        await pool.query("UPDATE users SET github_id = $1 WHERE id = $2", [githubIdStr, emailCheck.rows[0].id]);
        user = { ...emailCheck.rows[0], github_id: githubIdStr };
      } else {
        // Create new user (GitHub OAuth emails are verified by GitHub)
        const insertResult = await pool.query<UserRow>(
          "INSERT INTO users (email, name, github_id, email_verified) VALUES ($1, $2, $3, true) RETURNING *",
          [email.toLowerCase(), ghUser.name ?? ghUser.login ?? null, githubIdStr],
        );
        user = insertResult.rows[0]!;
        // Send welcome email (fire-and-forget)
        sendWelcomeEmail(user.email, user.name ?? undefined).catch(() => {});
      }
    }

    // Session fixation protection on OAuth login
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        res.redirect(`/login?error=github_failed`);
        return;
      }
      req.session.userId = user!.id;
      req.session.save(() => {
        res.redirect(returnPath.startsWith("/") ? returnPath : "/dashboard");
      });
    });
  } catch (err) {
    req.log?.error?.({ err }, "GitHub OAuth callback error");
    res.redirect(`/login?error=github_failed`);
  }
});

// ─── POST /auth/forgot-password ───────────────────────────────────────────────
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const body = req.body as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) { res.status(400).json({ error: "Email is required." }); return; }

  // Always respond success to prevent email enumeration
  res.json({ ok: true });

  try {
    const { rows } = await pool.query<{ id: number }>(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    if (!rows[0]) return; // no user — silently drop

    const userId = rows[0].id;
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [userId, token, expiresAt],
    );

    const baseUrl = process.env["PUBLIC_ORIGIN"] ?? "https://viba.guru";
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    // Send via SMTP if configured
    const smtpHost = process.env["SMTP_HOST"];
    const smtpUser = process.env["SMTP_USER"];
    const smtpPass = process.env["SMTP_PASS"];
    const from = process.env["SMTP_FROM"] ?? smtpUser ?? "noreply@viba.guru";

    if (smtpHost && smtpUser && smtpPass) {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.default.createTransport({
        host: smtpHost,
        port: parseInt(process.env["SMTP_PORT"] ?? "587", 10),
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transporter.sendMail({
        from,
        to: email,
        subject: "Reset your VIBA password",
        text: `Click the link below to reset your password (expires in 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto"><h2>Reset your VIBA password</h2><p>Click below to set a new password. This link expires in 1 hour.</p><p><a href="${resetUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Reset Password</a></p><p style="color:#6b7280;font-size:12px">If you didn't request this, you can safely ignore this email.</p></div>`,
      });
    }
  } catch (err) {
    req.log?.error?.({ err }, "forgot-password error");
  }
});

// ─── POST /auth/reset-password ────────────────────────────────────────────────
router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const body = req.body as { token?: unknown; password?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!token || !password) {
    res.status(400).json({ error: "Token and password are required." });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  try {
    const { rows } = await pool.query<{ id: number; user_id: number; expires_at: Date; used_at: Date | null }>(
      `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token = $1`,
      [token],
    );
    const row = rows[0];

    if (!row || row.used_at || row.expires_at < new Date()) {
      res.status(400).json({ error: "This reset link is invalid or has expired." });
      return;
    }

    const hash = await bcrypt.hash(password, 12);
    await pool.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [hash, row.user_id]);
    await pool.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1", [row.id]);

    res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err }, "reset-password error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /auth/verify-email ──────────────────────────────────────────────────
router.post("/auth/verify-email", async (req, res): Promise<void> => {
  const body = req.body as { token?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";

  if (!token) {
    res.status(400).json({ error: "Verification token is required." });
    return;
  }

  try {
    const { rows } = await pool.query<{ id: number; user_id: number; expires_at: Date; used_at: Date | null }>(
      `SELECT id, user_id, expires_at, used_at FROM email_verification_tokens WHERE token = $1`,
      [token],
    );
    const row = rows[0];

    if (!row || row.used_at || row.expires_at < new Date()) {
      res.status(400).json({ error: "This verification link is invalid or has expired." });
      return;
    }

    await pool.query(
      `UPDATE users SET email_verified = true, updated_at = NOW() WHERE id = $1`,
      [row.user_id],
    );
    await pool.query(
      `UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`,
      [row.id],
    );

    res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err }, "verify-email error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Legacy: GET /auth/config ─────────────────────────────────────────────────
// Kept for backward compat with Stripe flow — always returns "open" now that
// Clerk / session-based auth is the gate instead of ACCESS_TOKEN.
router.get("/auth/config", (_req, res): void => {
  res.json({ protected: false, mode: "open", publishableKey: null });
});

// ─── POST /auth/verify-bypass ─────────────────────────────────────────────────
// Archibald Titan AI embed bypass: validates the ARCHIBALD_BYPASS_TOKEN and
// sets a session flag so API routes accept bypass requests without login.
router.post("/auth/verify-bypass", (req, res): void => {
  const bypassToken = process.env["ARCHIBALD_BYPASS_TOKEN"]?.trim();
  if (!bypassToken) {
    res.status(404).json({ error: "Bypass not configured" });
    return;
  }
  const body = req.body as { token?: unknown };
  const provided = typeof body.token === "string" ? body.token.trim() : "";
  if (!provided || !timingSafeEqual(provided, bypassToken)) {
    res.status(401).json({ error: "Invalid bypass token" });
    return;
  }
  req.session.bypass = true;
  req.session.save(() => {
    res.json({ valid: true });
  });
});

export default router;
