import { describe, expect, it } from "vitest";
import { buildWorkflowInputs, validatePublisherInput, type PublisherInput } from "./appPublisher";

const validRequest: PublisherInput = {
  platforms: ["android", "apple"],
  websiteUrl: "https://studio.example.com/app",
  appName: "Studio App",
  bundleId: "com.example.studio",
  version: "2.4.1",
  buildNumber: 42,
};

describe("app publisher validation", () => {
  it("accepts and normalises a complete public app request", () => {
    const result = validatePublisherInput({ ...validRequest, bundleId: "COM.EXAMPLE.STUDIO" });
    expect(result.issues).toEqual([]);
    expect(result.input).toEqual({ ...validRequest, bundleId: "com.example.studio" });
  });

  it("rejects private or insecure websites", () => {
    for (const websiteUrl of [
      "http://example.com",
      "https://localhost:3000",
      "https://127.0.0.1",
      "https://10.0.0.8",
      "https://192.168.1.20",
    ]) {
      const result = validatePublisherInput({ ...validRequest, websiteUrl });
      expect(result.issues.some((issue) => issue.field === "websiteUrl" && issue.severity === "error")).toBe(true);
    }
  });

  it("rejects unsupported stores and invalid native metadata", () => {
    const result = validatePublisherInput({
      platforms: ["windows"],
      websiteUrl: "https://example.com",
      appName: "X",
      bundleId: "Invalid Bundle",
      version: "1.0",
      buildNumber: 0,
    });
    const errorFields = new Set(result.issues.filter((issue) => issue.severity === "error").map((issue) => issue.field));
    expect(errorFields).toEqual(new Set(["appName", "bundleId", "platforms", "version", "buildNumber"]));
  });

  it("dispatches the exact website and native identity selected by the user", () => {
    expect(buildWorkflowInputs(validRequest)).toEqual({
      stores: "both",
      version: "2.4.1",
      build_number: "42",
      website_url: "https://studio.example.com/app",
      app_name: "Studio App",
      bundle_id: "com.example.studio",
    });
  });
});
