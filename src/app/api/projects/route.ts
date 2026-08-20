// The projects a signed-in person may see. Non-admins only ever get their own memberships back.

import { failFrom, guardRead, ok } from "@/server/http";
import { listProjectsForActor } from "@/server/services/projects";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await guardRead("projects");
  if (guard.response) return guard.response;

  try {
    return ok(await listProjectsForActor(guard.actor));
  } catch (error) {
    return failFrom(error, { route: "GET /api/projects" });
  }
}
