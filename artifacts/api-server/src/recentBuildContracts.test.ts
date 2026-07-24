import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const API_ROOT = path.resolve(process.cwd(), "src");
const REPO_ROOT = path.resolve(process.cwd(), "../..");

function read(...parts: string[]): string {
  return fs.readFileSync(path.join(...parts), "utf8");
}

describe("recent build integration contracts", () => {
  it("uses the canonical provider toggle in Settings, Connections and the live runtime", () => {
    const settings = read(API_ROOT, "routes", "settings.ts");
    const providers = read(API_ROOT, "routes", "providers.ts");
    const factory = read(API_ROOT, "lib", "agentFactory.ts");

    expect(settings).toContain("PROVIDER_ENABLED__${provider.toLowerCase()}");
    expect(providers).toContain("PROVIDER_ENABLED__${id}");
    expect(factory).toContain("PROVIDER_ENABLED__${normalized}");
    expect(factory).toContain("canonicalValue ?? legacyValue");
  });

  it("passes publisher website and native identity through API, workflow, Capacitor and Android", () => {
    const route = read(API_ROOT, "routes", "appPublisher.ts");
    const workflow = read(REPO_ROOT, ".github", "workflows", "mobile-store-build.yml");
    const capacitor = read(REPO_ROOT, "artifacts", "bridge-ai", "capacitor.config.ts");
    const gradle = read(REPO_ROOT, "artifacts", "bridge-ai", "android", "app", "build.gradle");

    for (const input of ["website_url", "app_name", "bundle_id"]) {
      expect(route).toContain(input);
      expect(workflow).toContain(input);
    }
    expect(capacitor).toContain("VIBA_MOBILE_URL");
    expect(capacitor).toContain("VIBA_MOBILE_APP_NAME");
    expect(capacitor).toContain("VIBA_MOBILE_BUNDLE_ID");
    expect(gradle).toContain("applicationId mobileBundleId");
    expect(gradle).toContain('resValue "string", "app_name", mobileAppName');
  });

  it("does not create disposable Android signing keys", () => {
    const workflow = read(REPO_ROOT, ".github", "workflows", "mobile-store-build.yml");
    expect(workflow).toContain("Restore stable Android upload key");
    expect(workflow).not.toContain("keytool -genkeypair");
    expect(workflow).not.toContain("signing-backup-keep-private");
  });
});
