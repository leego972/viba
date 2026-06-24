import express from "express";
import supertest from "supertest";
import { describe, expect, it } from "vitest";
import fileBuildSafetyRouter from "./fileBuildSafety";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(fileBuildSafetyRouter);
  return app;
}

describe("file and build safety routes", () => {
  it("returns safety policy", async () => {
    const res = await supertest(makeApp()).get("/file-build-safety/policy");
    expect(res.status).toBe(200);
    expect(res.body.valuesReturned).toBe(false);
    expect(res.body.rules).toContain("Never execute uploaded files directly.");
  });

  it("blocks executable-style uploads", async () => {
    const res = await supertest(makeApp())
      .post("/file-build-safety/file-check")
      .send({ fileName: "setup.exe", sizeBytes: 1200, source: "upload" });
    expect(res.status).toBe(400);
    expect(res.body.result.level).toBe("block");
    expect(res.body.result.executionAllowed).toBe(false);
    expect(res.body.result.publicAccessAllowed).toBe(false);
  });

  it("requires review for archives", async () => {
    const res = await supertest(makeApp())
      .post("/file-build-safety/file-check")
      .send({ fileName: "project.zip", sizeBytes: 4096, source: "upload" });
    expect(res.status).toBe(200);
    expect(res.body.result.level).toBe("review");
    expect(res.body.result.requiredActions).toContain("sandbox_extract_or_static_scan");
  });

  it("quarantines browser downloads by default", async () => {
    const res = await supertest(makeApp())
      .post("/file-build-safety/file-check")
      .send({ fileName: "report.pdf", sizeBytes: 10000, source: "browser_download" });
    expect(res.status).toBe(200);
    expect(res.body.result.requiredActions).toContain("quarantine_before_use");
    expect(res.body.result.executionAllowed).toBe(false);
  });

  it("generates stricter requirements for upload/build/browser apps", async () => {
    const res = await supertest(makeApp())
      .post("/file-build-safety/build-plan")
      .send({ acceptsUploads: true, buildsUserCode: true, usesBrowserOperator: true, storesPublicFiles: true, deploysToProduction: true });
    expect(res.status).toBe(200);
    expect(res.body.requirements).toContain("upload_quarantine_required");
    expect(res.body.requirements).toContain("sandboxed_build_required");
    expect(res.body.requirements).toContain("browser_download_quarantine_required");
    expect(res.body.requirements).toContain("merge_only_after_safe_build_passes");
  });

  it("blocks deploy decision when required checks are missing", async () => {
    const res = await supertest(makeApp())
      .post("/file-build-safety/deploy-decision")
      .send({ checks: { install: true, typecheck: true } });
    expect(res.status).toBe(400);
    expect(res.body.decision).toBe("blocked");
    expect(res.body.railwayDeployAllowed).toBe(false);
  });

  it("allows deploy decision only after required checks pass", async () => {
    const res = await supertest(makeApp())
      .post("/file-build-safety/deploy-decision")
      .send({ checks: { install: true, typecheck: true, apiTests: true, apiBuild: true, frontendBuild: true } });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("allowed");
    expect(res.body.mergeAllowed).toBe(true);
  });
});
