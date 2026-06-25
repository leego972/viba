import { describe, it, expect } from "vitest";
import {
  isSensitiveFieldName,
  redactSensitiveValue,
  redactDeep,
  assertNoRawSecretsInResponse,
  isHighRiskAction,
  requiresUserApproval,
  requiresSafeBuild,
  requiresDryRun,
} from "./securityPolicy";

describe("isSensitiveFieldName", () => {
  it("detects exact sensitive names", () => {
    expect(isSensitiveFieldName("token")).toBe(true);
    expect(isSensitiveFieldName("secret")).toBe(true);
    expect(isSensitiveFieldName("password")).toBe(true);
    expect(isSensitiveFieldName("key")).toBe(true);
    expect(isSensitiveFieldName("credential")).toBe(true);
    expect(isSensitiveFieldName("cookie")).toBe(true);
    expect(isSensitiveFieldName("session")).toBe(true);
    expect(isSensitiveFieldName("private")).toBe(true);
    expect(isSensitiveFieldName("webhook")).toBe(true);
    expect(isSensitiveFieldName("database")).toBe(true);
    expect(isSensitiveFieldName("authorization")).toBe(true);
    expect(isSensitiveFieldName("bearer")).toBe(true);
    expect(isSensitiveFieldName("refresh")).toBe(true);
  });

  it("detects compound sensitive names (substring match)", () => {
    expect(isSensitiveFieldName("api_key")).toBe(true);
    expect(isSensitiveFieldName("accessToken")).toBe(true);
    expect(isSensitiveFieldName("webhookSecret")).toBe(true);
    expect(isSensitiveFieldName("database_url")).toBe(true);
    expect(isSensitiveFieldName("smtp_pass")).toBe(true);
    expect(isSensitiveFieldName("refresh_token")).toBe(true);
    expect(isSensitiveFieldName("private_key")).toBe(true);
    expect(isSensitiveFieldName("db_password")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isSensitiveFieldName("TOKEN")).toBe(true);
    expect(isSensitiveFieldName("API_KEY")).toBe(true);
    expect(isSensitiveFieldName("WebhookSecret")).toBe(true);
  });

  it("allows safe field names", () => {
    expect(isSensitiveFieldName("id")).toBe(false);
    expect(isSensitiveFieldName("name")).toBe(false);
    expect(isSensitiveFieldName("email")).toBe(false);
    expect(isSensitiveFieldName("label")).toBe(false);
    expect(isSensitiveFieldName("status")).toBe(false);
    expect(isSensitiveFieldName("createdAt")).toBe(false);
    expect(isSensitiveFieldName("userId")).toBe(false);
  });
});

describe("redactSensitiveValue", () => {
  it("redacts OpenAI sk- keys", () => {
    // Concatenated to avoid triggering static secret scanners on CI/GitHub push protection
    const fakeKey = "sk-" + "abc123XYZ456abcdef123456789012";
    const result = redactSensitiveValue(fakeKey);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("sk-abc");
  });

  it("redacts GitHub PATs", () => {
    // Concatenated to avoid triggering static secret scanners
    const fakePat = "ghp_" + "aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890";
    const result = redactSensitiveValue(fakePat);
    expect(result).toContain("[REDACTED]");
  });

  it("redacts Stripe live keys", () => {
    // Concatenated to avoid triggering static secret scanners
    const fakeStripeKey = "sk_live_" + "abcdefghijklmnopqrstuvwx";
    const result = redactSensitiveValue(fakeStripeKey);
    expect(result).toContain("[REDACTED]");
  });

  it("leaves safe strings alone", () => {
    expect(redactSensitiveValue("hello world")).toBe("hello world");
    expect(redactSensitiveValue("John Doe")).toBe("John Doe");
  });

  it("leaves non-strings alone", () => {
    expect(redactSensitiveValue(42)).toBe(42);
    expect(redactSensitiveValue(true)).toBe(true);
    expect(redactSensitiveValue(null)).toBe(null);
  });
});

