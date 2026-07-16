import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("@workspace/db", () => {
  function makeFromResult(rows: unknown[] = []) {
    const obj: Record<string, unknown> = {
      where: vi.fn().mockResolvedValue(rows),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return obj;
  }
  return {
    db: { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([])) }) },
    settingsTable: {},
  };
});

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  delete process.env["GITHUB_TOKEN"];
});

describe("validateGithub — actually confirms repo read/write, not just auth", () => {
  beforeEach(() => vi.resetModules());

  it("passes a classic token that has the repo scope", async () => {
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      headers: { get: (k: string) => (k.toLowerCase() === "x-oauth-scopes" ? "repo, read:user" : null) },
      json: async () => ({ login: "octocat", id: 1 }),
    }));
    const { validateGithub } = await import("./credentials");
    const result = await validateGithub("ghp_faketoken1234567890");
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/read\/write access/i);
  });

  it("fails a classic token missing the repo scope, with a clear actionable message", async () => {
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      headers: { get: (k: string) => (k.toLowerCase() === "x-oauth-scopes" ? "read:user" : null) },
      json: async () => ({ login: "octocat", id: 1 }),
    }));
    const { validateGithub } = await import("./credentials");
    const result = await validateGithub("ghp_faketoken1234567890");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/missing the "repo" scope/i);
  });

  it("passes a fine-grained token that has push access to at least one repo", async () => {
    global.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        headers: { get: () => null },
        json: async () => ({ login: "octocat", id: 1 }),
      }))
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: async () => [{ full_name: "octocat/repo1", permissions: { push: true, pull: true } }],
      }));
    const { validateGithub } = await import("./credentials");
    const result = await validateGithub("github_pat_faketoken1234567890");
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/read\/write access to 1 repo/i);
  });

  it("fails a fine-grained token with zero accessible repos, explaining fine-grained scoping", async () => {
    global.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        headers: { get: () => null },
        json: async () => ({ login: "octocat", id: 1 }),
      }))
      .mockImplementationOnce(() => Promise.resolve({ ok: true, json: async () => [] }));
    const { validateGithub } = await import("./credentials");
    const result = await validateGithub("github_pat_faketoken1234567890");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no repository access configured/i);
  });

  it("fails a fine-grained token that can read repos but has write access to none", async () => {
    global.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        headers: { get: () => null },
        json: async () => ({ login: "octocat", id: 1 }),
      }))
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: async () => [{ full_name: "octocat/repo1", permissions: { push: false, pull: true } }],
      }));
    const { validateGithub } = await import("./credentials");
    const result = await validateGithub("github_pat_faketoken1234567890");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no write access/i);
  });
});

describe("POST /github/repos — repo creation", () => {
  async function makeApp() {
    const { default: githubRouter } = await import("./github");
    const app = express();
    app.use(express.json());
    app.use(githubRouter);
    return app;
  }

  it("creates a repo successfully", async () => {
    process.env["GITHUB_TOKEN"] = "ghp_faketoken1234567890";
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      json: async () => ({ full_name: "octocat/new-repo", html_url: "https://github.com/octocat/new-repo", default_branch: "main", private: true }),
    }));
    const app = await makeApp();
    const res = await request(app).post("/github/repos").send({ name: "new-repo" });
    expect(res.status).toBe(201);
    expect(res.body.fullName).toBe("octocat/new-repo");
  });

  it("rejects an invalid repo name before calling GitHub", async () => {
    process.env["GITHUB_TOKEN"] = "ghp_faketoken1234567890";
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const app = await makeApp();
    const res = await request(app).post("/github/repos").send({ name: "not a valid name!" });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a clear fine-grained-scoping hint when GitHub rejects creation with 403", async () => {
    process.env["GITHUB_TOKEN"] = "github_pat_faketoken1234567890";
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      ok: false,
      status: 403,
      text: async () => "Resource not accessible by personal access token",
    }));
    const app = await makeApp();
    const res = await request(app).post("/github/repos").send({ name: "new-repo" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/All repositories/i);
    expect(res.body.error).toMatch(/Administration: Read and write/i);
  });
});
