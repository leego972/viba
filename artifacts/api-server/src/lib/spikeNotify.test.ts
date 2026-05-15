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
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    const mod = await import("./spikeNotify");
    sendSpikeNotifications = mod.sendSpikeNotifications;

    const { logger } = await import("./logger");
    warnMock = logger.warn as ReturnType<typeof vi.fn>;
    errorMock = logger.error as ReturnType<typeof vi.fn>;

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

    it("does nothing when no webhookUrl is configured", async () => {
      await sendSpikeNotifications({ ...BASE_OPTS, webhookUrl: null });
      expect(fetchMock).not.toHaveBeenCalled();
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
});
