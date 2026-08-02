import { describe, it, expect, vi, beforeEach } from "vitest";
import { VibaClient, VibaApiError } from "./vibaClient";

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

describe("VibaClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the API key as a Bearer token on every call", async () => {
    const fetchMock = mockFetchOnce(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const client = new VibaClient({ apiKey: "viba_live_abc123", baseUrl: "https://api.example.com" });
    await client.getMissionStatus(7);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/task-intake/7/status",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer viba_live_abc123" }),
      }),
    );
  });

  it("strips a trailing slash from baseUrl", async () => {
    const fetchMock = mockFetchOnce(200, {});
    vi.stubGlobal("fetch", fetchMock);

    const client = new VibaClient({ apiKey: "k", baseUrl: "https://api.example.com/" });
    await client.getMissionStatus(1);

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/task-intake/1/status", expect.anything());
  });

  it("createMission POSTs { request } as JSON body", async () => {
    const fetchMock = mockFetchOnce(200, { task_id: 5 });
    vi.stubGlobal("fetch", fetchMock);

    const client = new VibaClient({ apiKey: "k", baseUrl: "https://api.example.com" });
    const result = await client.createMission("build me a landing page");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/task-intake/create",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ request: "build me a landing page" }),
      }),
    );
    expect(result).toEqual({ task_id: 5 });
  });

  it.each([
    ["approveMission", (c: VibaClient) => c.approveMission(3), "POST", "/api/task-intake/3/approve"],
    ["cancelMission", (c: VibaClient) => c.cancelMission(3), "POST", "/api/task-intake/3/cancel"],
    ["getMissionPlan", (c: VibaClient) => c.getMissionPlan(3), "GET", "/api/task-intake/3/plan"],
    ["getEvidenceReport", (c: VibaClient) => c.getEvidenceReport(3), "GET", "/api/task-intake/3/evidence-report"],
  ])("%s calls %s %s", async (_name, call, method, path) => {
    const fetchMock = mockFetchOnce(200, {});
    vi.stubGlobal("fetch", fetchMock);
    const client = new VibaClient({ apiKey: "k", baseUrl: "https://api.example.com" });
    await call(client);
    expect(fetchMock).toHaveBeenCalledWith(`https://api.example.com${path}`, expect.objectContaining({ method }));
  });

  it("throws VibaApiError with status and body on a non-2xx response", async () => {
    const fetchMock = mockFetchOnce(401, { error: "invalid_api_key", message: "The API key is invalid or revoked." });
    vi.stubGlobal("fetch", fetchMock);

    const client = new VibaClient({ apiKey: "bad", baseUrl: "https://api.example.com" });

    await expect(client.getMissionStatus(1)).rejects.toMatchObject({
      status: 401,
      body: { error: "invalid_api_key", message: "The API key is invalid or revoked." },
    });
    await expect(client.getMissionStatus(1)).rejects.toBeInstanceOf(VibaApiError);
  });

  it("uses the response's error field as the thrown message when present", async () => {
    const fetchMock = mockFetchOnce(403, { error: "insufficient_scope" });
    vi.stubGlobal("fetch", fetchMock);

    const client = new VibaClient({ apiKey: "k", baseUrl: "https://api.example.com" });
    await expect(client.approveMission(1)).rejects.toThrow("insufficient_scope");
  });

  it("falls back to a generic message when the error body has no error field", async () => {
    const fetchMock = mockFetchOnce(500, { something: "else" });
    vi.stubGlobal("fetch", fetchMock);

    const client = new VibaClient({ apiKey: "k", baseUrl: "https://api.example.com" });
    await expect(client.approveMission(1)).rejects.toThrow("Viba API returned 500");
  });

  it("handles a non-JSON response body without crashing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "<html>Bad Gateway</html>",
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new VibaClient({ apiKey: "k", baseUrl: "https://api.example.com" });
    await expect(client.getMissionStatus(1)).rejects.toMatchObject({ status: 502 });
  });
});
