// One project in full. VIEW_PROJECT is checked in the service, never in the page.

import { failFrom, guardRead, ok } from "@/server/http";
import { getProjectForActor } from "@/server/services/projects";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("project");
  if (guard.response) return guard.response;

  const { id } = await context.params;

  try {
    return ok(await getProjectForActor(guard.actor, id));
  } catch (error) {
    return failFrom(error, { route: "GET /api/projects/[id]", projectId: id });
  }
}
