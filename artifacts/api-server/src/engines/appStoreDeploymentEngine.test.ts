import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  generateAscJwt,
  validateP8Key,
  generateEasBuildPlan,
} from "./appStoreDeploymentEngine";

// Generate a real P-256 key for testing (same curve Apple uses for ASC keys)
function makeTestP8(): string {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

describe("validateP8Key", () => {
  it("accepts a valid EC P-256 PKCS8 key", () => {
    const result = validateP8Key(makeTestP8());
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it("rejects text without PEM markers", () => {
    const result = validateP8Key("not a key at all");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("PEM");
  });

  it("rejects a non-EC key", () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const result = validateP8Key(pem);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("EC");
  });

  it("rejects malformed PEM content", () => {
    const result = validateP8Key("-----BEGIN PRIVATE KEY-----\ngarbage\n-----END PRIVATE KEY-----");
    expect(result.valid).toBe(false);
  });
});

describe("generateAscJwt", () => {
  const creds = {
    keyId: "2WG5YUFL55",
    issuerId: "d7c6c514-df7f-4adb-a4a0-b0553ea751a4",
    p8Key: makeTestP8(),
  };

  it("produces a three-part JWT", () => {
    const jwt = generateAscJwt(creds);
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("encodes the correct ES256 header with kid", () => {
    const jwt = generateAscJwt(creds);
    const header = JSON.parse(Buffer.from(jwt.split(".")[0]!, "base64url").toString());
    expect(header).toMatchObject({ alg: "ES256", kid: "2WG5YUFL55", typ: "JWT" });
  });

  it("encodes issuer, audience, and a short expiry", () => {
    const jwt = generateAscJwt(creds);
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    expect(payload.iss).toBe(creds.issuerId);
    expect(payload.aud).toBe("appstoreconnect-v1");
    // Apple max is 20 minutes — ours must be within that window
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(20 * 60);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("produces a signature verifiable with the matching public key", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwt = generateAscJwt({ ...creds, p8Key: pem });
    const [h, p, s] = jwt.split(".");
    const verified = crypto.verify(
      "sha256",
      Buffer.from(`${h}.${p}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(s!, "base64url"),
    );
    expect(verified).toBe(true);
  });
});

describe("generateEasBuildPlan", () => {
  const input = {
    repoUrl: "https://github.com/leego972/virellestudios",
    appDir: "apps/swappys-mobile",
    keyId: "2WG5YUFL55",
    issuerId: "d7c6c514-df7f-4adb-a4a0-b0553ea751a4",
    ascAppId: "6787028397",
    autoSubmit: true,
  };

  it("generates a non-interactive build command", () => {
    const plan = generateEasBuildPlan(input);
    expect(plan.command).toContain("--non-interactive");
    expect(plan.command).toContain("--platform ios");
    expect(plan.command).toContain("apps/swappys-mobile");
  });

  it("includes --auto-submit only when requested", () => {
    expect(generateEasBuildPlan(input).command).toContain("--auto-submit");
    expect(generateEasBuildPlan({ ...input, autoSubmit: false }).command).not.toContain("--auto-submit");
  });

  it("lists the required env vars without exposing secret values", () => {
    const plan = generateEasBuildPlan(input);
    const joined = plan.envVars.join("\n");
    expect(joined).toContain("EXPO_TOKEN");
    expect(joined).toContain("EXPO_APPLE_API_KEY_ID=2WG5YUFL55");
    expect(joined).toContain("EXPO_APPLE_API_ISSUER_ID=d7c6c514-df7f-4adb-a4a0-b0553ea751a4");
  });

  it("generates a GitHub Actions workflow referencing secrets, not values", () => {
    const plan = generateEasBuildPlan(input);
    expect(plan.githubWorkflowYaml).toContain("secrets.EXPO_TOKEN");
    expect(plan.githubWorkflowYaml).toContain("secrets.APPLE_P8_KEY");
    expect(plan.githubWorkflowYaml).toContain("workflow_dispatch");
  });
});