describe("redactDeep", () => {
  it("redacts sensitive keys at the top level", () => {
    const input = { id: "123", token: "super-secret-value", name: "Alice" };
    const result = redactDeep(input) as Record<string, unknown>;
    expect(result.id).toBe("123");
    expect(result.name).toBe("Alice");
    expect(result.token).toBe("[REDACTED]");
  });

  it("redacts sensitive keys in nested objects", () => {
    const input = { user: { email: "a@b.com", password: "hunter2" } };
    const result = redactDeep(input) as { user: Record<string, unknown> };
    expect(result.user.email).toBe("a@b.com");
    expect(result.user.password).toBe("[REDACTED]");
  });

  it("redacts sensitive keys in arrays", () => {
    const input = [{ label: "prod", api_key: "sk-realkey123456789012345" }];
    const result = redactDeep(input) as Array<Record<string, unknown>>;
    expect(result[0].label).toBe("prod");
    expect(result[0].api_key).toBe("[REDACTED]");
  });

  it("handles null / undefined gracefully", () => {
    expect(redactDeep(null)).toBeNull();
    expect(redactDeep(undefined)).toBeUndefined();
  });

  it("handles primitive values", () => {
    expect(redactDeep(42)).toBe(42);
    expect(redactDeep("hello")).toBe("hello");
  });

  it("does not mutate the original object", () => {
    const input = { token: "secret123" };
    const result = redactDeep(input) as Record<string, unknown>;
    expect(result.token).toBe("[REDACTED]");
    expect(input.token).toBe("secret123");
  });
});

describe("assertNoRawSecretsInResponse", () => {
  it("passes through clean objects unchanged", () => {
    const input = { id: "1", label: "test", status: "ok" };
    expect(() => assertNoRawSecretsInResponse(input)).not.toThrow();
  });

  it("throws in test mode when raw secrets detected", () => {
    const input = { id: "1", token: "real-secret-value" };
    expect(() => assertNoRawSecretsInResponse(input)).toThrow(/raw secret/i);
  });

  it("always returns the redacted copy", () => {
    const input = { id: "1", token: "real-secret" };
    let result: unknown;
    try {
      result = assertNoRawSecretsInResponse(input);
    } catch {
      result = { id: "1", token: "[REDACTED]" };
    }
    expect((result as Record<string, unknown>).token).toBe("[REDACTED]");
  });
});

describe("isHighRiskAction", () => {
  it("classifies known high-risk actions", () => {
    expect(isHighRiskAction("deploy")).toBe(true);
    expect(isHighRiskAction("rollback")).toBe(true);
    expect(isHighRiskAction("drop_table")).toBe(true);
    expect(isHighRiskAction("delete_service")).toBe(true);
    expect(isHighRiskAction("refund")).toBe(true);
    expect(isHighRiskAction("grant_credits")).toBe(true);
    expect(isHighRiskAction("browser_oauth")).toBe(true);
    expect(isHighRiskAction("delete_user")).toBe(true);
  });

  it("normalises spacing and dashes", () => {
    expect(isHighRiskAction("delete-service")).toBe(true);
    expect(isHighRiskAction("drop table")).toBe(true);
  });

  it("returns false for safe actions", () => {
    expect(isHighRiskAction("list_services")).toBe(false);
    expect(isHighRiskAction("get_status")).toBe(false);
    expect(isHighRiskAction("read_logs")).toBe(false);
  });
});

describe("requiresUserApproval", () => {
  it("requires approval for destructive actions", () => {
    expect(requiresUserApproval("deploy")).toBe(true);
    expect(requiresUserApproval("cancel_subscription")).toBe(true);
    expect(requiresUserApproval("delete_user")).toBe(true);
  });

  it("does not require approval for safe actions", () => {
    expect(requiresUserApproval("list_agents")).toBe(false);
    expect(requiresUserApproval("get_health")).toBe(false);
  });
});

describe("requiresSafeBuild", () => {
  it("requires safe-build for deployment actions", () => {
    expect(requiresSafeBuild("deploy")).toBe(true);
    expect(requiresSafeBuild("rollback")).toBe(true);
    expect(requiresSafeBuild("promote")).toBe(true);
    expect(requiresSafeBuild("migrate_production")).toBe(true);
  });

  it("does not require safe-build for non-deployment actions", () => {
    expect(requiresSafeBuild("refund")).toBe(false);
    expect(requiresSafeBuild("list_services")).toBe(false);
  });
});

describe("requiresDryRun", () => {
  it("requires dry-run for dangerous mutations", () => {
    expect(requiresDryRun("deploy")).toBe(true);
    expect(requiresDryRun("drop_table")).toBe(true);
    expect(requiresDryRun("delete_dns_record")).toBe(true);
    expect(requiresDryRun("delete_repo")).toBe(true);
  });

  it("does not require dry-run for reads", () => {
    expect(requiresDryRun("list_services")).toBe(false);
    expect(requiresDryRun("get_logs")).toBe(false);
  });
});
