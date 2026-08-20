// Upload safety: files are trusted by their bytes (magic numbers), never by the browser-supplied name or content type.

import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

export type SizeCheck = { ok: true; error?: undefined } | { ok: false; error: string };

/**
 * Routes MUST call this against file.size / Content-Length BEFORE reading the body
 * into memory — validateUpload's own cap only runs once the bytes are already held.
 */
export function assertUploadSize(bytes: number, maxBytes = MAX_UPLOAD_BYTES): SizeCheck {
  if (!Number.isFinite(bytes) || bytes <= 0) return { ok: false, error: "That file is empty." };
  if (bytes > maxBytes) {
    const mb = Math.floor(maxBytes / (1024 * 1024));
    return { ok: false, error: `That file is larger than the ${mb} MB limit.` };
  }
  return { ok: true };
}

/**
 * Makes a browser-supplied filename safe to store and echo in a Content-Disposition
 * header: strips path separators and control characters, bounds the length.
 */
export function safeOriginalName(originalName: string): string {
  const base = path.basename(originalName.replace(/\\/g, "/"));
  const cleaned = base.replace(/[\x00-\x1f\x7f"\\]/g, "_").trim();
  const bounded = cleaned.length > 180 ? cleaned.slice(-180) : cleaned;
  return bounded || "file";
}

export type ValidateResult =
  | { ok: true; mimeType: string; ext: string; error?: undefined }
  | { ok: false; mimeType?: undefined; ext?: undefined; error: string };

/** Office/zip container formats all start with the same ZIP signature, so the extension decides which one it is. */
const ZIP_EXTENSIONS: Record<string, string> = {
  zip: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function extensionOf(originalName: string): string {
  const ext = path.extname(originalName).replace(".", "").toLowerCase();
  return ext;
}

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => buf[offset + i] === byte);
}

/** What each known extension is supposed to contain, so a mislabelled file can be spotted. */
const EXPECTED_BY_EXTENSION: Record<string, string> = {
  pdf: "pdf",
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  webp: "webp",
  dwg: "dwg",
};

function looksBinary(buf: Buffer): boolean {
  const window = buf.subarray(0, 1024);
  for (const byte of window) {
    // NUL and most control bytes never appear in real CSV/text files.
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) return true;
  }
  return false;
}

/**
 * Checks a buffer against the allowed file types.
 * Returns a plain-English error when the bytes do not match an allowed type.
 */
export function validateUpload(
  buf: Buffer,
  originalName: string,
  options: { maxBytes?: number } = {},
): ValidateResult {
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES;

  if (buf.length === 0) return { ok: false, error: "That file is empty." };
  if (buf.length > maxBytes) {
    const mb = Math.floor(maxBytes / (1024 * 1024));
    return { ok: false, error: `That file is larger than the ${mb} MB limit.` };
  }

  const ext = extensionOf(originalName);
  const expected = EXPECTED_BY_EXTENSION[ext];

  /** A file whose bytes contradict its name is refused outright, never silently re-labelled. */
  const matched = (detected: string, mimeType: string): ValidateResult => {
    if (expected && expected !== detected) {
      return {
        ok: false,
        error: `That file is named .${ext} but its contents are not a ${ext.toUpperCase()} file.`,
      };
    }
    return { ok: true, mimeType, ext: detected };
  };

  // PDF — "%PDF"
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return matched("pdf", "application/pdf");
  // PNG
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return matched("png", "image/png");
  }
  // JPEG
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return matched("jpg", "image/jpeg");
  // WebP — "RIFF" .... "WEBP"
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return matched("webp", "image/webp");
  }
  // ZIP family: PK\x03\x04 — the extension picks the exact type, and must be on the whitelist.
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    const mimeType = ZIP_EXTENSIONS[ext];
    if (!mimeType) {
      return {
        ok: false,
        error: "That looks like a zipped file type we do not accept. Use ZIP, XLSX, DOCX or PPTX.",
      };
    }
    return { ok: true, mimeType, ext };
  }
  // DWG — "AC10.." version tag
  if (startsWith(buf, [0x41, 0x43, 0x31, 0x30])) return matched("dwg", "image/vnd.dwg");
  // CSV / plain text: no signature exists, so allow only by extension and only if the start is really text.
  if ((ext === "csv" || ext === "txt") && !looksBinary(buf)) {
    return { ok: true, mimeType: ext === "csv" ? "text/csv" : "text/plain", ext };
  }

  return {
    ok: false,
    error:
      "We cannot accept that file type. Allowed: PDF, PNG, JPEG, WebP, ZIP, XLSX, DOCX, PPTX, DWG, CSV and TXT.",
  };
}

export type StoredFile = { storedFilename: string; checksumSha256: string; sizeBytes: number };

/** Absolute path of the uploads folder inside DATA_DIR. */
export function uploadsDir(): string {
  return path.resolve(process.env.DATA_DIR ?? "./data", "uploads");
}

/** Absolute path of one stored file. */
export function storedFilePath(storedFilename: string): string {
  return path.join(uploadsDir(), path.basename(storedFilename));
}

/** Writes the bytes under a random filename inside DATA_DIR/uploads and returns what the DB needs. */
export async function storeFile(buf: Buffer, ext: string): Promise<StoredFile> {
  const dir = uploadsDir();
  await mkdir(dir, { recursive: true });
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const storedFilename = `${randomBytes(16).toString("hex")}${safeExt ? `.${safeExt}` : ""}`;
  await writeFile(path.join(dir, storedFilename), buf, { flag: "wx" });
  return {
    storedFilename,
    checksumSha256: createHash("sha256").update(buf).digest("hex"),
    sizeBytes: buf.length,
  };
}
