// One discipline task, including its required documents, what it waits on, and whether it may be completed now.

import { failFrom, guardRead, ok } from "@/server/http";
import { getDisciplineTaskForActor } from "@/server/services/tasks";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("discipline-task");
  if (guard.response) return guard.response;

  const { id } = await context.params;

  try {
    return ok(await getDisciplineTaskForActor(guard.actor, id));
  } catch (error) {
    return failFrom(error, { route: "GET /api/discipline-tasks/[id]", disciplineTaskId: id });
  }
}
