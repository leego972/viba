import * as nodemailer from "nodemailer";

export type MaintenanceNotice = {
  subject: string;
  body: string;
  html?: string;
};

const lastSentAtBySubject = new Map<string, number>();

function destination(): string {
  return process.env["VIBA_ADMIN_EMAIL"]?.trim() || process.env["ADMIN_BOOTSTRAP_EMAIL"]?.trim() || "leego972@gmail.com";
}

function sender(): string {
  return process.env["VIBA_EMAIL_FROM"]?.trim() || `VIBA Maintenance <${destination()}>`;
}

function emailEnabled(): boolean {
  return process.env["VIBA_MAINTENANCE_EMAILS_ENABLED"] === "true";
}

function throttleMs(): number {
  const minutes = Number(process.env["VIBA_MAINTENANCE_EMAIL_THROTTLE_MINUTES"] ?? 360);
  if (!Number.isFinite(minutes) || minutes < 15) return 360 * 60 * 1000;
  return minutes * 60 * 1000;
}

function throttleKey(input: MaintenanceNotice): string {
  return `${destination()}::${input.subject}`.toLowerCase();
}

export async function notifyAdmin(input: MaintenanceNotice): Promise<{ sent: boolean; to: string; reason?: string }> {
  const to = destination();

  if (!emailEnabled()) {
    return { sent: false, to, reason: "Maintenance email notifications are disabled. Set VIBA_MAINTENANCE_EMAILS_ENABLED=true to enable." };
  }

  const key = throttleKey(input);
  const now = Date.now();
  const lastSentAt = lastSentAtBySubject.get(key) ?? 0;
  const waitMs = throttleMs();
  if (now - lastSentAt < waitMs) {
    return { sent: false, to, reason: `Maintenance email throttled for ${Math.ceil((waitMs - (now - lastSentAt)) / 60000)} more minutes.` };
  }

  const host = process.env["VIBA_EMAIL_HOST"];
  const user = process.env["VIBA_EMAIL_USER"];
  const pass = process.env["VIBA_EMAIL_PASSWORD"];

  if (!host || !user || !pass) {
    return { sent: false, to, reason: "Email transport environment is not configured." };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env["VIBA_EMAIL_PORT"] ?? 587),
    secure: process.env["VIBA_EMAIL_SECURE"] === "true",
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: sender(),
    to,
    subject: input.subject,
    text: input.body,
    html: input.html,
  });

  lastSentAtBySubject.set(key, now);
  return { sent: true, to };
}
