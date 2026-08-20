// The documents attached to one discipline task.

import { failFrom, guardRead, ok } from "@/server/http";
import { listDocumentsForDisciplineTask } from "@/server/services/documents";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("discipline-task-documents");
  if (guard.response) return guard.response;

  const { id } = await context.params;

  try {
    return ok(await listDocumentsForDisciplineTask(guard.actor, id));
  } catch (error) {
    return failFrom(error, { route: "GET /api/discipline-tasks/[id]/documents", disciplineTaskId: id });
  }
}
