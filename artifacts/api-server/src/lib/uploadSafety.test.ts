import { describe, it, expect } from "vitest";
import {
  validateUploadFile,
  validateZipEntry,
  checkZipBomb,
  validateZipStats,
  MAX_UPLOAD_BYTES,
  MAX_EXTRACTED_BYTES,
  MAX_EXTRACTED_FILES,
  ZIP_BOMB_RATIO,
} from "./uploadSafety";

describe("validateUploadFile", () => {
  it("accepts a valid zip", () => {
    const r = validateUploadFile("project.zip", "application/zip", 1024 * 1024);
    expect(r.safe).toBe(true);
  });

  it("accepts a valid TypeScript file", () => {
    const r = validateUploadFile("index.ts", "text/plain", 4000);
    expect(r.safe).toBe(true);
  });

  it("rejects oversized files", () => {
    const r = validateUploadFile("huge.zip", "application/zip", MAX_UPLOAD_BYTES + 1);
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/FILE_TOO_LARGE/);
  });

  it("rejects disallowed extensions", () => {
    const r = validateUploadFile("malware.exe", "application/octet-stream", 1000);
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/FILE_EXTENSION_NOT_ALLOWED/);
  });

  it("rejects shell scripts", () => {
    const r = validateUploadFile("run.sh", "text/x-shellscript", 200);
    expect(r.safe).toBe(false);
  });

  it("rejects PHP files", () => {
    const r = validateUploadFile("backdoor.php", "text/x-php", 100);
    expect(r.safe).toBe(false);
  });
});

describe("validateZipEntry", () => {
  it("accepts a normal relative path", () => {
    expect(validateZipEntry("src/index.ts").safe).toBe(true);
  });

  it("accepts nested path within depth limit", () => {
    expect(validateZipEntry("a/b/c/d/e/f.ts").safe).toBe(true);
  });

  it("blocks path traversal with ../", () => {
    const r = validateZipEntry("../../../etc/passwd");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/TRAVERSAL/);
  });

  it("blocks path traversal embedded in path", () => {
    const r = validateZipEntry("src/../../../etc/shadow");
    expect(r.safe).toBe(false);
  });

  it("blocks absolute Unix paths", () => {
    const r = validateZipEntry("/etc/passwd");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/ABSOLUTE/);
  });

  it("blocks absolute Windows paths", () => {
    const r = validateZipEntry("C:\\Windows\\system32\\cmd.exe");
    expect(r.safe).toBe(false);
  });

  it("blocks paths with null bytes", () => {
    const r = validateZipEntry("safe\0.ts");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/NULL_BYTE/);
  });

  it("blocks Windows device files", () => {
    expect(validateZipEntry("CON").safe).toBe(false);
    expect(validateZipEntry("NUL.txt").safe).toBe(false);
    expect(validateZipEntry("COM1").safe).toBe(false);
    expect(validateZipEntry("LPT9.ts").safe).toBe(false);
  });

  it("blocks excessively deep paths", () => {
    const deep = Array.from({ length: 25 }, (_, i) => `dir${i}`).join("/") + "/file.ts";
    const r = validateZipEntry(deep);
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/TOO_DEEP/);
  });

  it("rejects empty path", () => {
    expect(validateZipEntry("").safe).toBe(false);
  });
});

describe("checkZipBomb", () => {
  it("accepts a normal archive", () => {
    const r = checkZipBomb(1_000_000, 5_000_000); // 5:1 ratio — fine
    expect(r.safe).toBe(true);
  });

  it("rejects when uncompressed exceeds max", () => {
    const r = checkZipBomb(1_000_000, MAX_EXTRACTED_BYTES + 1);
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/EXTRACTED_SIZE_EXCEEDED/);
  });

  it("rejects zip-bomb ratio", () => {
    const compressed = 100_000;
    const uncompressed = compressed * (ZIP_BOMB_RATIO + 1);
    const r = checkZipBomb(compressed, uncompressed);
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/ZIP_BOMB/);
  });

  it("handles zero compressed size without dividing by zero", () => {
    const r = checkZipBomb(0, 100);
    expect(r.safe).toBe(true); // 0 bytes compressed → can't compute ratio, accept
  });
});

describe("validateZipStats", () => {
  it("accepts normal stats", () => {
    const r = validateZipStats(100, 10_000_000, 2_000_000);
    expect(r.safe).toBe(true);
  });

  it("rejects excessive file count", () => {
    const r = validateZipStats(MAX_EXTRACTED_FILES + 1, 1_000, 1_000);
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/FILE_COUNT_EXCEEDED/);
  });

  it("rejects excessive total uncompressed size", () => {
    const r = validateZipStats(10, MAX_EXTRACTED_BYTES + 1, 1_000_000);
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/EXTRACTED_SIZE_EXCEEDED/);
  });
});
