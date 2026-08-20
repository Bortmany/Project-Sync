// Everything that happened on one project, newest first. Feeds the project Activity tab.

import { failFrom, guardRead, ok } from "@/server/http";
import { listActivity } from "@/server/services/comments";

export const dynamic = "force-dynamic";

/** How many rows the project feed returns at most. */
const PROJECT_ACTIVITY_LIMIT = 100;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("project-activity");
  if (guard.response) return guard.response;

  const { id } = await context.params;

  try {
    return ok(await listActivity(guard.actor, { projectId: id }, { limit: PROJECT_ACTIVITY_LIMIT }));
  } catch (error) {
    return failFrom(error, { route: "GET /api/projects/[id]/activity", projectId: id });
  }
}
