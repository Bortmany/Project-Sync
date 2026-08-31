// The announcements still running for the signed-in person, newest first. Never anyone else's
// audiences, and never anything for a contractor — the service answers them "not found".

import { failFrom, guardRead, ok } from "@/server/http";
import { listAnnouncementsForUser } from "@/server/services/posts";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await guardRead("posts-announcements");
  if (guard.response) return guard.response;

  try {
    return ok(await listAnnouncementsForUser(guard.actor));
  } catch (error) {
    return failFrom(error, { route: "GET /api/posts/announcements" });
  }
}
