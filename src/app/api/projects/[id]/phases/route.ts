// A project's stage gates, in gate order, each with its DERIVED lock state.
// VIEW_PROJECT is checked in the service, never in the page.

import { failFrom, guardRead, ok } from "@/server/http";
import { listPhasesForProject } from "@/server/services/phases";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("project-phases");
  if (guard.response) return guard.response;

  const { id } = await context.params;

  try {
    return ok(await listPhasesForProject(guard.actor, id));
  } catch (error) {
    return failFrom(error, { route: "GET /api/projects/[id]/phases", projectId: id });
  }
}
