import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SpikeNotifyOptions } from "./spikeNotify";

vi.mock("./logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: vi.fn().mockResolvedValue(["93.184.216.34"]),
    resolve6: vi.fn().mockResolvedValue(["2606:2800:220:1:248:1893:25c8:1946"]),
  },
}));

const WEBHOOK_URL = "https://hooks.example.com/spike";
const SETTINGS_URL = "https://app.example.com/settings";

const BASE_OPTS: SpikeNotifyOptions = {
  providers: [{ provider: "openai", count: 12 }],
  threshold: 5,
  webhookUrl: WEBHOOK_URL,
  settingsUrl: SETTINGS_URL,
};

describe("sendSpikeNotifications", () => {
  let sendSpikeNotifications: (opts: SpikeNotifyOptions) => Promise<void>;
  let warnMock: ReturnType<typeof vi.fn>;
  let errorMock: ReturnType<typeof vi.fn>;
  let infoMock: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    const mod = await import("./spikeNotify");
    sendSpikeNotifications = mod.sendSpikeNotifications;

    const { logger } = await import("./logger");
    warnMock = logger.warn as ReturnType<typeof vi.fn>;
    errorMock = logger.error as ReturnType<typeof vi.fn>;
    infoMock = logger.info as ReturnType<typeof vi.fn>;

    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("cooldown gate", () => {
    it("delivers webhook on first call for a provider", async () => {
      await sendSpikeNotifications(BASE_OPTS);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("skips webhook on a second call within the cooldown window", async () => {
      await sendSpikeNotifications(BASE_OPTS);
      fetchMock.mockClear();

      await sendSpikeNotifications(BASE_OPTS);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("only sends for providers not yet in the cooldown window", async () => {
      await sendSpikeNotifications({
        ...BASE_OPTS,
        providers: [{ provider: "openai", count: 12 }],
      });
      fetchMock.mockClear();

      await sendSpikeNotifications({
        ...BASE_OPTS,
        providers: [
          { provider: "openai", count: 12 },
          { provider: "anthropic", count: 8 },
        ],
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.providers).toHaveLength(1);
      expect(body.providers[0].provider).toBe("anthropic");
    });

    it("delivers again after the 1-hour cooldown expires", async () => {
      await sendSpikeNotifications(BASE_OPTS);
      fetchMock.mockClear();

      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61 * 60 * 1000);

      await sendSpikeNotifications(BASE_OPTS);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("skips entirely when all providers are within the cooldown window", async () => {
      await sendSpikeNotifications(BASE_OPTS);
      fetchMock.mockClear();

      await sendSpikeNotifications(BASE_OPTS);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does nothing when neither webhookUrl nor notificationEmail is configured", async () => {
      const emailSenderMock = vi.fn().mockResolvedValue(undefined);
      await sendSpikeNotifications({ ...BASE_OPTS, webhookUrl: null, notificationEmail: null, _emailSender: emailSenderMock });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(emailSenderMock).not.toHaveBeenCalled();
    });

    it("calls email sender and skips fetch when only notificationEmail is configured", async () => {
      const emailSenderMock = vi.fn().mockResolvedValue(undefined);
      await sendSpikeNotifications({
        ...BASE_OPTS,
        webhookUrl: null,
        notificationEmail: "ops@example.com",
        _emailSender: emailSenderMock,
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(emailSenderMock).toHaveBeenCalledOnce();
      expect(emailSenderMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: "ops@example.com" })
      );
    });

    it("sends webhook and calls email sender when both channels are configured", async () => {
      const emailSenderMock = vi.fn().mockResolvedValue(undefined);
      await sendSpikeNotifications({ ...BASE_OPTS, notificationEmail: "ops@example.com", _emailSender: emailSenderMock });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(emailSenderMock).toHaveBeenCalledOnce();
      expect(emailSenderMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: "ops@example.com" })
      );
    });

    it("does not mark cooldown when only webhook is configured but rejected by safety check", async () => {
      const emailSenderMock = vi.fn().mockResolvedValue(undefined);
      await sendSpikeNotifications({
        ...BASE_OPTS,
        webhookUrl: "http://localhost/bad",
        notificationEmail: null,
        _emailSender: emailSenderMock,
      });
      fetchMock.mockClear();

      await sendSpikeNotifications({
        ...BASE_OPTS,
        webhookUrl: "http://localhost/bad",
        notificationEmail: null,
        _emailSender: emailSenderMock,
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(emailSenderMock).not.toHaveBeenCalled();
    });
  });

  describe("webhook POST body", () => {
    it("sends correct JSON body shape", async () => {
      const opts: SpikeNotifyOptions = {
        providers: [{ provider: "openai", count: 12 }],
        threshold: 5,
        webhookUrl: WEBHOOK_URL,
        settingsUrl: SETTINGS_URL,
      };

      await sendSpikeNotifications(opts);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(WEBHOOK_URL);
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

      const body = JSON.parse(init.body as string);
      expect(body.event).toBe("fallback_spike");
      expect(body.settingsUrl).toBe(SETTINGS_URL);
      expect(typeof body.timestamp).toBe("string");
      expect(() => new Date(body.timestamp)).not.toThrow();
    });

    it("includes all spiking providers with their counts and threshold in the body", async () => {
      const opts: SpikeNotifyOptions = {
        providers: [
          { provider: "openai", count: 12 },
          { provider: "anthropic", count: 7 },
        ],
        threshold: 5,
        webhookUrl: WEBHOOK_URL,
        settingsUrl: SETTINGS_URL,
      };

      await sendSpikeNotifications(opts);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.providers).toHaveLength(2);

      const openai = body.providers.find((p: { provider: string }) => p.provider === "openai");
      expect(openai).toMatchObject({ provider: "openai", fallbackCount: 12, threshold: 5 });

      const anthropic = body.providers.find((p: { provider: string }) => p.provider === "anthropic");
      expect(anthropic).toMatchObject({ provider: "anthropic", fallbackCount: 7, threshold: 5 });
    });
  });

  describe("non-OK HTTP response", () => {
    it("logs a warning but does not throw when webhook returns a non-OK status", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });

      await expect(sendSpikeNotifications(BASE_OPTS)).resolves.toBeUndefined();
      expect(warnMock).toHaveBeenCalledWith(
        expect.objectContaining({ url: WEBHOOK_URL, status: 500 }),
        expect.any(String)
      );
    });

    it("logs a warning for a 404 response without throwing", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404 });

      await expect(sendSpikeNotifications(BASE_OPTS)).resolves.toBeUndefined();
      expect(warnMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 404 }),
        expect.any(String)
      );
    });
  });

  describe("network error handling", () => {
    it("catches a network error and logs it without throwing", async () => {
      fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(sendSpikeNotifications(BASE_OPTS)).resolves.toBeUndefined();
      expect(errorMock).toHaveBeenCalledWith(
        expect.objectContaining({ url: WEBHOOK_URL }),
        expect.any(String)
      );
    });

    it("handles a timeout error gracefully without crashing", async () => {
      fetchMock.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

      await expect(sendSpikeNotifications(BASE_OPTS)).resolves.toBeUndefined();
      expect(errorMock).toHaveBeenCalled();
    });
  });

  describe("email notification details", () => {
    it("logs info with the recipient email address and provider list after email dispatch", async () => {
      const emailSenderMock = vi.fn().mockResolvedValue(undefined);
      await sendSpikeNotifications({
        ...BASE_OPTS,
        webhookUrl: null,
        notificationEmail: "ops@example.com",
        _emailSender: emailSenderMock,
      });

      expect(infoMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: "ops@example.com", providers: expect.arrayContaining(["openai"]) }),
        expect.any(String)
      );
    });

    it("includes all spiking providers in the info log when multiple providers trigger the alert", async () => {
      const emailSenderMock = vi.fn().mockResolvedValue(undefined);
      await sendSpikeNotifications({
        providers: [
          { provider: "openai", count: 12 },
          { provider: "anthropic", count: 8 },
        ],
        threshold: 5,
        webhookUrl: null,
        notificationEmail: "alerts@company.io",
        settingsUrl: SETTINGS_URL,
        _emailSender: emailSenderMock,
      });

      expect(infoMock).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "alerts@company.io",
          providers: expect.arrayContaining(["openai", "anthropic"]),
        }),
        expect.any(String)
      );
    });

    it("forwards the full provider payload (count + threshold + settingsUrl) to the email sender", async () => {
      const emailSenderMock = vi.fn().mockResolvedValue(undefined);
      await sendSpikeNotifications({
        providers: [{ provider: "openai", count: 12 }],
        threshold: 7,
        webhookUrl: null,
        notificationEmail: "ops@example.com",
        settingsUrl: SETTINGS_URL,
        _emailSender: emailSenderMock,
      });

      expect(emailSenderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "ops@example.com",
          providers: expect.arrayContaining([
            expect.objectContaining({ provider: "openai", count: 12 }),
          ]),
          threshold: 7,
          settingsUrl: SETTINGS_URL,
        })
      );
    });

    it("does not log info for email when the provider is within the cooldown window", async () => {
      const emailSenderMock = vi.fn().mockResolvedValue(undefined);
      await sendSpikeNotifications({
        ...BASE_OPTS,
        webhookUrl: null,
        notificationEmail: "ops@example.com",
        _emailSender: emailSenderMock,
      });
      infoMock.mockClear();

      await sendSpikeNotifications({
        ...BASE_OPTS,
        webhookUrl: null,
        notificationEmail: "ops@example.com",
        _emailSender: emailSenderMock,
      });

      expect(infoMock).not.toHaveBeenCalled();
    });
  });
});
