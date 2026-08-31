// Attaching a file that already lives in the company's OneDrive or SharePoint.
//
// The bytes come down through our own server and then take exactly the road an upload takes:
// size checked before anything is fetched, magic numbers checked on what arrived, a random filename
// under DATA_DIR, and one new DocumentVersion. Nothing about the append-only guarantee changes —
// this route creates a revision the same way /api/uploads does, and records where it came from in
// the revision note.

import { NextResponse } from "next/server";
import { MICROSOFT_NOT_CONFIGURED } from "@/lib/ms-graph";
import { byUser, limit } from "@/lib/rate-limit";
import { AttachMicrosoftFileInput, toFieldErrors } from "@/lib/zod-schemas";
import { fail, failFrom, failWithFields, ok } from "@/server/http";
import { SIGNED_OUT_MESSAGE, currentActor } from "@/server/session";
import { attachMicrosoftFile, microsoftAvailable } from "@/server/services/microsoft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The same ceiling ordinary uploads have: enough for a real batch, not enough to flood the disk. */
const ATTACH_LIMIT = 30;
const ATTACH_WINDOW_MS = 60_000;

export async function POST(request: Request) {
  if (!microsoftAvailable()) return fail(MICROSOFT_NOT_CONFIGURED, 404);

  const actor = await currentActor();
  if (!actor) return fail(SIGNED_OUT_MESSAGE, 401);

  const throttle = limit(byUser(actor.userId, "microsoft-attach"), ATTACH_LIMIT, ATTACH_WINDOW_MS);
  if (!throttle.ok) {
    return NextResponse.json(
      { ok: false, error: "That is a lot of attachments at once. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("That request was not readable. Please try again.", 400);
  }

  const parsed = AttachMicrosoftFileInput.safeParse(body);
  if (!parsed.success) {
    return failWithFields("Please check the highlighted fields.", toFieldErrors(parsed.error));
  }

  try {
    return ok(await attachMicrosoftFile(actor, parsed.data));
  } catch (error) {
    return failFrom(error, {
      route: "POST /api/integrations/microsoft/attach",
      projectId: parsed.data.projectId,
    });
  }
}
