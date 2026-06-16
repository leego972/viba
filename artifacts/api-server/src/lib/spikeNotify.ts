import { logger } from "./logger";
import dns from "node:dns/promises";
import { sendSpikeAlertEmail, type EmailSender } from "./emailNotify";

export interface SpikeNotifyOptions {
  providers: Array<{ provider: string; count: number }>;
  threshold: number;
  webhookUrl?: string | null;
  notificationEmail?: string | null;
  settingsUrl: string;
  smtpSettings?: Map<string, string>;
  _emailSender?: EmailSender;
}

export interface LastNotification {
  sentAt: number;
  providers: string[];
  channels: string[];
  emailAddresses: string[];
}

let lastNotification: LastNotification | null = null;

export function getLastNotification(): LastNotification | null {
  return lastNotification;
}

const COOLDOWN_MS = 60 * 60 * 1000;

const notifiedAt = new Map<string, number>();

function isCooledDown(provider: string): boolean {
  const last = notifiedAt.get(provider);
  if (!last) return true;
  return Date.now() - last > COOLDOWN_MS;
}

function markNotified(providers: string[]): void {
  const now = Date.now();
  for (const p of providers) {
    notifiedAt.set(p, now);
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  delayMs: number,
  label: string
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        logger.warn({ attempt: i + 1, label }, "Retrying after failure");
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
];

function isPrivateAddress(addr: string): boolean {
  return PRIVATE_RANGES.some((r) => r.test(addr));
}

async function assertSafeUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid webhook URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Webhook URL must use http or https");
  }

  const hostname = parsed.hostname;

  if (isPrivateAddress(hostname)) {
    throw new Error("Webhook URL resolves to a private/internal address");
  }

  if (hostname === "localhost") {
    throw new Error("Webhook URL must not target localhost");
  }

  const isIp = /^[\d.:]+$/.test(hostname);
  if (isIp) {
    if (isPrivateAddress(hostname)) {
      throw new Error("Webhook URL must not target a private IP address");
    }
    return;
  }

  const resolveAndCheck = async (resolve: (h: string) => Promise<string[]>, label: string) => {
    try {
      const addresses = await resolve(hostname);
      for (const addr of addresses) {
        if (isPrivateAddress(addr)) {
          throw new Error(`Webhook hostname ${hostname} resolves to private ${label} address ${addr}`);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Webhook")) throw err;
    }
  };

  let resolved = false;
  try {
    await resolveAndCheck(dns.resolve4, "IPv4");
    resolved = true;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Webhook")) throw err;
  }
  try {
    await resolveAndCheck(dns.resolve6, "IPv6");
    resolved = true;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Webhook")) throw err;
  }

  if (!resolved) {
    throw new Error(`Could not resolve webhook hostname: ${hostname}`);
  }
}

export async function sendTestWebhookNotification(
  webhookUrl: string,
  settingsUrl: string
): Promise<void> {
  await assertSafeUrl(webhookUrl);

  const body = {
    event: "test_notification",
    message: "This is a test spike alert from VIBA - Collaborative Multi-Agent Orchestration System. Your webhook is configured correctly.",
    providers: [{ provider: "test", fallbackCount: 0, threshold: 0 }],
    settingsUrl,
    timestamp: new Date().toISOString(),
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Webhook returned status ${res.status}`);
  }

  logger.info({ url: webhookUrl }, "Test spike webhook delivered");
}

function parseEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

export async function sendSpikeNotifications(opts: SpikeNotifyOptions): Promise<void> {
  const {
    providers,
    threshold,
    webhookUrl,
    notificationEmail,
    settingsUrl,
    smtpSettings,
    _emailSender = sendSpikeAlertEmail,
  } = opts;

  const fresh = providers.filter((p) => isCooledDown(p.provider));
  if (fresh.length === 0) return;

  const emails = parseEmails(notificationEmail);
  if (!webhookUrl && emails.length === 0) return;

  let dispatched = false;
  const channels: string[] = [];
  const sentEmailAddresses: string[] = [];

  if (webhookUrl) {
    try {
      await assertSafeUrl(webhookUrl);
      await sendWebhook(webhookUrl, fresh, threshold, settingsUrl);
      channels.push("webhook");
      dispatched = true;
    } catch (err) {
      logger.warn({ url: webhookUrl, err }, "Spike webhook URL rejected by safety check");
    }
  }

  if (emails.length > 0) {
    for (const email of emails) {
      try {
        await withRetry(
          () =>
            _emailSender({
              to: email,
              providers: fresh,
              threshold,
              settingsUrl,
              smtpSettings,
            }),
          3,
          1000,
          `spike-email:${email}`
        );
        logger.info(
          { email, providers: fresh.map((p) => p.provider) },
          "Spike alert email dispatched"
        );
        sentEmailAddresses.push(email);
      } catch (err) {
        logger.error({ email, err }, "Spike alert email failed after retries");
      }
    }
    if (sentEmailAddresses.length > 0) {
      channels.push("email");
      dispatched = true;
    }
  }

  if (dispatched) {
    markNotified(fresh.map((p) => p.provider));
    lastNotification = {
      sentAt: Date.now(),
      providers: fresh.map((p) => p.provider),
      channels,
      emailAddresses: sentEmailAddresses,
    };
  }
}

async function sendWebhook(
  url: string,
  providers: Array<{ provider: string; count: number }>,
  threshold: number,
  settingsUrl: string
): Promise<void> {
  const summary = providers
    .map((p) => `${p.provider} (${p.count} fallbacks)`)
    .join(", ");

  const body = {
    event: "fallback_spike",
    message: `Fallback spike detected: ${summary} exceeded the threshold of ${threshold} per hour.`,
    providers: providers.map((p) => ({
      provider: p.provider,
      fallbackCount: p.count,
      threshold,
    })),
    settingsUrl,
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, "Spike webhook returned non-OK status");
    } else {
      logger.info({ url, providers: providers.map((p) => p.provider) }, "Spike webhook delivered");
    }
  } catch (err) {
    logger.error({ url, err }, "Failed to deliver spike webhook");
  }
}
