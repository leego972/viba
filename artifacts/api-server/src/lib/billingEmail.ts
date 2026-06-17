/**
 * Billing email notifications — payment failures, cancellations, credit depletion,
 * welcome emails, and email verification.
 * Uses the same SMTP config as the access-token email system.
 * Never deletes user data — only notifies and guides to restore service.
 */
import nodemailer from "nodemailer";
import { pool } from "@workspace/db";
import { logger } from "./logger";

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function makeTransport() {
  const host = process.env["SMTP_HOST"];
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];
  const port = parseInt(process.env["SMTP_PORT"] ?? "587", 10);
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

const vibaUrl = () => process.env["PUBLIC_ORIGIN"] ?? process.env["VIBA_PUBLIC_URL"] ?? "https://viba.guru";
const fromAddr = () => process.env["SMTP_FROM"] ?? process.env["SMTP_USER"] ?? "noreply@viba.guru";

async function send(to: string, subject: string, text: string, html: string): Promise<void> {
  const t = makeTransport();
  if (!t) { logger.warn({ to, subject }, "Billing email skipped — SMTP not configured"); return; }
  try {
    const info = await t.sendMail({ from: fromAddr(), to, subject, text, html });
    logger.info({ to, subject, messageId: info.messageId }, "Billing email sent");
  } catch (err) {
    logger.error({ to, subject, err }, "Billing email failed to send");
  }
}

// ─── Welcome email ─────────────────────────────────────────────────────────────
export async function sendWelcomeEmail(to: string, name?: string): Promise<void> {
  const url = `${vibaUrl()}/dashboard`;
  const greeting = name ? `Hi ${esc(name)},` : "Hi there,";
  const subject = "Welcome to VIBA — your AI orchestration workspace is ready";
  const text = [
    greeting,
    "",
    "Your VIBA account is ready! Start a session to orchestrate ChatGPT, Claude, Gemini, and more in one collaborative workflow.",
    "",
    `Go to your dashboard: ${url}`,
    "",
    "— The VIBA Team",
  ].join("\n");
  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111;padding:32px">
  <h2 style="color:#6366f1">Welcome to VIBA!</h2>
  <p>${greeting}</p>
  <p>Your workspace is ready. Start your first session to orchestrate multiple AI agents — ChatGPT, Claude, Gemini, Perplexity, and more — in one collaborative workflow.</p>
  <div style="text-align:center;margin:28px 0">
    <a href="${esc(url)}" style="background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Go to Dashboard →</a>
  </div>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
  <p style="color:#9ca3af;font-size:12px">The VIBA Team · <a href="${esc(vibaUrl())}" style="color:#9ca3af">viba.guru</a></p>
</div>`.trim();
  await send(to, subject, text, html);
}

// ─── Email verification ────────────────────────────────────────────────────────
export async function sendVerificationEmail(
  userId: number,
  to: string,
  name?: string,
  baseUrl?: string,
): Promise<void> {
  const crypto = await import("node:crypto");
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  try {
    await pool.query(
      `INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [userId, token, expiresAt],
    );
  } catch (err) {
    logger.error({ err, userId }, "Failed to store email verification token");
    return;
  }

  const origin = baseUrl ?? vibaUrl();
  const verifyUrl = `${origin}/verify-email?token=${token}`;
  const greeting = name ? `Hi ${esc(name)},` : "Hi there,";
  const subject = "Verify your VIBA email address";
  const text = [
    greeting,
    "",
    "Please verify your email address to complete your VIBA account setup:",
    "",
    verifyUrl,
    "",
    "This link expires in 24 hours. If you didn't create a VIBA account, you can safely ignore this email.",
    "— The VIBA Team",
  ].join("\n");
  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111;padding:32px">
  <h2>Verify your email</h2>
  <p>${greeting}</p>
  <p>Click below to verify your email address and activate your VIBA account.</p>
  <div style="text-align:center;margin:28px 0">
    <a href="${esc(verifyUrl)}" style="background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Verify Email →</a>
  </div>
  <p style="color:#6b7280;font-size:14px">This link expires in 24 hours. If you didn't create a VIBA account, you can safely ignore this email.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
  <p style="color:#9ca3af;font-size:12px">The VIBA Team</p>
</div>`.trim();
  await send(to, subject, text, html);
}

// ─── Payment failed ────────────────────────────────────────────────────────────
export async function sendPaymentFailedEmail(to: string): Promise<void> {
  const url = `${vibaUrl()}/billing`;
  const subject = "⚠️ VIBA — Payment failed, please update your card";
  const text = [
    "Hi there,",
    "",
    "We were unable to process your VIBA membership payment.",
    "",
    "Your data is safe — we never delete accounts due to payment issues.",
    "To restore full access please update your payment method:",
    "",
    `  ${url}`,
    "",
    "Once payment clears, your service is restored automatically.",
    "— The VIBA Team",
  ].join("\n");
  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111;padding:32px">
  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:24px">
    <strong style="color:#dc2626">⚠️ Payment failed — action required</strong>
  </div>
  <p>Hi there,</p>
  <p>We were unable to process your <strong>VIBA membership payment</strong>.</p>
  <p><strong>Your data is completely safe</strong> — we never delete accounts due to payment issues.</p>
  <p>To restore full access, update your payment details:</p>
  <div style="text-align:center;margin:28px 0">
    <a href="${esc(url)}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Update Payment Details →</a>
  </div>
  <p style="color:#6b7280;font-size:14px">Once your payment clears, your service is restored automatically — no further action needed.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
  <p style="color:#9ca3af;font-size:12px">Need help? Reply to this email — The VIBA Team</p>
</div>`.trim();
  await send(to, subject, text, html);
}

