// One main task in full, with its derived status, progress and overdue flag.

import { failFrom, guardRead, ok } from "@/server/http";
import { getMainTaskForActor } from "@/server/services/tasks";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("main-task");
  if (guard.response) return guard.response;

  const { id } = await context.params;

  try {
    return ok(await getMainTaskForActor(guard.actor, id));
  } catch (error) {
    return failFrom(error, { route: "GET /api/tasks/[id]", mainTaskId: id });
  }
}
