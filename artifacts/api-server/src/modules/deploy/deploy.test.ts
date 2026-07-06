import { describe, it, expect, vi, beforeEach } from "vitest";
import { encryptSecret, decryptSecret, maskSecrets, maskValue, generateSecurePassword, generateVerificationToken } from "./secrets.service";
import { detectPackageManager, detectLockfile, detectFramework, detectProject } from "./framework.detector";
import { verifyWebhookSignature, extractBranchFromRef, parsePushWebhook } from "./github.adapter";
import { diagnoseFailure } from "./diagnosis.service";
import { generateCaddyfile, generateDnsVerificationInstructions } from "./caddy.adapter";
import { isDockerAvailable, containerName, imageTag } from "./docker.adapter";
import path from "path";
import fs from "fs";
import os from "os";

// ─── Secrets ──────────────────────────────────────────────────────────────────

describe("secrets.service", () => {
  it("encrypts and decrypts a secret round-trip", () => {
    const value = "super-secret-password-123!";
    const encrypted = encryptSecret(value);
    expect(encrypted).not.toBe(value);
    expect(decryptSecret(encrypted)).toBe(value);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
  });

  it("maskSecrets hides DATABASE_URL credentials", () => {
    const log = "Connecting to DATABASE_URL=postgresql://user:pass@host:5432/db";
    expect(maskSecrets(log)).toContain("DATABASE_URL=****");
    expect(maskSecrets(log)).not.toContain("pass@");
  });

  it("maskSecrets hides REDIS_URL credentials", () => {
    const log = "Connecting to REDIS_URL=redis://:mypassword@localhost:6379";
    expect(maskSecrets(log)).not.toContain("mypassword");
  });

  it("maskValue shows partial value for long secrets", () => {
    expect(maskValue("abcdefghij")).toBe("abcd****ghij");
  });

  it("maskValue returns **** for short secrets", () => {
    expect(maskValue("abc")).toBe("****");
  });

  it("generateSecurePassword is 24 chars by default", () => {
    const pw = generateSecurePassword();
    expect(pw.length).toBe(24);
  });

  it("generateSecurePassword produces unique values", () => {
    expect(generateSecurePassword()).not.toBe(generateSecurePassword());
  });

  it("generateVerificationToken returns 40-char hex string", () => {
    const token = generateVerificationToken();
    expect(token).toMatch(/^[0-9a-f]{40}$/);
  });
});

// ─── Framework Detection ──────────────────────────────────────────────────────

describe("framework.detector", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viba-test-"));
  });

  it("detects pnpm from pnpm-lock.yaml", () => {
    fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(tmpDir)).toBe("pnpm");
  });

  it("detects yarn from yarn.lock", () => {
    fs.writeFileSync(path.join(tmpDir, "yarn.lock"), "");
    expect(detectPackageManager(tmpDir)).toBe("yarn");
  });

  it("detects bun from bun.lockb", () => {
    fs.writeFileSync(path.join(tmpDir, "bun.lockb"), "");
    expect(detectPackageManager(tmpDir)).toBe("bun");
  });

  it("falls back to npm when no lockfile", () => {
    expect(detectPackageManager(tmpDir)).toBe("npm");
  });

  it("detectLockfile returns null when no lockfile exists", () => {
    expect(detectLockfile(tmpDir)).toBeNull();
  });

  it("detectLockfile finds pnpm-lock.yaml", () => {
    fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "");
    expect(detectLockfile(tmpDir)).toBe("pnpm-lock.yaml");
  });

  it("detectFramework identifies nextjs", () => {
    const pkg = { dependencies: { next: "14.0.0" } };
    expect(detectFramework(tmpDir, pkg)).toBe("nextjs");
  });

  it("detectFramework identifies vite", () => {
    const pkg = { devDependencies: { vite: "5.0.0" } };
    expect(detectFramework(tmpDir, pkg)).toBe("vite");
  });

  it("detectFramework identifies express", () => {
    const pkg = { dependencies: { express: "4.18.0" } };
    expect(detectFramework(tmpDir, pkg)).toBe("express");
  });

  it("detectProject returns full detection result", () => {
    fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "");
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { next: "14.0.0" } }),
    );
    const result = detectProject(tmpDir);
    expect(result.framework).toBe("nextjs");
    expect(result.packageManager).toBe("pnpm");
    expect(result.installCommand).toContain("pnpm");
    expect(result.hasDockerfile).toBe(false);
  });

  it("detectProject detects Dockerfile presence", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({}));
    fs.writeFileSync(path.join(tmpDir, "Dockerfile"), "FROM node:20\n");
    const result = detectProject(tmpDir);
    expect(result.hasDockerfile).toBe(true);
  });
});

// ─── GitHub Webhook ───────────────────────────────────────────────────────────

