import { describe, it, expect } from "vitest";
import { isPermanentError } from "./adapters/errors";

describe("isPermanentError", () => {
  it("returns false for null", () => {
    expect(isPermanentError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isPermanentError(undefined)).toBe(false);
  });

  it("returns false for a plain string", () => {
    expect(isPermanentError("some error")).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isPermanentError(500)).toBe(false);
  });

  it("returns true for status 401", () => {
    expect(isPermanentError({ status: 401 })).toBe(true);
  });

  it("returns true for status 403", () => {
    expect(isPermanentError({ status: 403 })).toBe(true);
  });

  it("returns false for status 429 (transient rate limit)", () => {
    expect(isPermanentError({ status: 429 })).toBe(false);
  });

  it("returns false for status 500 (transient server error)", () => {
    expect(isPermanentError({ status: 500 })).toBe(false);
  });

  it("returns false for status 503", () => {
    expect(isPermanentError({ status: 503 })).toBe(false);
  });

  it("returns true for statusCode 401", () => {
    expect(isPermanentError({ statusCode: 401 })).toBe(true);
  });

  it("returns true for statusCode 403", () => {
    expect(isPermanentError({ statusCode: 403 })).toBe(true);
  });

  it("returns false for statusCode 429", () => {
    expect(isPermanentError({ statusCode: 429 })).toBe(false);
  });

  it("returns true for code 'invalid_api_key'", () => {
    expect(isPermanentError({ code: "invalid_api_key" })).toBe(true);
  });

  it("returns true for code 'authentication_error'", () => {
    expect(isPermanentError({ code: "authentication_error" })).toBe(true);
  });

  it("returns true for code 'permission_denied'", () => {
    expect(isPermanentError({ code: "permission_denied" })).toBe(true);
  });

  it("returns true for code 'api_key_invalid'", () => {
    expect(isPermanentError({ code: "api_key_invalid" })).toBe(true);
  });

  it("returns true for code 'unauthorized'", () => {
    expect(isPermanentError({ code: "unauthorized" })).toBe(true);
  });

  it("returns false for code 'rate_limit' (transient)", () => {
    expect(isPermanentError({ code: "rate_limit" })).toBe(false);
  });

  it("returns false for code 'server_error' (transient)", () => {
    expect(isPermanentError({ code: "server_error" })).toBe(false);
  });

  it("is case-insensitive for code matching", () => {
    expect(isPermanentError({ code: "INVALID_API_KEY" })).toBe(true);
    expect(isPermanentError({ code: "Authentication_Error" })).toBe(true);
  });

  it("returns true for object with message containing 'invalid api key'", () => {
    expect(isPermanentError({ message: "Invalid API key provided" })).toBe(true);
  });

  it("returns true for object with message containing 'incorrect api key'", () => {
    expect(isPermanentError({ message: "Incorrect api key" })).toBe(true);
  });

  it("returns true for object with message containing 'api key not found'", () => {
    expect(isPermanentError({ message: "API key not found" })).toBe(true);
  });

  it("returns true for object with message containing 'no api key provided'", () => {
    expect(isPermanentError({ message: "No API key provided" })).toBe(true);
  });

  it("returns true for Error with 'incorrect api key' message", () => {
    expect(isPermanentError(new Error("Incorrect api key provided"))).toBe(true);
  });

  it("returns true for Error with 'invalid api key' message", () => {
    expect(isPermanentError(new Error("Invalid API key"))).toBe(true);
  });

  it("returns false for generic Error (network timeout)", () => {
    expect(isPermanentError(new Error("timeout"))).toBe(false);
  });

  it("returns false for generic Error (connection refused)", () => {
    expect(isPermanentError(new Error("connection refused"))).toBe(false);
  });

  it("returns false for error object with status 200", () => {
    expect(isPermanentError({ status: 200 })).toBe(false);
  });

  it("returns false for error object with status 0", () => {
    expect(isPermanentError({ status: 0 })).toBe(false);
  });

  it("returns true for combined status + code (status wins)", () => {
    expect(isPermanentError({ status: 401, code: "rate_limit" })).toBe(true);
  });

  it("returns true for a real-world OpenAI auth error shape", () => {
    expect(
      isPermanentError({
        status: 401,
        message: "Incorrect API key provided",
        code: "invalid_api_key",
      })
    ).toBe(true);
  });

  it("returns false for a real-world OpenAI rate-limit error shape", () => {
    expect(
      isPermanentError({
        status: 429,
        message: "Rate limit exceeded",
        code: "rate_limit_exceeded",
      })
    ).toBe(false);
  });
});
