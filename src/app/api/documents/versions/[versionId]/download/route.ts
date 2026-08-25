// Downloading one revision of a document. Streams the stored file straight from disk, always as an
// attachment, always with the type recorded at upload time, and never from a cache.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { safeOriginalName } from "@/lib/upload";
import { logger } from "@/lib/logger";
import { fail, failFrom, guardRead } from "@/server/http";
import { getVersionForDownload } from "@/server/services/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MISSING_FILE = "That file is not available right now. Please tell the project administrator.";

/** RFC 5987: the plain filename for old clients, the encoded one for everything else. */
function contentDisposition(originalFilename: string): string {
  const safe = safeOriginalName(originalFilename);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export async function GET(_request: Request, context: { params: Promise<{ versionId: string }> }) {
  const guard = await guardRead("document-download");
  if (guard.response) return guard.response;

  const { versionId } = await context.params;

  try {
    const version = await getVersionForDownload(guard.actor, versionId);

    let bytesOnDisk: number;
    try {
      bytesOnDisk = (await stat(version.absolutePath)).size;
    } catch {
      // A recorded revision whose file is gone is an integrity problem, not a normal 404.
      logger.error("A stored document file is missing from disk", { versionId });
      return fail(MISSING_FILE, 404);
    }

    if (bytesOnDisk !== version.sizeBytes) {
      logger.error("A stored document file does not match its recorded size", {
        versionId,
        recorded: version.sizeBytes,
        onDisk: bytesOnDisk,
      });
    }

    const stream = Readable.toWeb(createReadStream(version.absolutePath)) as ReadableStream<Uint8Array>;

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": version.mimeType,
        "Content-Length": String(bytesOnDisk),
        "Content-Disposition": contentDisposition(version.originalFilename),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return failFrom(error, { route: "GET /api/documents/versions/[versionId]/download", versionId });
  }
}
