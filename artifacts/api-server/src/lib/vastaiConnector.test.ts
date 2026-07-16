import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
  },
  settingsTable: { key: "key", value: "value" },
}));

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  delete process.env["VAST_AI_API_KEY"];
});

beforeEach(() => {
  vi.resetModules();
});

describe("vastaiConnector — credential resolution", () => {
  it("returns not-configured status when no key is set anywhere", async () => {
    const { getVastConnectorStatus } = await import("./vastaiConnector");
    const status = await getVastConnectorStatus();
    expect(status.apiKeyConfigured).toBe(false);
    expect(status.apiAvailable).toBe(false);
  });

  it("uses the env var key when present and reports instance count", async () => {
    process.env["VAST_AI_API_KEY"] = "fake-test-key";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ instances: [{ id: 1 }, { id: 2 }] }),
    });
    const { getVastConnectorStatus } = await import("./vastaiConnector");
    const status = await getVastConnectorStatus();
    expect(status.apiKeyConfigured).toBe(true);
    expect(status.apiAvailable).toBe(true);
    expect(status.instanceCount).toBe(2);
    // never leak the key into fetch as anything but the Authorization header
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer fake-test-key");
  });

  it("reports apiAvailable=false with an error message on a non-2xx response", async () => {
    process.env["VAST_AI_API_KEY"] = "fake-test-key";
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const { getVastConnectorStatus } = await import("./vastaiConnector");
    const status = await getVastConnectorStatus();
    expect(status.apiAvailable).toBe(false);
    expect(status.error).toMatch(/401/);
  });
});

describe("vastaiConnector — searchVastOffers", () => {
  it("builds the query as a URL-encoded JSON filter and parses offers", async () => {
    process.env["VAST_AI_API_KEY"] = "fake-test-key";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        offers: [
          { id: 42, gpu_name: "RTX_4090", num_gpus: 1, dph_total: 0.35, disk_space: 50, verified: true },
        ],
      }),
    });
    const { searchVastOffers } = await import("./vastaiConnector");
    const result = await searchVastOffers({ gpu_name: { eq: "RTX_4090" } });
    expect(result.ok).toBe(true);
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toMatchObject({ id: 42, gpuName: "RTX_4090", numGpus: 1, dphTotal: 0.35 });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("/bundles/?q=");
    expect(decodeURIComponent(calledUrl)).toContain('"gpu_name":{"eq":"RTX_4090"}');
  });
});

describe("vastaiConnector — createVastInstance", () => {
  it("returns the new contract id on success", async () => {
    process.env["VAST_AI_API_KEY"] = "fake-test-key";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, new_contract: 999 }),
    });
    const { createVastInstance } = await import("./vastaiConnector");
    const result = await createVastInstance({ offerId: 42, image: "pytorch/pytorch" });
    expect(result.ok).toBe(true);
    expect(result.contractId).toBe(999);

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/asks/42/");
    expect((call[1] as RequestInit).method).toBe("PUT");
  });

  it("fails cleanly when Vast.ai rejects the offer (e.g. already taken)", async () => {
    process.env["VAST_AI_API_KEY"] = "fake-test-key";
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) });
    const { createVastInstance } = await import("./vastaiConnector");
    const result = await createVastInstance({ offerId: 42, image: "pytorch/pytorch" });
    expect(result.ok).toBe(false);
    expect(result.contractId).toBeNull();
  });
});

describe("vastaiConnector — destroyVastInstance", () => {
  it("calls DELETE on the correct instance path", async () => {
    process.env["VAST_AI_API_KEY"] = "fake-test-key";
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    const { destroyVastInstance } = await import("./vastaiConnector");
    const result = await destroyVastInstance(999);
    expect(result.ok).toBe(true);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/instances/999/");
    expect((call[1] as RequestInit).method).toBe("DELETE");
  });
});
