// The whole project's schedule: one row per main task, its discipline tasks beneath it.

import { failFrom, guardRead, ok } from "@/server/http";
import { ganttForProject } from "@/server/services/tasks";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("project-gantt");
  if (guard.response) return guard.response;

  const { id } = await context.params;

  try {
    return ok(await ganttForProject(guard.actor, id));
  } catch (error) {
    return failFrom(error, { route: "GET /api/projects/[id]/gantt", projectId: id });
  }
}
