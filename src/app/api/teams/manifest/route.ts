// The Teams app package download: `tielora-teams-app.zip` — a manifest and two icons.
//
// ADMIN of the caller's own company only (`MANAGE_INTEGRATIONS`, `can` first, `assertCan` after).
// The zip is the same for every company, so the tenant rule has nothing to leak from it, but the
// door is still shut: a non-admin, a contractor, a signed-out caller and a dormant deployment all
// get "not found" — one answer, so nobody learns which of those it was. Writes no audit row: a
// download changes nothing and reveals no secret.

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { assertCan, can } from "@/lib/permissions";
import { byUser, limit } from "@/lib/rate-limit";
import { teamsAppConfig } from "@/lib/teams-app";
import { buildTeamsPackage } from "@/lib/teams-manifest";
import { fail } from "@/server/http";
import { currentActor } from "@/server/session";

export const dynamic = "force-dynamic";

const NOT_FOUND = "That page was not found.";

export async function GET() {
  const config = teamsAppConfig();
  if (!config) return fail(NOT_FOUND, 404);

  const actor = await currentActor();
  if (!actor || !can(actor, "MANAGE_INTEGRATIONS")) return fail(NOT_FOUND, 404);
  assertCan(actor, "MANAGE_INTEGRATIONS");

  // 10 a minute per person; building the zip is real work.
  const throttle = limit(byUser(actor.userId, "teams-manifest"), 10, 60_000);
  if (!throttle.ok) {
    return NextResponse.json(
      { ok: false, error: "You have downloaded this a lot just now. Please wait a minute." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  try {
    const zip = await buildTeamsPackage(config);
    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="tielora-teams-app.zip"',
        "Content-Length": String(zip.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    logger.warn("Could not build the Teams package", {
      category: error instanceof Error ? error.name : "unknown",
    });
    return fail("We could not prepare the file. Please try again.", 500);
  }
}
