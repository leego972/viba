import nodemailer from "nodemailer";
import { logger } from "./logger";

export interface SpikeEmailOptions {
  to: string;
  providers: Array<{ provider: string; count: number }>;
  threshold: number;
  settingsUrl: string;
}

export type EmailSender = (opts: SpikeEmailOptions) => Promise<void>;

function buildEmailBody(opts: SpikeEmailOptions): { subject: string; text: string; html: string } {
  const { providers, threshold, settingsUrl } = opts;
  const summary = providers.map((p) => `${p.provider} (${p.count} fallbacks)`).join(", ");
  const subject = `BridgeAI Spike Alert: ${summary}`;

  const providerLines = providers
    .map((p) => `  • ${p.provider}: ${p.count} fallbacks (threshold: ${threshold})`)
    .join("\n");

  const text = [
    "BridgeAI has detected a fallback spike on the following provider(s):",
    "",
    providerLines,
    "",
    `View and update your alert settings: ${settingsUrl}`,
    "",
    "You are receiving this because an alert email address is configured in BridgeAI Settings.",
  ].join("\n");

  const providerHtmlRows = providers
    .map(
      (p) =>
        `<tr><td style="padding:4px 8px;font-family:monospace">${p.provider}</td><td style="padding:4px 8px">${p.count}</td><td style="padding:4px 8px">${threshold}</td></tr>`
    )
    .join("");

  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <h2 style="color:#dc2626">BridgeAI Spike Alert</h2>
  <p>A fallback spike has been detected on the following provider(s):</p>
  <table style="border-collapse:collapse;width:100%">
    <thead>
      <tr style="background:#f3f4f6">
        <th style="padding:4px 8px;text-align:left">Provider</th>
        <th style="padding:4px 8px;text-align:left">Fallbacks</th>
        <th style="padding:4px 8px;text-align:left">Threshold</th>
      </tr>
    </thead>
    <tbody>${providerHtmlRows}</tbody>
  </table>
  <p style="margin-top:16px">
    <a href="${settingsUrl}" style="color:#2563eb">View alert settings</a>
  </p>
  <p style="color:#6b7280;font-size:12px">
    You are receiving this because an alert email address is configured in BridgeAI Settings.
  </p>
</div>`.trim();

  return { subject, text, html };
}

export async function sendSpikeAlertEmail(opts: SpikeEmailOptions): Promise<void> {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? user ?? "noreply@bridgeai.local";

  if (!host || !user || !pass) {
    logger.warn(
      { missingVars: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].filter((v) => !process.env[v]) },
      "Spike alert email skipped: SMTP credentials not configured"
    );
    return;
  }

  const transporter = nodemailer.createTransport({ host, port, auth: { user, pass } });
  const { subject, text, html } = buildEmailBody(opts);

  try {
    const info = await transporter.sendMail({ from, to: opts.to, subject, text, html });
    logger.info({ email: opts.to, messageId: info.messageId }, "Spike alert email sent");
  } catch (err) {
    logger.error({ email: opts.to, err }, "Failed to send spike alert email");
  }
}
