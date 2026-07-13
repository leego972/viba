/**
 * email_send — send emails via the configured SMTP server.
 * Uses SMTP_HOST, SMTP_USER, SMTP_PASS from environment.
 */

export interface MailerTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }

async function sendMail(opts: {
  to: string; subject: string; body: string; html?: string; from?: string; replyTo?: string;
}): Promise<void> {
  const host = process.env["SMTP_HOST"];
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];
  if (!host || !user || !pass) throw new Error("SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS in settings");

  const { createTransport } = await import("nodemailer");
  const transport = createTransport({ host, port: 587, secure: false, auth: { user, pass } });
  await transport.sendMail({
    from: opts.from ?? `"VIBA Agent" <${user}>`,
    to: opts.to,
    replyTo: opts.replyTo,
    subject: opts.subject,
    text: opts.body,
    html: opts.html ?? `<pre style="font-family:sans-serif;white-space:pre-wrap">${opts.body}</pre>`,
  });
}

export function getMailerTools(): MailerTool[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "email_send",
          description: "Send an email via SMTP. Use for delivering reports, outreach emails, notifications, or agent-generated content to a recipient. Requires SMTP to be configured in Settings.",
          parameters: {
            type: "object",
            properties: {
              to: { type: "string", description: "Recipient email address (e.g. user@example.com)" },
              subject: { type: "string", description: "Email subject line" },
              body: { type: "string", description: "Plain-text email body" },
              html: { type: "string", description: "Optional HTML version of the body (overrides plain-text rendering)" },
              from_name: { type: "string", description: "Sender display name (default: 'VIBA Agent')" },
              reply_to: { type: "string", description: "Reply-to email address (optional)" },
            },
            required: ["to", "subject", "body"],
          },
        },
      },
      async execute(args) {
        const to = str(args["to"]);
        const subject = str(args["subject"]);
        const body = str(args["body"]);
        if (!to || !subject || !body) return "Error: to, subject, and body are required";
        const user = process.env["SMTP_USER"] ?? "noreply@viba.guru";
        const fromName = str(args["from_name"], "VIBA Agent");
        try {
          await sendMail({
            to, subject, body,
            html: str(args["html"]) || undefined,
            from: `"${fromName}" <${user}>`,
            replyTo: str(args["reply_to"]) || undefined,
          });
          return `Email sent successfully to ${to} — Subject: "${subject}"`;
        } catch (err) {
          return `Email failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}
