// The audit trail for one main task, newest first, including everything its discipline tasks did.

import { failFrom, guardRead, ok } from "@/server/http";
import { listActivity } from "@/server/services/comments";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("main-task-activity");
  if (guard.response) return guard.response;

  const { id } = await context.params;

  try {
    return ok(await listActivity(guard.actor, { mainTaskId: id }));
  } catch (error) {
    return failFrom(error, { route: "GET /api/tasks/[id]/activity", mainTaskId: id });
  }
}
