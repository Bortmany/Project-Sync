// One-click status report: a PDF or PowerPoint of one project, built on the spot and streamed.
//
// A route rather than a server action, for the same reason the personal export is one: this has to
// arrive in somebody's downloads folder as a file. Nothing is stored; the only thing written is the
// single audit row, after the file is built, never for a refused or failed request.
//
// Order matters:
//  1. signed in, and the ordinary read limit (guardRead);
//  2. THE EXTERNAL RULE — a contractor is "not found", before any data is read and before we even
//     look at the question they asked;
//  3. a missing or unknown `format` is a plain 400;
//  4. the export's own ceiling (10 a minute) -> 429 + Retry-After;
//  5. build. `assertCanViewProject` inside it makes another company's project, or one the person is
//     not on, "not found" — never "forbidden".

import { NextResponse } from "next/server";
import { isExternal } from "@/server/actor";
import { NotFoundError } from "@/server/errors";
import { fail, failFrom, guardRead } from "@/server/http";
import {
  exportStatusReport,
  reportExportThrottle,
  type ReportFormat,
} from "@/server/services/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOO_OFTEN = "You have exported a lot of reports just now. Please wait a minute.";
const BAD_FORMAT = "Choose PDF or PowerPoint for the report.";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("project-report");
  if (guard.response) return guard.response;
  const { actor } = guard;

  const { id } = await context.params;

  // Before anything is read: a contractor has no report, and a miss is never "forbidden".
  if (isExternal(actor)) return failFrom(new NotFoundError("We could not find that project."), { route: "GET /api/projects/[id]/report", projectId: id });

  const format = new URL(request.url).searchParams.get("format");
  if (format !== "pdf" && format !== "pptx") return fail(BAD_FORMAT, 400);

  const throttle = reportExportThrottle(actor.userId);
  if (!throttle.ok) {
    return NextResponse.json(
      { ok: false, error: TOO_OFTEN },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  try {
    const built = await exportStatusReport(actor, id, format as ReportFormat);
    return new Response(new Uint8Array(built.body), {
      status: 200,
      headers: {
        "Content-Type": built.contentType,
        "Content-Disposition": `attachment; filename="${built.filename}"`,
        "Content-Length": String(built.body.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return failFrom(error, { route: "GET /api/projects/[id]/report", projectId: id });
  }
}
