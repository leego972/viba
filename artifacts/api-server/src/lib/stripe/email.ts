import nodemailer from "nodemailer";
import { logger } from "../logger";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export async function sendAccessTokenEmail(
  to: string,
  accessToken: string,
): Promise<void> {
  const host = process.env["SMTP_HOST"];
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];
  const from = process.env["SMTP_FROM"] ?? user ?? "noreply@viba.guru";
  const port = parseInt(process.env["SMTP_PORT"] ?? "587", 10);

  if (!host || !user || !pass) {
    logger.warn({ to }, "Access token email skipped — SMTP not configured");
    return;
  }

  const vibaUrl = process.env["VIBA_PUBLIC_URL"] ?? "https://viba.guru";
  const safeAccessToken = escapeHtml(accessToken);
  const safeVibaUrl = escapeHtml(vibaUrl);
  const subject = "Your VIBA Access Token";

  const text = [
    "Welcome to VIBA — Collaborative Multi-Agent Orchestration System",
    "",
    "Your subscription is now active. Use the token below to unlock VIBA:",
    "",
    `  ${accessToken}`,
    "",
    `1. Visit ${vibaUrl}`,
    "2. Enter your access token when prompted",
    "3. Connect your AI providers and start collaborating",
    "",
    `Manage subscription: ${vibaUrl}/pricing`,
    "",
    "Keep this token safe — treat it like a password.",
    "— The VIBA Team",
  ].join("\n");

  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111">
  <h2 style="color:#2563eb">Welcome to VIBA</h2>
  <p>Your subscription is active. Here is your access token:</p>
  <div style="background:#f3f4f6;border-radius:8px;padding:16px 20px;margin:16px 0;text-align:center;border:1px solid #e5e7eb">
    <code style="font-size:15px;word-break:break-all;color:#1d4ed8;letter-spacing:0.03em">${safeAccessToken}</code>
  </div>
  <ol style="padding-left:20px;line-height:1.8">
    <li>Visit <a href="${safeVibaUrl}">${safeVibaUrl}</a></li>
    <li>Enter your access token when prompted</li>
    <li>Connect your AI providers and start collaborating</li>
  </ol>
  <p style="margin-top:20px">
    <a href="${safeVibaUrl}/pricing" style="color:#2563eb;text-decoration:none">Manage your subscription →</a>
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
  <p style="color:#6b7280;font-size:12px">
    Keep this token safe — treat it like a password.
  </p>
</div>`.trim();

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    const info = await transporter.sendMail({ from, to, subject, text, html });
    logger.info({ to, messageId: info.messageId }, "Access token email sent");
  } catch (err) {
    logger.error({ to, err }, "Failed to send access token email");
  }
}
