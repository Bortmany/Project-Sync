// Uploading a file. The only route in the app that takes bytes, so it is also the strictest one:
// signed in, rate limited, size checked before anything is read into memory, and the file trusted by
// its bytes (magic numbers) rather than by whatever name or content type the browser sent.

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { byUser, limit } from "@/lib/rate-limit";
import {
  MAX_UPLOAD_BYTES,
  assertUploadSize,
  safeOriginalName,
  storeFile,
  validateUpload,
} from "@/lib/upload";
import { UploadMeta, toFieldErrors } from "@/lib/zod-schemas";
import { fail, failFrom, failWithFields, ok } from "@/server/http";
import { SIGNED_OUT_MESSAGE, currentActor } from "@/server/session";
import { uploadDocumentVersion } from "@/server/services/documents";

// Route handlers stream their own body, so Next applies no size limit here — the 25 MB ceiling is
// enforced below from file.size before the bytes are ever pulled into memory.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Uploads per person per minute. Enough for a real batch of drawings, not enough to flood the disk. */
const UPLOAD_LIMIT = 30;
const UPLOAD_WINDOW_MS = 60_000;

/** Blank form fields arrive as empty strings; the meta schema wants them absent. */
function text(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function POST(request: Request) {
  const actor = await currentActor();
  if (!actor) return fail(SIGNED_OUT_MESSAGE, 401);

  const throttle = limit(byUser(actor.userId, "upload"), UPLOAD_LIMIT, UPLOAD_WINDOW_MS);
  if (!throttle.ok) {
    return NextResponse.json(
      { ok: false, error: "That is a lot of uploads at once. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("That upload was not readable. Please try again.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail("Choose a file to upload.", 400);

  // Size first, always: validateUpload's own cap only helps once the bytes are already held.
  const sizeCheck = assertUploadSize(file.size);
  if (!sizeCheck.ok) return fail(sizeCheck.error, file.size > MAX_UPLOAD_BYTES ? 413 : 400);

  const parsed = UploadMeta.safeParse({
    projectId: text(form, "projectId"),
    mainTaskId: text(form, "mainTaskId"),
    disciplineTaskId: text(form, "disciplineTaskId"),
    documentId: text(form, "documentId"),
    requiredDocumentId: text(form, "requiredDocumentId"),
    title: text(form, "title"),
    category: text(form, "category"),
    note: text(form, "note"),
  });
  if (!parsed.success) {
    return failWithFields("Please check the highlighted fields.", toFieldErrors(parsed.error));
  }

  const originalName = safeOriginalName(file.name);
  const buffer = Buffer.from(await file.arrayBuffer());

  const checked = validateUpload(buffer, originalName);
  if (!checked.ok) return fail(checked.error, 400);

  const stored = await storeFile(buffer, checked.ext);

  try {
    const version = await uploadDocumentVersion(actor, parsed.data, {
      buffer,
      originalName,
      mimeType: checked.mimeType,
      ext: checked.ext,
      sizeBytes: stored.sizeBytes,
      checksumSha256: stored.checksumSha256,
      storedFilename: stored.storedFilename,
    });
    return ok(version);
  } catch (error) {
    // The bytes are on disk but no revision row points at them. The file is left alone on purpose —
    // deleting it is how a real revision gets lost. It is logged so it can be tidied up deliberately.
    logger.warn("An uploaded file was stored but not recorded", {
      storedFilename: stored.storedFilename,
      projectId: parsed.data.projectId,
      userId: actor.userId,
    });
    return failFrom(error, { route: "POST /api/uploads", projectId: parsed.data.projectId });
  }
}
