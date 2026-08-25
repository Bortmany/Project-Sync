// The comment thread on one discipline task, oldest first. Removed comments come back as tombstones.

import { failFrom, guardRead, ok } from "@/server/http";
import { listComments } from "@/server/services/comments";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("discipline-task-comments");
  if (guard.response) return guard.response;

  const { id } = await context.params;

  try {
    return ok(await listComments(guard.actor, { disciplineTaskId: id }));
  } catch (error) {
    return failFrom(error, { route: "GET /api/discipline-tasks/[id]/comments", disciplineTaskId: id });
  }
}
