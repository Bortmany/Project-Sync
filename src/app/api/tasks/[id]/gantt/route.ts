// One main task's schedule: the task itself plus the discipline tasks that deliver it.

import { failFrom, guardRead, ok } from "@/server/http";
import { ganttForMainTask } from "@/server/services/tasks";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("main-task-gantt");
  if (guard.response) return guard.response;

  const { id } = await context.params;

  try {
    return ok(await ganttForMainTask(guard.actor, id));
  } catch (error) {
    return failFrom(error, { route: "GET /api/tasks/[id]/gantt", mainTaskId: id });
  }
}
