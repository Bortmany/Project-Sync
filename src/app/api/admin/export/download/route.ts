// Downloading a finished workspace export. Streams the archive straight from disk, always as an
// attachment, never from a cache — the same shape the document download route has.
//
// Two keys, not one: the token in the address AND a signed-in administrator of the company whose
// data it is (checked in the service). A GET consumes nothing, so a dropped download can simply be
// started again until the link expires.

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { EmailTokenSchema } from "@/lib/zod-schemas";
import { fail, failFrom, guardRead, queryRecord } from "@/server/http";
import { exportDownload } from "@/server/services/workspace-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_LINK = "That download link no longer works. Ask for a new export from Admin → Data & privacy.";

export async function GET(request: Request) {
  const guard = await guardRead("admin-export-download");
  if (guard.response) return guard.response;

  const parsed = EmailTokenSchema.safeParse(queryRecord(request, ["token"]).token ?? "");
  // A malformed token is answered exactly like a wrong or expired one: nothing to tell them apart.
  if (!parsed.success) return fail(NO_LINK, 404);

  try {
    const archive = await exportDownload(guard.actor, parsed.data);
    const stream = Readable.toWeb(createReadStream(archive.absolutePath)) as ReadableStream<Uint8Array>;

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(archive.sizeBytes),
        "Content-Disposition": `attachment; filename="${archive.filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return failFrom(error, { route: "GET /api/admin/export/download" });
  }
}
