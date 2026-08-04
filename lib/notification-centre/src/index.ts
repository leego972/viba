export type NotificationChannel = "email" | "sms" | "push" | "in-app";

export type NotificationAddress = {
  channel: NotificationChannel;
  value: string;
};

export type NotificationMessage = {
  id: string;
  tenantId: string;
  templateId: string;
  recipient: NotificationAddress;
  subject?: string;
  text: string;
  html?: string;
  metadata?: Readonly<Record<string, unknown>>;
};

export type DeliveryReceipt = {
  providerMessageId?: string;
  acceptedAt: string;
};

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  send(message: NotificationMessage): Promise<DeliveryReceipt>;
}

export function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const TOKEN = /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g;

export function renderTemplate(
  source: string,
  values: Readonly<Record<string, string | number>>,
  options: { html?: boolean } = {},
): string {
  return source.replace(TOKEN, (_match, key: string) => {
    if (!(key in values)) throw new Error(`missing template value: ${key}`);
    const value = values[key]!;
    return options.html ? escapeHtml(value) : String(value);
  });
}

export class NotificationRouter {
  private readonly providers = new Map<NotificationChannel, NotificationProvider>();

  register(provider: NotificationProvider): void {
    if (this.providers.has(provider.channel)) {
      throw new Error(`provider already registered for ${provider.channel}`);
    }
    this.providers.set(provider.channel, provider);
  }

  async deliver(message: NotificationMessage): Promise<DeliveryReceipt> {
    if (!message.tenantId) throw new Error("tenantId is required");
    const provider = this.providers.get(message.recipient.channel);
    if (!provider) throw new Error(`no provider registered for ${message.recipient.channel}`);
    return provider.send(message);
  }
}
