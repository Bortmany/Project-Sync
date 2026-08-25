// The audit trail for one discipline task, newest first.

import { failFrom, guardRead, ok } from "@/server/http";
import { listActivity } from "@/server/services/comments";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("discipline-task-activity");
  if (guard.response) return guard.response;

  const { id } = await context.params;

  try {
    return ok(await listActivity(guard.actor, { disciplineTaskId: id }));
  } catch (error) {
    return failFrom(error, { route: "GET /api/discipline-tasks/[id]/activity", disciplineTaskId: id });
  }
}
