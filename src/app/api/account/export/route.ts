// Your account → Download your data: one person's own copy, built and streamed on the spot.
//
// A route rather than a server action, for the same reason the document download is one: a server
// action returns a value to React, and this has to arrive in somebody's downloads folder as a file.
// The service does the scoping (their own rows only, a contractor's narrowed as always) and writes
// the single audit row.

import { NextResponse } from "next/server";
import { failFrom, guardRead } from "@/server/http";
import {
  downloadMyData,
  personalExportFilename,
  personalExportThrottle,
} from "@/server/services/personal-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOO_OFTEN =
  "You have already downloaded your data today. You can get another copy tomorrow.";

export async function GET() {
  const guard = await guardRead("personal-export");
  if (guard.response) return guard.response;

  const throttle = personalExportThrottle(guard.actor.userId);
  if (!throttle.ok) {
    return NextResponse.json(
      { ok: false, error: TOO_OFTEN },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  try {
    const data = await downloadMyData(guard.actor);
    const filename = personalExportFilename(data.exportedAt);

    return new Response(`${JSON.stringify(data, null, 2)}\n`, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return failFrom(error, { route: "GET /api/account/export" });
  }
}
