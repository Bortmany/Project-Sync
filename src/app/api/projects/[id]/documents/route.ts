// Every live document on a project, newest first (the 200 most recent).

import { failFrom, guardRead, ok } from "@/server/http";
import { listDocumentsForProject } from "@/server/services/documents";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRead("project-documents");
  if (guard.response) return guard.response;

  const { id } = await context.params;

  try {
    return ok(await listDocumentsForProject(guard.actor, id));
  } catch (error) {
    return failFrom(error, { route: "GET /api/projects/[id]/documents", projectId: id });
  }
}
