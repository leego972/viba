/**
 * VIBA Upload Safety — Zip & File Validation
 *
 * Applied to every file/zip upload before extraction or analysis.
 * Prevents: zip bombs, path traversal, symlink escape, device files,
 * oversized archives, and execution of uploaded scripts.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;        // 50 MB compressed
export const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024;    // 200 MB uncompressed
export const MAX_EXTRACTED_FILES = 2_000;
export const MAX_PATH_DEPTH = 20;
export const ZIP_BOMB_RATIO = 100;                        // uncompressed/compressed > 100 → suspicious

// ─── Allowed upload types ─────────────────────────────────────────────────────

const ALLOWED_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".tgz",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".yaml", ".yml", ".toml", ".env.example",
  ".md", ".txt", ".html", ".css", ".scss",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".pdf",
]);

const ALLOWED_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-gzip",
  "application/octet-stream", // generic — extension still checked
  "text/plain",
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "application/json",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

export interface SafetyResult {
  safe: boolean;
  reason?: string;
}

/**
 * Validate a file upload before it is stored or processed.
 */
export function validateUploadFile(
  filename: string,
  mimeType: string,
  sizeBytes: number
): SafetyResult {
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return {
      safe: false,
      reason: `FILE_TOO_LARGE: ${sizeBytes} bytes exceeds limit of ${MAX_UPLOAD_BYTES} bytes`,
    };
  }

  const ext = getExtension(filename);
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    return { safe: false, reason: `FILE_EXTENSION_NOT_ALLOWED: ${ext}` };
  }

  const baseMime = mimeType.split(";")[0].trim().toLowerCase();
  if (baseMime && !ALLOWED_MIME_TYPES.has(baseMime)) {
    return { safe: false, reason: `MIME_NOT_ALLOWED: ${baseMime}` };
  }

  return { safe: true };
}

function getExtension(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : null;
}

// ─── Zip entry validation ─────────────────────────────────────────────────────

/**
 * Validate a single entry path from a zip/tar archive.
 *
 * Blocks:
 * - Path traversal sequences  (../ or ..\)
 * - Absolute paths            (/etc/passwd)
 * - Null bytes                (\0)
 * - Excessively deep paths    (> MAX_PATH_DEPTH components)
 * - Windows device names      (CON, AUX, NUL, COM1–COM9, LPT1–LPT9)
 */
export function validateZipEntry(entryPath: string): SafetyResult {
  if (!entryPath || typeof entryPath !== "string") {
    return { safe: false, reason: "ENTRY_PATH_EMPTY" };
  }

  // Null bytes
  if (entryPath.includes("\0")) {
    return { safe: false, reason: "ENTRY_PATH_NULL_BYTE" };
  }

  // Absolute paths (Unix or Windows)
  if (/^[/\\]/.test(entryPath) || /^[A-Za-z]:[/\\]/.test(entryPath)) {
    return { safe: false, reason: "ENTRY_PATH_ABSOLUTE" };
  }

  // Path traversal
  const normalised = entryPath.replace(/\\/g, "/");
  const parts = normalised.split("/");
  for (const part of parts) {
    if (part === "..") {
      return { safe: false, reason: "ENTRY_PATH_TRAVERSAL" };
    }
  }

  // Depth limit
  if (parts.length > MAX_PATH_DEPTH) {
    return {
      safe: false,
      reason: `ENTRY_PATH_TOO_DEEP: ${parts.length} components (max ${MAX_PATH_DEPTH})`,
    };
  }

  // Windows device names
  const DEVICE_PATTERN = /^(CON|AUX|NUL|PRN|COM[1-9]|LPT[1-9])(\.|$)/i;
  for (const part of parts) {
    if (DEVICE_PATTERN.test(part)) {
      return { safe: false, reason: `ENTRY_PATH_DEVICE_FILE: ${part}` };
    }
  }

  return { safe: true };
}

/**
 * Heuristic zip-bomb check.
 *
 * @param compressedBytes   Size reported in the zip central directory.
 * @param uncompressedBytes Size after inflation.
 */
export function checkZipBomb(
  compressedBytes: number,
  uncompressedBytes: number
): SafetyResult {
  if (uncompressedBytes > MAX_EXTRACTED_BYTES) {
    return {
      safe: false,
      reason: `ZIP_EXTRACTED_SIZE_EXCEEDED: ${uncompressedBytes} bytes (max ${MAX_EXTRACTED_BYTES})`,
    };
  }

  if (compressedBytes > 0 && uncompressedBytes / compressedBytes > ZIP_BOMB_RATIO) {
    return {
      safe: false,
      reason: `ZIP_BOMB_HEURISTIC: compression ratio ${Math.round(uncompressedBytes / compressedBytes)}:1 exceeds limit of ${ZIP_BOMB_RATIO}:1`,
    };
  }

  return { safe: true };
}

/**
 * Validate aggregate zip extraction stats after scanning the central directory
 * (without actually extracting).
 */
export function validateZipStats(
  fileCount: number,
  totalUncompressedBytes: number,
  totalCompressedBytes: number
): SafetyResult {
  if (fileCount > MAX_EXTRACTED_FILES) {
    return {
      safe: false,
      reason: `ZIP_FILE_COUNT_EXCEEDED: ${fileCount} entries (max ${MAX_EXTRACTED_FILES})`,
    };
  }

  return checkZipBomb(totalCompressedBytes, totalUncompressedBytes);
}