describe("github.adapter webhook", () => {
  const secret = "test-webhook-secret";

  function sign(body: string, s: string): string {
    const { createHmac } = require("crypto") as typeof import("crypto");
    return `sha256=${createHmac("sha256", s).update(body).digest("hex")}`;
  }

  it("verifyWebhookSignature returns true for valid signature", () => {
    const originalSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;
    process.env.GITHUB_APP_WEBHOOK_SECRET = secret;
    const body = Buffer.from('{"ref":"refs/heads/main"}');
    const sig = sign(body.toString(), secret);
    expect(verifyWebhookSignature(body, sig)).toBe(true);
    process.env.GITHUB_APP_WEBHOOK_SECRET = originalSecret;
  });

  it("verifyWebhookSignature returns false for invalid signature", () => {
    process.env.GITHUB_APP_WEBHOOK_SECRET = secret;
    const body = Buffer.from('{"ref":"refs/heads/main"}');
    expect(verifyWebhookSignature(body, "sha256=wrong")).toBe(false);
    delete process.env.GITHUB_APP_WEBHOOK_SECRET;
  });

  it("verifyWebhookSignature returns false when secret is not set", () => {
    const saved = process.env.GITHUB_APP_WEBHOOK_SECRET;
    delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    const body = Buffer.from("test");
    expect(verifyWebhookSignature(body, "sha256=anything")).toBe(false);
    process.env.GITHUB_APP_WEBHOOK_SECRET = saved;
  });

  it("extractBranchFromRef strips refs/heads/", () => {
    expect(extractBranchFromRef("refs/heads/main")).toBe("main");
    expect(extractBranchFromRef("refs/heads/feature/my-feature")).toBe("feature/my-feature");
  });

  it("extractBranchFromRef leaves already-bare branch unchanged", () => {
    expect(extractBranchFromRef("main")).toBe("main");
  });

  it("parsePushWebhook returns null for invalid payload", () => {
    expect(parsePushWebhook({})).toBeNull();
    expect(parsePushWebhook(null)).toBeNull();
  });

  it("parsePushWebhook returns payload for valid push event", () => {
    const payload = {
      ref: "refs/heads/main",
      after: "abc123",
      repository: { full_name: "owner/repo", default_branch: "main" },
      head_commit: { id: "abc123", message: "chore: update", author: { name: "Dev" } },
      installation: { id: 42 },
    };
    const result = parsePushWebhook(payload);
    expect(result).not.toBeNull();
    expect(result?.repository.full_name).toBe("owner/repo");
  });

  it("push webhook correctly filters branch - matching branch", () => {
    const pushedBranch = extractBranchFromRef("refs/heads/main");
    const deployBranch = "main";
    expect(pushedBranch).toBe(deployBranch);
  });

  it("push webhook correctly filters branch - non-matching branch", () => {
    const pushedBranch = extractBranchFromRef("refs/heads/dev");
    const deployBranch = "main";
    expect(pushedBranch).not.toBe(deployBranch);
  });
});

// ─── Failure Diagnosis ────────────────────────────────────────────────────────

describe("diagnosis.service", () => {
  it("returns null for clean logs", () => {
    expect(diagnoseFailure(["Build succeeded", "Server started"])).toBeNull();
  });

  it("detects database connection failure", () => {
    const d = diagnoseFailure(["Error: ECONNREFUSED 127.0.0.1:5432", "Could not connect"]);
    expect(d?.category).toBe("database_connection_failure");
    expect(d?.oneClickFix?.action).toBe("create_postgres_addon");
  });

  it("detects wrong port binding", () => {
    const d = diagnoseFailure(["Error: address already in use :::3000"]);
    expect(d?.category).toBe("wrong_port_binding");
    expect(d?.oneClickFix?.safe).toBe(true);
  });

  it("detects TypeScript build failure", () => {
    const d = diagnoseFailure(["error TS2339: Property 'x' does not exist"]);
    expect(d?.category).toBe("typescript_build_failure");
  });

  it("detects package install failure", () => {
    const d = diagnoseFailure(["npm ERR! ERESOLVE unable to resolve dependency tree"]);
    expect(d?.category).toBe("package_install_failure");
  });

  it("detects OOM failure", () => {
    const d = diagnoseFailure(["Out of memory: Killed process 1234"]);
    expect(d?.category).toBe("out_of_memory");
    expect(d?.severity).toBe("critical");
  });

  it("includes log excerpt in result", () => {
    const d = diagnoseFailure(["password authentication failed for user"]);
    expect(d?.logExcerpt).toBeTruthy();
  });
});

// ─── Caddy ────────────────────────────────────────────────────────────────────

describe("caddy.adapter", () => {
  it("generateCaddyfile produces valid block for a route", () => {
    const caddyfile = generateCaddyfile([
      { projectSlug: "my-app", domain: "my-app", upstreamPort: 3001 },
    ]);
    expect(caddyfile).toContain("my-app");
    expect(caddyfile).toContain("reverse_proxy localhost:3001");
  });

  it("generateCaddyfile includes custom domain when provided", () => {
    const caddyfile = generateCaddyfile([
      { projectSlug: "my-app", domain: "my-app", upstreamPort: 3001, customDomain: "myapp.com" },
    ]);
    expect(caddyfile).toContain("myapp.com");
  });

  it("generateDnsVerificationInstructions includes TXT record details", () => {
    const instructions = generateDnsVerificationInstructions("myapp.com", "abc123");
    expect(instructions).toContain("_viba-deploy.myapp.com");
    expect(instructions).toContain("viba-verify-abc123");
    expect(instructions).toContain("TXT");
  });
});

// ─── Docker Adapter (no runtime) ─────────────────────────────────────────────

describe("docker.adapter (naming utilities)", () => {
  it("containerName formats correctly for web", () => {
    expect(containerName("proj-123", "web")).toBe("viba-project-proj-123-web");
  });

  it("containerName formats correctly for postgres", () => {
    expect(containerName("proj-123", "postgres")).toBe("viba-project-proj-123-postgres");
  });

  it("containerName formats correctly for redis", () => {
    expect(containerName("proj-123", "redis")).toBe("viba-project-proj-123-redis");
  });

  it("imageTag formats correctly", () => {
    expect(imageTag("proj-123", "dep-456")).toBe("viba-project-proj-123:dep-456");
  });

  it("isDockerAvailable returns a boolean", () => {
    expect(typeof isDockerAvailable()).toBe("boolean");
  });
});
