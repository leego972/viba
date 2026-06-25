import { describe, it, expect } from "vitest";
import { validateUrl, assertUrlSafe } from "./urlSafety";

describe("validateUrl — blocked cases", () => {
  it("blocks localhost", () => {
    const r = validateUrl("http://localhost/api");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("URL_BLOCKED_PRIVATE_NETWORK");
  });

  it("blocks 127.0.0.1", () => {
    const r = validateUrl("http://127.0.0.1:3000");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("URL_BLOCKED_PRIVATE_NETWORK");
  });

  it("blocks 127.x.x.x range", () => {
    expect(validateUrl("http://127.99.1.2/path").allowed).toBe(false);
  });

  it("blocks 0.0.0.0", () => {
    expect(validateUrl("http://0.0.0.0").allowed).toBe(false);
  });

  it("blocks RFC 1918 — 10.x.x.x", () => {
    expect(validateUrl("http://10.0.0.1/internal").allowed).toBe(false);
  });

  it("blocks RFC 1918 — 192.168.x.x", () => {
    expect(validateUrl("http://192.168.1.1").allowed).toBe(false);
  });

  it("blocks RFC 1918 — 172.16.x.x", () => {
    expect(validateUrl("http://172.16.0.1").allowed).toBe(false);
  });

  it("blocks RFC 1918 — 172.31.x.x", () => {
    expect(validateUrl("http://172.31.255.254").allowed).toBe(false);
  });

  it("allows 172.32.x.x (not RFC 1918)", () => {
    const r = validateUrl("https://172.32.0.1");
    expect(r.allowed).toBe(true);
  });

  it("blocks link-local 169.254.x.x", () => {
    expect(validateUrl("http://169.254.1.1").allowed).toBe(false);
  });

  it("blocks AWS metadata endpoint", () => {
    expect(validateUrl("http://169.254.169.254/latest/meta-data/").allowed).toBe(false);
  });

  it("blocks GCP metadata endpoint", () => {
    expect(validateUrl("http://metadata.google.internal").allowed).toBe(false);
  });

  it("blocks bare internal hostname (no dots)", () => {
    expect(validateUrl("http://db/query").allowed).toBe(false);
    expect(validateUrl("http://redis").allowed).toBe(false);
  });

  it("blocks file:// URLs", () => {
    const r = validateUrl("file:///etc/passwd");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/URL_BLOCKED_PROTOCOL/);
  });

  it("blocks ftp:// URLs", () => {
    const r = validateUrl("ftp://example.com/file");
    expect(r.allowed).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateUrl("").allowed).toBe(false);
    expect(validateUrl("").reason).toBe("URL_EMPTY");
  });

  it("rejects invalid URL", () => {
    expect(validateUrl("not-a-url").allowed).toBe(false);
    expect(validateUrl("not-a-url").reason).toBe("URL_INVALID");
  });
});

describe("validateUrl — allowed cases", () => {
  it("allows public https URL", () => {
    const r = validateUrl("https://github.com/leego972/bridge-ai");
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("allows public http URL when http is allowed", () => {
    const r = validateUrl("http://example.com/api");
    expect(r.allowed).toBe(true);
  });

  it("blocks http when allowHttp=false", () => {
    const r = validateUrl("http://example.com/api", { allowHttp: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("URL_BLOCKED_HTTP_NOT_ALLOWED");
  });

  it("allows a real Railway production URL", () => {
    const r = validateUrl("https://viba.guru/api/health");
    expect(r.allowed).toBe(true);
  });

  it("allows a public CDN URL", () => {
    const r = validateUrl("https://cdn.jsdelivr.net/npm/react");
    expect(r.allowed).toBe(true);
  });

  it("returns the normalised URL in the result", () => {
    const r = validateUrl("HTTPS://Example.COM/path?q=1");
    expect(r.allowed).toBe(true);
    expect(r.url).toBeTruthy();
  });
});

describe("assertUrlSafe", () => {
  it("does not throw for a safe URL", () => {
    expect(() => assertUrlSafe("https://github.com")).not.toThrow();
  });

  it("throws for localhost", () => {
    expect(() => assertUrlSafe("http://localhost")).toThrow();
  });

  it("throws for private IP", () => {
    expect(() => assertUrlSafe("http://192.168.1.1")).toThrow();
  });

  it("thrown error has 422 status", () => {
    try {
      assertUrlSafe("http://127.0.0.1");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as { status: number }).status).toBe(422);
    }
  });
});
