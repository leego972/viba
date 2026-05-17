import nodemailer from "nodemailer";
import { logger } from "./logger";

export interface SpikeEmailOptions {
  to: string;
  providers: Array<{ provider: string; count: number }>;
  threshold: number;
  settingsUrl: string;
  smtpSettings?: Map<string, string>;
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

function resolveSmtpValue(
  envKey: string,
  dbSettings: Map<string, string> | undefined
): string | undefined {
  return process.env[envKey] ?? dbSettings?.get(envKey) ?? undefined;
}

function getSmtpTransport(
  smtpSettings?: Map<string, string>
): { transporter: nodemailer.Transporter; from: string } | null {
  const host = resolveSmtpValue("SMTP_HOST", smtpSettings);
  const portStr = resolveSmtpValue("SMTP_PORT", smtpSettings);
  const port = portStr ? parseInt(portStr, 10) : 587;
  const user = resolveSmtpValue("SMTP_USER", smtpSettings);
  const pass = resolveSmtpValue("SMTP_PASS", smtpSettings);
  const from = resolveSmtpValue("SMTP_FROM", smtpSettings) ?? user ?? "noreply@bridgeai.local";

  if (!host || !user || !pass) return null;

  const transporter = nodemailer.createTransport({ host, port, auth: { user, pass } });
  return { transporter, from };
}

export async function sendSpikeAlertEmail(opts: SpikeEmailOptions): Promise<void> {
  const smtp = getSmtpTransport(opts.smtpSettings);

  if (!smtp) {
    logger.warn(
      { missingVars: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].filter((v) => !process.env[v] && !opts.smtpSettings?.get(v)) },
      "Spike alert email skipped: SMTP credentials not configured"
    );
    return;
  }

  const { subject, text, html } = buildEmailBody(opts);

  try {
    const info = await smtp.transporter.sendMail({ from: smtp.from, to: opts.to, subject, text, html });
    logger.info({ email: opts.to, messageId: info.messageId }, "Spike alert email sent");
  } catch (err) {
    logger.error({ email: opts.to, err }, "Failed to send spike alert email");
  }
}

export interface TestEmailResult {
  sent: boolean;
  reason?: string;
}

export async function sendTestEmail(
  to: string,
  settingsUrl: string,
  smtpSettings?: Map<string, string>
): Promise<TestEmailResult> {
  const smtp = getSmtpTransport(smtpSettings);

  if (!smtp) {
    const missingVars = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].filter(
      (v) => !process.env[v] && !smtpSettings?.get(v)
    );
    logger.info(
      { to, missingVars },
      "Test email skipped: SMTP not configured"
    );
    return { sent: false, reason: "SMTP not configured" };
  }

  const subject = "[BridgeAI] Test spike alert";
  const text = [
    "This is a test spike alert from BridgeAI.",
    "Your email notification channel is configured correctly.",
    "",
    `Settings: ${settingsUrl}`,
    "",
    "You are receiving this because an alert email address is configured in BridgeAI Settings.",
  ].join("\n");

  try {
    const info = await smtp.transporter.sendMail({ from: smtp.from, to, subject, text });
    logger.info({ email: to, messageId: info.messageId }, "Test spike alert email sent");
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown SMTP error";
    logger.warn({ email: to, err }, "Failed to send test spike alert email");
    return { sent: false, reason: message };
  }
}
