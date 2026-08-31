// "Where we stand": one project's brief. VIEW_PROJECT is checked in the service, never in the page,
// and another company's project is not found rather than refused.

import { failFrom, guardRead, ok } from "@/server/http";
import { projectBrief } from "@/server/services/briefs";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("project-brief");
  if (guard.response) return guard.response;

  const { id } = await context.params;

  try {
    return ok(await projectBrief(guard.actor, id));
  } catch (error) {
    return failFrom(error, { route: "GET /api/projects/[id]/brief", projectId: id });
  }
}
