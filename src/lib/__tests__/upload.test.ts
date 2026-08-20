// Upload tests: files are judged by their bytes, never by the name the browser sent.

import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, validateUpload } from "@/lib/upload";

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  "latin1",
);

// 8-byte PNG signature followed by a minimal IHDR chunk header.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
  Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00]),
]);

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("JFIF", "latin1")]);

const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 ", "latin1"),
]);

const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
const DWG = Buffer.concat([Buffer.from("AC1018", "latin1"), Buffer.alloc(20)]);
const CSV = Buffer.from("tag,description\nP-101,Feed pump\n", "utf8");

describe("validateUpload — accepts real files", () => {
  it("accepts a PDF", () => {
    expect(validateUpload(PDF, "drawing register.pdf")).toMatchObject({
      ok: true,
      mimeType: "application/pdf",
      ext: "pdf",
    });
  });

  it("accepts a PNG", () => {
    expect(validateUpload(PNG, "snapshot.png")).toMatchObject({ ok: true, mimeType: "image/png" });
  });

  it("accepts a JPEG under either extension", () => {
    expect(validateUpload(JPEG, "site.jpg")).toMatchObject({ ok: true, mimeType: "image/jpeg" });
    expect(validateUpload(JPEG, "site.jpeg")).toMatchObject({ ok: true, mimeType: "image/jpeg" });
  });

  it("accepts a WebP", () => {
    expect(validateUpload(WEBP, "photo.webp")).toMatchObject({ ok: true, mimeType: "image/webp" });
  });

  it("accepts the zip family by extension", () => {
    expect(validateUpload(ZIP, "loads.xlsx")).toMatchObject({
      ok: true,
      ext: "xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(validateUpload(ZIP, "bundle.zip")).toMatchObject({ ok: true, ext: "zip" });
  });

  it("accepts a DWG drawing", () => {
    expect(validateUpload(DWG, "layout.dwg")).toMatchObject({ ok: true, ext: "dwg" });
  });

  it("accepts a plain CSV", () => {
    expect(validateUpload(CSV, "tags.csv")).toMatchObject({ ok: true, mimeType: "text/csv" });
  });
});

describe("validateUpload — rejects anything suspicious", () => {
  it("rejects a .pdf that is really a PNG", () => {
    const result = validateUpload(PNG, "specification.pdf");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not a PDF file");
  });

  it("rejects a .png that is really a PDF", () => {
    expect(validateUpload(PDF, "photo.png").ok).toBe(false);
  });

  it("rejects an unknown binary type", () => {
    const junk = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    const result = validateUpload(junk, "mystery.bin");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot accept that file type");
  });

  it("rejects a zipped type that is not on the whitelist", () => {
    const result = validateUpload(ZIP, "archive.jar");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("zipped file type");
  });

  it("rejects an executable renamed to .csv", () => {
    const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64)]);
    expect(validateUpload(elf, "payload.csv").ok).toBe(false);
  });

  it("rejects an empty file", () => {
    expect(validateUpload(Buffer.alloc(0), "empty.pdf")).toMatchObject({
      ok: false,
      error: "That file is empty.",
    });
  });

  it("rejects a file over the size limit with a plain-English message", () => {
    const result = validateUpload(PDF, "big.pdf", { maxBytes: 10 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("larger than");
  });

  it("keeps the default limit at 25 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
  });
});