// ─── Subscription canceled (after repeated payment failures) ──────────────────
export async function sendSubscriptionCanceledEmail(to: string): Promise<void> {
  const url = `${vibaUrl()}/pricing`;
  const subject = "Your VIBA subscription has been canceled";
  const text = [
    "Hi there,",
    "",
    "Your VIBA membership has been canceled after several failed payment attempts.",
    "",
    "Your account data is preserved — we never delete it.",
    "To restore full access, resubscribe at:",
    "",
    `  ${url}`,
    "",
    "You can pick up exactly where you left off.",
    "— The VIBA Team",
  ].join("\n");
  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111;padding:32px">
  <h2>Your VIBA membership has been canceled</h2>
  <p>Hi there,</p>
  <p>Your membership was canceled after several failed payment attempts.</p>
  <p><strong>Your account data is completely preserved.</strong> All your sessions, agents, and settings are intact.</p>
  <p>To restore full access, simply resubscribe:</p>
  <div style="text-align:center;margin:28px 0">
    <a href="${esc(url)}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Resubscribe to VIBA →</a>
  </div>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
  <p style="color:#9ca3af;font-size:12px">Need help? Reply to this email — The VIBA Team</p>
</div>`.trim();
  await send(to, subject, text, html);
}

// ─── Credits exhausted (throttled — once per 24 h per user) ──────────────────
export async function sendCreditsExhaustedEmail(to: string): Promise<void> {
  const url = `${vibaUrl()}/billing`;
  const subject = "You've used all your VIBA credits — top up to continue";
  const text = [
    "Hi there,",
    "",
    "You've used all your monthly VIBA credits. AI agent services are paused until you top up.",
    "",
    "Buy more credits to continue right now:",
    `  ${url}`,
    "",
    "Your monthly allowance (1,000 credits) resets automatically at your next billing date.",
    "— The VIBA Team",
  ].join("\n");
  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111;padding:32px">
  <h2>Credits exhausted — services paused</h2>
  <p>Hi there,</p>
  <p>You've used all your monthly VIBA credits. <strong>AI agent services are paused</strong> until you top up.</p>
  <div style="text-align:center;margin:28px 0">
    <a href="${esc(url)}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Buy More Credits →</a>
  </div>
  <p style="color:#6b7280;font-size:14px">Your monthly allowance (1,000 credits) resets automatically at your next billing date. Top up now to continue without waiting.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
  <p style="color:#9ca3af;font-size:12px">The VIBA Team</p>
</div>`.trim();
  await send(to, subject, text, html);
}

// ─── Low credits warning (throttled — once per 7 days per user) ──────────────
// Fires when credits drop to or below LOW_CREDITS_THRESHOLD.
const LOW_CREDITS_THRESHOLD = 100;

export async function sendLowCreditsWarningIfNeeded(userId: number): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT email, credits_remaining, low_credits_notified_at FROM users WHERE id = $1`,
      [userId],
    );
    const row = result.rows[0] as
      | { email: string; credits_remaining: number; low_credits_notified_at: Date | null }
      | undefined;
    if (!row) return;
    if (row.credits_remaining > LOW_CREDITS_THRESHOLD) return;
    if (row.credits_remaining <= 0) return; // exhausted email handles this case

    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    if (row.low_credits_notified_at && Date.now() - new Date(row.low_credits_notified_at).getTime() < WEEK_MS) return;

    // Update timestamp before sending to prevent duplicates under concurrent requests
    await pool.query(
      `UPDATE users SET low_credits_notified_at = NOW() WHERE id = $1`,
      [userId],
    );

    const url = `${vibaUrl()}/billing`;
    const subject = `⚡ VIBA — You have ${row.credits_remaining} credits remaining`;
    const text = [
      "Hi there,",
      "",
      `You have ${row.credits_remaining} VIBA credits remaining this period.`,
      "",
      "Top up now to keep your AI agents running without interruption:",
      `  ${url}`,
      "",
      "— The VIBA Team",
    ].join("\n");
    const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111;padding:32px">
  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:24px">
    <strong style="color:#92400e">⚡ ${row.credits_remaining} credits remaining</strong>
  </div>
  <p>Hi there,</p>
  <p>You're running low on VIBA credits. Top up now to keep your AI agents running without interruption.</p>
  <div style="text-align:center;margin:28px 0">
    <a href="${esc(url)}" style="background:#f59e0b;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Top Up Credits →</a>
  </div>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
  <p style="color:#9ca3af;font-size:12px">The VIBA Team</p>
</div>`.trim();
    await send(row.email, subject, text, html);
  } catch (err) {
    logger.error({ err, userId }, "sendLowCreditsWarningIfNeeded failed");
  }
}

// ─── Throttled credits-exhausted reminder (call from credit gate) ─────────────
export async function sendCreditsExhaustedReminder(userId: number): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT email, credits_exhausted_notified_at FROM users WHERE id = $1`,
      [userId],
    );
    const row = result.rows[0] as
      | { email: string; credits_exhausted_notified_at: Date | null }
      | undefined;
    if (!row) return;

    const lastSent = row.credits_exhausted_notified_at;
    const DAY_MS = 24 * 60 * 60 * 1000;
    if (lastSent && Date.now() - new Date(lastSent).getTime() < DAY_MS) return;

    // Update timestamp before sending to prevent duplicates under concurrent requests
    await pool.query(
      `UPDATE users SET credits_exhausted_notified_at = NOW() WHERE id = $1`,
      [userId],
    );
    await sendCreditsExhaustedEmail(row.email);
  } catch (err) {
    logger.error({ err, userId }, "sendCreditsExhaustedReminder failed");
  }
}
