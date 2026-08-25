// Every document on a main task: its own shared files plus the files on its discipline tasks.

import { failFrom, guardRead, ok } from "@/server/http";
import { listDocumentsForMainTask } from "@/server/services/documents";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("main-task-documents");
  if (guard.response) return guard.response;

  const { id } = await context.params;

  try {
    return ok(await listDocumentsForMainTask(guard.actor, id));
  } catch (error) {
    return failFrom(error, { route: "GET /api/tasks/[id]/documents", mainTaskId: id });
  }
}
