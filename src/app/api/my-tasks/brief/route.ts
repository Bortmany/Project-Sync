// "Your day": the signed-in person's own brief, computed from work the app already records.
// Nothing here is stored, and nobody else's rows can appear — the service scopes to the actor.

import { failFrom, guardRead, ok } from "@/server/http";
import { personBrief } from "@/server/services/briefs";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await guardRead("my-tasks-brief");
  if (guard.response) return guard.response;

  try {
    return ok(await personBrief(guard.actor));
  } catch (error) {
    return failFrom(error, { route: "GET /api/my-tasks/brief" });
  }
}
