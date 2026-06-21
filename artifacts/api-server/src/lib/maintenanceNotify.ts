import * as nodemailer from "nodemailer";

export type MaintenanceNotice = {
  subject: string;
  body: string;
  html?: string;
};

function destination(): string {
  return process.env["VIBA_ADMIN_EMAIL"]?.trim() || process.env["ADMIN_BOOTSTRAP_EMAIL"]?.trim() || "leego972@gmail.com";
}

function sender(): string {
  return process.env["VIBA_EMAIL_FROM"]?.trim() || `VIBA Maintenance <${destination()}>`;
}

export async function notifyAdmin(input: MaintenanceNotice): Promise<{ sent: boolean; to: string; reason?: string }> {
  const to = destination();
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

  return { sent: true, to };
}
